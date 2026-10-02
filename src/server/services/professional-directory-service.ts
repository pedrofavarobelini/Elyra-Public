import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  DIRECTORY_SLUG,
  discoveryVisibility,
  publicProfileInputSchema,
  publicProfileMissing,
  type DirectorySearch,
} from "@/lib/contracts/professional-directory";
import { consumeRateLimit, rateLimitIdentity } from "@/lib/security/rate-limit";
import type { Database } from "@/lib/supabase/database.types";
import {
  findDirectoryProfile,
  findDirectoryIdentityVerified,
  listDirectoryCredentials,
  findOwnPublicProfile,
  saveOwnPublicProfile,
  searchDirectory,
} from "@/server/repositories/professional-directory-repository";
import { ProfessionalRepositoryError } from "@/server/repositories/professional-repository";
import { getProfessionalProfile, ProfessionalAccessError } from "@/server/services/professional-service";

type Client = SupabaseClient<Database>;

/** Descoberta limitada: pelo app (resposta humana) ou pelo banco (PostgREST direto). */
export class DirectoryRateLimitedError extends Error {
  constructor() {
    super("directory_rate_limited");
    this.name = "DirectoryRateLimitedError";
  }
}

function consumeDirectoryBudget(user: User) {
  if (!consumeRateLimit("professionalDirectory", rateLimitIdentity(user.id, null)).allowed) {
    throw new DirectoryRateLimitedError();
  }
}

function mapDatabaseLimit(error: unknown): never {
  if (error instanceof ProfessionalRepositoryError && error.code === "54000") throw new DirectoryRateLimitedError();
  throw error;
}

export async function searchProfessionalDirectory(client: Client, user: User, search: DirectorySearch) {
  consumeDirectoryBudget(user);
  const rows = await searchDirectory(client, search).catch(mapDatabaseLimit);
  return {
    // `has_more` e da pagina, nao do perfil: sai de cada linha.
    results: rows.map((row) => {
      const { has_more, ...profile } = row;
      void has_more;
      return profile;
    }),
    hasMore: rows.some((row) => row.has_more),
    page: search.page,
  };
}

export type DirectoryResult = Awaited<ReturnType<typeof searchProfessionalDirectory>>["results"][number];

export async function getProfessionalDirectoryProfile(client: Client, user: User, slug: string) {
  // Slug malformado nem gasta balde nem vai ao banco: e a mesma ausencia.
  if (!DIRECTORY_SLUG.test(slug)) return null;
  consumeDirectoryBudget(user);
  return findDirectoryProfile(client, slug).catch(mapDatabaseLimit);
}

/** F6: fatos de formacao/experiencia/certificacao do perfil, com estado de confianca. */
export async function getProfessionalDirectoryCredentials(client: Client, user: User, slug: string) {
  if (!DIRECTORY_SLUG.test(slug)) return [];
  consumeDirectoryBudget(user);
  return listDirectoryCredentials(client, slug).catch(mapDatabaseLimit);
}

/** Verificacao V2: identidade conferida? Falha ou ausencia = nao mostra (nunca "verificado" por erro). */
export async function getDirectoryIdentityVerified(client: Client, slug: string) {
  if (!DIRECTORY_SLUG.test(slug)) return false;
  return findDirectoryIdentityVerified(client, slug).catch(() => false);
}

/** Perfil publico do proprio profissional + por que ele aparece ou nao. */
export async function getMyPublicProfile(client: Client, user: User) {
  const professional = await getProfessionalProfile(client, user);
  if (!professional) return null;
  const publicProfile = await findOwnPublicProfile(client, user.id);
  const view = {
    displayName: publicProfile?.display_name ?? null,
    city: publicProfile?.city ?? null,
    state: publicProfile?.state ?? null,
    modalities: publicProfile?.modalities ?? [],
    areas: publicProfile?.areas ?? [],
    languages: publicProfile?.languages ?? [],
  };
  return {
    publicProfile,
    visibility: discoveryVisibility({
      verification: professional.effective_verification_status,
      listed: publicProfile?.listed ?? false,
      missing: publicProfileMissing(view),
    }),
  };
}

export async function updateMyPublicProfile(client: Client, user: User, raw: unknown) {
  const professional = await getProfessionalProfile(client, user);
  if (!professional) throw new ProfessionalAccessError("PROFESSIONAL_PROFILE_REQUIRED");
  const input = publicProfileInputSchema.parse(raw);
  await saveOwnPublicProfile(client, user.id, input);
  return getMyPublicProfile(client, user);
}
