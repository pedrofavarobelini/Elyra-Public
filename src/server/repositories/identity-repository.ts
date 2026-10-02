import "server-only";

import {
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export class IdentityRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de identidade: ${operation}.`);
    this.name = "IdentityRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("identidade", operation, normalizada);
  }
}

export async function findProfile(client: Client, userId: string) {
  const { data, error } = await client
    .from("profiles")
    .select("user_id, display_name")
    .eq("user_id", userId)
    .single();
  if (error) throw new IdentityRepositoryError("find_profile", error);
  return data;
}

export async function findPreferences(client: Client, userId: string) {
  const { data, error } = await client
    .from("user_preferences")
    .select("user_id, checkin_reminder, goal_reminder, sessions_enabled, primary_goal")
    .eq("user_id", userId)
    .single();
  if (error) throw new IdentityRepositoryError("find_preferences", error);
  return data;
}

export async function saveProfile(
  client: Client,
  userId: string,
  displayName: string,
) {
  const { data, error } = await client
    .from("profiles")
    .update({ display_name: displayName })
    .eq("user_id", userId)
    .select("user_id, display_name")
    .single();
  if (error) throw new IdentityRepositoryError("save_profile", error);
  return data;
}

export async function savePreferences(
  client: Client,
  userId: string,
  patch: {
    checkin_reminder?: boolean;
    goal_reminder?: boolean;
    sessions_enabled?: boolean;
    primary_goal?: string | null;
  },
) {
  const { data, error } = await client
    .from("user_preferences")
    .update(patch)
    .eq("user_id", userId)
    .select("user_id, checkin_reminder, goal_reminder, sessions_enabled, primary_goal")
    .single();
  if (error) throw new IdentityRepositoryError("save_preferences", error);
  return data;
}

export async function appendAudit(
  client: Client,
  input: {
    actorUserId: string;
    action: string;
    entityType: string;
    entityId: string | null;
    correlationId: string;
    outcome?: "success" | "denied" | "failure";
  },
) {
  const { error } = await client.from("audit_logs").insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId,
    outcome: input.outcome ?? "success",
    correlation_id: input.correlationId,
  });
  if (error) throw new IdentityRepositoryError("append_audit", error);
}

/**
 * Registra a intencao de consentimento do cadastro, antes da confirmacao.
 *
 * Chamada **sem sessao**: com `enable_confirmations`, `signUp` devolve usuario e
 * nenhuma sessao, e a RLS de `consent_events` recusa — corretamente. A RPC e
 * `security definer` e so aceita conta recem-criada e ainda nao confirmada; os
 * guardas vivem no banco, e nao aqui, porque aqui eles seriam contornaveis.
 *
 * Devolve `false` quando a janela nao se aplica. Isso **nao** e erro: significa
 * que aquele caminho nao deveria gerar pendencia.
 */
export async function recordPendingConsent(
  client: Client,
  input: { userId: string; purpose: string; documentVersion: string },
): Promise<boolean> {
  const { data, error } = await client.rpc("record_pending_consent", {
    p_user_id: input.userId,
    p_purpose: input.purpose,
    p_document_version: input.documentVersion,
  });
  if (error) throw new IdentityRepositoryError("record_pending_consent", error);
  return data === true;
}

/**
 * Transforma pendencia em historico, no primeiro acesso autenticado.
 *
 * Idempotente por reivindicacao dentro do banco: chamar duas vezes devolve `0`
 * na segunda. Por isso pode ser chamada em todo nascimento de sessao — login e
 * callback — sem risco de duplicar consentimento.
 */
export async function materializePendingConsents(
  client: Client,
): Promise<number> {
  const { data, error } = await client.rpc("materialize_pending_consents");
  if (error) {
    throw new IdentityRepositoryError("materialize_pending_consents", error);
  }
  return data ?? 0;
}

export async function appendConsentGrant(
  client: Client,
  input: {
    userId: string;
    purpose: string;
    documentVersion: string;
  },
) {
  const { data, error } = await client
    .from("consent_events")
    .insert({
      user_id: input.userId,
      purpose: input.purpose,
      document_version: input.documentVersion,
      event_type: "granted",
    })
    .select("id")
    .single();
  if (error) throw new IdentityRepositoryError("append_consent_grant", error);
  return data;
}
