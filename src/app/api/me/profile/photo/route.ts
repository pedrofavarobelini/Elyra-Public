import { ProfilePhotoValidationError } from "@/lib/profile-photo";
import { getConsentedApiUser } from "@/server/auth";
import {
  ProfilePhotoServiceError,
  downloadProfilePhoto,
  removeProfilePhoto,
  saveProfilePhoto,
} from "@/server/services/profile-photo-service";

export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const photo = await downloadProfilePhoto(auth.supabase, auth.user.id);
    if (!photo) return new Response(null, { status: 404 });
    return new Response(photo, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ProfilePhotoServiceError) {
      return Response.json({ error: "Não foi possível carregar a foto." }, { status: 503 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const entry = (await request.formData()).get("photo");
    if (!(entry instanceof File)) {
      return Response.json({ error: "Selecione uma foto válida." }, { status: 400 });
    }
    const bytes = new Uint8Array(await entry.arrayBuffer());
    const saved = await saveProfilePhoto(
      auth.supabase,
      auth.user.id,
      bytes,
      entry.type,
    );
    return Response.json({
      data: { hasPhoto: true },
      warning: saved.previousCleanupPending ? "PREVIOUS_FILE_CLEANUP_PENDING" : null,
    });
  } catch (error) {
    if (error instanceof ProfilePhotoValidationError) {
      return Response.json({ error: "A foto precisa ser um WebP válido de até 1 MB." }, { status: 415 });
    }
    if (error instanceof ProfilePhotoServiceError) {
      const status = error.code === "concurrent_update" ? 409 : 503;
      return Response.json({ error: "Não foi possível salvar a foto." }, { status });
    }
    throw error;
  }
}

export async function DELETE() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    await removeProfilePhoto(auth.supabase, auth.user.id);
    return Response.json({ data: { hasPhoto: false } });
  } catch (error) {
    if (error instanceof ProfilePhotoServiceError) {
      const status = error.code === "concurrent_update" ? 409 : 503;
      return Response.json({ error: "Não foi possível remover a foto." }, { status });
    }
    throw error;
  }
}
