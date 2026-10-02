import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { validateStoredProfilePhoto } from "@/lib/profile-photo";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export const PROFILE_PHOTO_BUCKET = "elyra-private";

export class ProfilePhotoServiceError extends Error {
  constructor(readonly code: string) {
    super(`profile_photo_${code}`);
    this.name = "ProfilePhotoServiceError";
  }
}

export async function readProfilePhotoPath(
  client: Client,
  userId: string,
): Promise<string | null> {
  const { data, error } = await client
    .from("profiles")
    .select("avatar_path")
    .eq("user_id", userId)
    .single();
  if (error || !data) throw new ProfilePhotoServiceError("profile_read");
  return data.avatar_path;
}

export async function downloadProfilePhoto(client: Client, userId: string) {
  const path = await readProfilePhotoPath(client, userId);
  if (!path) return null;
  const { data, error } = await client.storage.from(PROFILE_PHOTO_BUCKET).download(path);
  if (error || !data) throw new ProfilePhotoServiceError("download");
  return data;
}

export async function saveProfilePhoto(
  client: Client,
  userId: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<{ path: string; previousCleanupPending: boolean }> {
  validateStoredProfilePhoto(bytes, contentType);
  const previous = await readProfilePhotoPath(client, userId);
  const path = `${userId}/profile/${randomUUID()}.webp`;
  const upload = await client.storage.from(PROFILE_PHOTO_BUCKET).upload(path, bytes, {
    cacheControl: "3600",
    contentType: "image/webp",
    upsert: false,
  });
  if (upload.error) throw new ProfilePhotoServiceError("upload");

  let update = client
    .from("profiles")
    .update({ avatar_path: path })
    .eq("user_id", userId);
  update = previous === null
    ? update.is("avatar_path", null)
    : update.eq("avatar_path", previous);
  const saved = await update.select("avatar_path").maybeSingle();
  if (saved.error || !saved.data) {
    await client.storage.from(PROFILE_PHOTO_BUCKET).remove([path]);
    throw new ProfilePhotoServiceError(saved.error ? "profile_update" : "concurrent_update");
  }

  let previousCleanupPending = false;
  if (previous && previous !== path) {
    const removal = await client.storage.from(PROFILE_PHOTO_BUCKET).remove([previous]);
    previousCleanupPending = Boolean(removal.error);
  }
  return { path, previousCleanupPending };
}

export async function removeProfilePhoto(
  client: Client,
  userId: string,
): Promise<boolean> {
  const path = await readProfilePhotoPath(client, userId);
  if (!path) return false;
  const removal = await client.storage.from(PROFILE_PHOTO_BUCKET).remove([path]);
  if (removal.error) throw new ProfilePhotoServiceError("remove");

  const cleared = await client
    .from("profiles")
    .update({ avatar_path: null })
    .eq("user_id", userId)
    .eq("avatar_path", path)
    .select("user_id")
    .maybeSingle();
  if (cleared.error) throw new ProfilePhotoServiceError("profile_clear");
  if (!cleared.data) throw new ProfilePhotoServiceError("concurrent_update");
  return true;
}

/** Remove inclusive arquivos antigos sem expor metadata interna ao export. */
export async function removeAllProfilePhotos(
  client: Client,
  userId: string,
): Promise<number> {
  const prefix = `${userId}/profile`;
  let removed = 0;
  for (let batch = 0; batch < 100; batch += 1) {
    const listing = await client.storage.from(PROFILE_PHOTO_BUCKET).list(prefix, {
      limit: 100,
      offset: 0,
    });
    if (listing.error) throw new ProfilePhotoServiceError("list_cleanup");
    const files = (listing.data ?? []).filter((item) => item.id !== null);
    if (files.some((item) => !item.name.endsWith(".webp"))) {
      throw new ProfilePhotoServiceError("unexpected_cleanup_entry");
    }
    const paths = files.map((item) => `${prefix}/${item.name}`);
    if (paths.length === 0) return removed;
    const removal = await client.storage.from(PROFILE_PHOTO_BUCKET).remove(paths);
    if (removal.error) throw new ProfilePhotoServiceError("cleanup");
    removed += paths.length;
  }
  const verify = await client.storage.from(PROFILE_PHOTO_BUCKET).list(prefix, {
    limit: 1,
    offset: 0,
  });
  if (verify.error || (verify.data?.length ?? 0) > 0) {
    throw new ProfilePhotoServiceError("cleanup_verify");
  }
  return removed;
}
