import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";
import { normalizarCausa, registrarFalhaDeRepositorio, SEM_RESULTADO } from "./repository-error";

type Client = SupabaseClient<Database>;

/**
 * Motivos codificados que o banco usa para recusar o envio. So a frase do
 * banco que esta nesta lista vira motivo; qualquer outra e "unknown" (nada de
 * texto livre do Postgres chegando a tela).
 */
const KNOWN_REASONS = [
  "onboarding required",
  "identity confirmation required",
  "registry required",
  "already verified",
  "credential locked",
  "credential unchanged",
  "credential unavailable",
  "credential limit reached",
  "precheck replay",
  "precheck not applicable",
] as const;
export type OnboardingFailureReason = (typeof KNOWN_REASONS)[number] | "unknown";

export class OnboardingRepositoryError extends Error {
  readonly code?: string;
  readonly reason: OnboardingFailureReason;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de onboarding profissional: ${operation}.`);
    this.name = "OnboardingRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    const message = normalizada?.message ?? "";
    this.reason = KNOWN_REASONS.find((reason) => message === reason) ?? "unknown";
    registrarFalhaDeRepositorio("onboarding_profissional", operation, normalizada);
  }
}

const ONBOARDING_COLUMNS =
  "user_id,current_step,completed_steps,identity_confirmed_at,draft_council_region,draft_registration_number,draft_specialty,draft_public_profile,submitted_at,submission_count,precheck_submission,updated_at";

export async function findOnboarding(client: Client, userId: string) {
  const { data, error } = await client
    .from("professional_onboarding")
    .select(ONBOARDING_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new OnboardingRepositoryError("find_onboarding", error);
  return data;
}

export type OnboardingPatch = Partial<{
  current_step: string;
  completed_steps: string[];
  identity_confirmed_at: string;
  draft_council_region: string;
  draft_registration_number: string;
  draft_specialty: string;
  draft_public_profile: Json;
}>;

/**
 * Update-ou-insert explicito. O `upsert` do PostgREST coloca `user_id` no SET
 * do `ON CONFLICT`, e `user_id` nao tem grant de UPDATE — de proposito: a chave
 * da linha nunca muda.
 */
export async function upsertOnboarding(client: Client, userId: string, patch: OnboardingPatch) {
  const updated = await client
    .from("professional_onboarding")
    .update(patch)
    .eq("user_id", userId)
    .select(ONBOARDING_COLUMNS);
  if (updated.error) throw new OnboardingRepositoryError("update_onboarding", updated.error);
  if (updated.data?.[0]) return updated.data[0];

  const inserted = await client
    .from("professional_onboarding")
    .insert({ user_id: userId, ...patch })
    .select(ONBOARDING_COLUMNS)
    .single();
  if (inserted.error) throw new OnboardingRepositoryError("insert_onboarding", inserted.error);
  if (!inserted.data) throw new OnboardingRepositoryError("insert_onboarding", SEM_RESULTADO);
  return inserted.data;
}

export async function submitOnboarding(client: Client) {
  const { data, error } = await client.rpc("submit_professional_onboarding");
  if (error) throw new OnboardingRepositoryError("submit_onboarding", error);
  const row = data?.[0];
  if (!row) throw new OnboardingRepositoryError("submit_onboarding", SEM_RESULTADO);
  return row;
}

export async function recordPrecheck(
  client: Client,
  input: { submission: number; outcome: string; reasonCode: string },
) {
  const { data, error } = await client.rpc("record_professional_precheck", {
    p_submission: input.submission,
    p_outcome: input.outcome,
    p_reason_code: input.reasonCode,
  });
  if (error) throw new OnboardingRepositoryError("record_precheck", error);
  return data;
}

const CREDENTIAL_COLUMNS =
  "id,kind,title,institution,start_year,end_year,expires_on,trust_state,verified_at,position,created_at,updated_at";

export async function listOwnCredentials(client: Client, userId: string) {
  const { data, error } = await client
    .from("professional_credentials")
    .select(CREDENTIAL_COLUMNS)
    .eq("user_id", userId)
    .order("kind")
    .order("position")
    .order("created_at");
  if (error) throw new OnboardingRepositoryError("list_credentials", error);
  return data ?? [];
}

export type CredentialRow = Awaited<ReturnType<typeof listOwnCredentials>>[number];

export async function insertCredential(
  client: Client,
  userId: string,
  input: {
    kind: string;
    title: string;
    institution: string;
    start_year: number | null;
    end_year: number | null;
    expires_on: string | null;
  },
) {
  const { data, error } = await client
    .from("professional_credentials")
    .insert({ user_id: userId, ...input })
    .select(CREDENTIAL_COLUMNS)
    .single();
  if (error) throw new OnboardingRepositoryError("insert_credential", error);
  return data;
}

export async function updateCredential(
  client: Client,
  id: string,
  input: {
    title: string;
    institution: string;
    start_year: number | null;
    end_year: number | null;
    expires_on: string | null;
  },
) {
  const { data, error } = await client
    .from("professional_credentials")
    .update(input)
    .eq("id", id)
    .select(CREDENTIAL_COLUMNS)
    .maybeSingle();
  if (error) throw new OnboardingRepositoryError("update_credential", error);
  return data;
}

export async function deleteCredential(client: Client, id: string) {
  const { data, error } = await client.from("professional_credentials").delete().eq("id", id).select("id");
  if (error) throw new OnboardingRepositoryError("delete_credential", error);
  return (data ?? []).length > 0;
}

export async function listCredentialQueue(client: Client) {
  const { data, error } = await client.rpc("list_professional_credential_queue");
  if (error) throw new OnboardingRepositoryError("credential_queue", error);
  return data ?? [];
}

export async function reviewCredential(
  client: Client,
  input: { credentialId: string; verified: boolean; source: string | null; evidenceDigest: string | null },
) {
  const { error } = await client.rpc("review_professional_credential", {
    p_credential_id: input.credentialId,
    p_verified: input.verified,
    p_source: input.source ?? undefined,
    p_evidence_digest: input.evidenceDigest ?? undefined,
  });
  if (error) throw new OnboardingRepositoryError("review_credential", error);
}
