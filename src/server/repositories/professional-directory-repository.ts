import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { DirectorySearch, PublicProfileInput } from "@/lib/contracts/professional-directory";
import { DIRECTORY_PAGE_SIZE } from "@/lib/contracts/professional-directory";
import type { Database } from "@/lib/supabase/database.types";

import { ProfessionalRepositoryError } from "./professional-repository";

type Client = SupabaseClient<Database>;



export const OWN_PUBLIC_PROFILE_COLUMNS =
  "slug, listed, display_name, bio, city, state, modalities, areas, languages, updated_at" as const;

export async function searchDirectory(client: Client, search: DirectorySearch) {
  const { data, error } = await client.rpc("search_professional_directory", {
    p_query: search.q ?? undefined,
    p_state: search.state ?? undefined,
    p_city: search.city ?? undefined,
    p_modality: search.modality ?? undefined,
    p_area: search.area ?? undefined,
    p_language: search.language ?? undefined,
    p_page: search.page,
    p_page_size: DIRECTORY_PAGE_SIZE,
  });
  if (error) throw new ProfessionalRepositoryError("search_professional_directory", error);
  return data ?? [];
}

export async function findDirectoryProfile(client: Client, slug: string) {
  const { data, error } = await client.rpc("get_professional_directory_profile", { p_slug: slug });
  if (error) throw new ProfessionalRepositoryError("get_professional_directory_profile", error);
  return data?.[0] ?? null;
}

/** F5: credenciais projetadas do perfil listado (sem digest, fonte ou ids). */
export async function listDirectoryCredentials(client: Client, slug: string) {
  const { data, error } = await client.rpc("list_professional_directory_credentials", { p_slug: slug });
  if (error) throw new ProfessionalRepositoryError("list_professional_directory_credentials", error);
  return data ?? [];
}

/** Verificacao V2: so um booleano publico (identidade conferida por fonte real). */
export async function findDirectoryIdentityVerified(client: Client, slug: string) {
  const { data, error } = await client.rpc("professional_directory_identity_verified", { p_slug: slug });
  if (error) throw new ProfessionalRepositoryError("professional_directory_identity_verified", error);
  return data === true;
}

export async function findOwnPublicProfile(client: Client, userId: string) {
  const { data, error } = await client
    .from("professional_public_profiles")
    .select(OWN_PUBLIC_PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new ProfessionalRepositoryError("professional_public_profiles.select", error);
  return data;
}

/**
 * Insere ou atualiza a linha do dono. Nao usa `upsert`: o `ON CONFLICT DO
 * UPDATE` do PostgREST reescreveria `user_id`, que nao tem privilegio de
 * update (nem deve ter).
 */
export async function saveOwnPublicProfile(client: Client, userId: string, input: PublicProfileInput) {
  const values = {
    listed: input.listed,
    display_name: input.displayName,
    bio: input.bio,
    city: input.city,
    state: input.state,
    modalities: input.modalities,
    areas: input.areas,
    languages: input.languages,
  };
  const existing = await findOwnPublicProfile(client, userId);
  const query = existing
    ? client.from("professional_public_profiles").update(values).eq("user_id", userId)
    : client.from("professional_public_profiles").insert({ user_id: userId, ...values });
  const { data, error } = await query.select(OWN_PUBLIC_PROFILE_COLUMNS).single();
  if (error) throw new ProfessionalRepositoryError("professional_public_profiles.save", error);
  return data;
}
