import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isSessionErrorCode, type SessionErrorCode } from "@/lib/contracts/professional-sessions";
import type { Database } from "@/lib/supabase/database.types";

import { normalizarCausa, registrarFalhaDeRepositorio } from "./repository-error";

type Client = SupabaseClient<Database>;

/**
 * Sessoes profissionais (PRO-7). Toda escrita e RPC `SECURITY DEFINER`; as
 * tabelas nao tem politica de escrita. O token da credencial so existe dentro
 * de `enterSession`, em memoria, entre a emissao e a troca: nunca e devolvido,
 * logado nem guardado (o banco guarda o digest).
 */

export class SessionRuleError extends Error {
  constructor(public readonly code: SessionErrorCode) {
    super(code);
    this.name = "SessionRuleError";
  }
}

export class SessionRepositoryError extends Error {
  readonly code?: string;
  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de sessoes profissionais: ${operation}.`);
    this.name = "SessionRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("sessao_profissional", operation, normalizada);
  }
}

function fail(operation: string, error: { code?: string; message?: string }): never {
  if (isSessionErrorCode(error.message)) throw new SessionRuleError(error.message);
  throw new SessionRepositoryError(operation, error);
}

export async function listMySessions(client: Client, since: string | null) {
  const { data, error } = await client.rpc("list_my_professional_sessions", {
    p_since: since as string,
  });
  if (error) fail("list_sessions", error);
  return data ?? [];
}

export async function getSession(client: Client, id: string) {
  const { data, error } = await client.rpc("get_professional_session", { p_session_id: id });
  if (error) fail("get_session", error);
  return data?.[0] ?? null;
}

/** Emissao + troca imediata, no servidor. Devolve so o resultado da entrada. */
export async function enterSession(client: Client, id: string) {
  const issued = await client.rpc("issue_professional_session_credential", { p_session_id: id });
  if (issued.error) fail("issue_credential", issued.error);
  const entered = await client.rpc("enter_professional_session", {
    p_session_id: id,
    p_token: issued.data as string,
  });
  if (entered.error) fail("enter_session", entered.error);
  return entered.data as string;
}

export async function leaveSession(client: Client, id: string) {
  const { error } = await client.rpc("leave_professional_session", { p_session_id: id });
  if (error) fail("leave_session", error);
}

export async function completeSession(client: Client, id: string) {
  const { error } = await client.rpc("complete_professional_session", { p_session_id: id });
  if (error) fail("complete_session", error);
}

export async function setConsent(client: Client, id: string, consent: string, value: boolean) {
  const { error } = await client.rpc("set_professional_session_consent", {
    p_session_id: id,
    p_consent: consent,
    p_value: value,
  });
  if (error) fail("set_consent", error);
}

export async function readTranscriptAsProfessional(client: Client, id: string) {
  const { data, error } = await client.rpc("get_professional_session_transcript", { p_session_id: id });
  if (error) fail("read_transcript", error);
  return data?.[0] ?? null;
}

/** PRO-7R: o banco refaz todos os gates antes de o servidor emitir midia. */
export async function authorizeSessionMedia(client: Client, id: string, purpose: "join" | "heartbeat") {
  const { data, error } = await client.rpc("authorize_professional_session_media", {
    p_session_id: id,
    p_purpose: purpose,
  });
  if (error) fail("authorize_media", error);
  return data?.[0] ?? null;
}

export async function readSessionMediaGeneration(client: Client, id: string) {
  const { data, error } = await client.rpc("professional_session_media_generation", { p_session_id: id });
  if (error) fail("media_generation", error);
  return typeof data === "number" ? data : null;
}

export async function recordSessionMediaEvent(
  client: Client,
  id: string,
  event: "REALTIME_JOINED" | "REALTIME_LEFT" | "REALTIME_RECONNECT",
) {
  const { error } = await client.rpc("record_professional_session_media_event", {
    p_session_id: id,
    p_event: event,
  });
  if (error) fail("media_event", error);
}

/** As duas partes (RLS: so participante le a propria sessao). */
export async function readSessionParties(client: Client, id: string) {
  const { data, error } = await client
    .from("professional_sessions")
    .select("client_user_id, professional_user_id")
    .eq("id", id)
    .maybeSingle();
  if (error) fail("session_parties", error);
  return data;
}

/** Sessoes ainda abertas ligadas a um vinculo ou horario (RLS: participante). */
export async function listOpenSessionIdsBy(
  client: Client,
  filter: { connectionId: string } | { appointmentId: string },
) {
  let query = client.from("professional_sessions").select("id").gt("closes_at", new Date().toISOString());
  query = "connectionId" in filter ? query.eq("connection_id", filter.connectionId) : query.eq("appointment_id", filter.appointmentId);
  const { data, error } = await query;
  if (error) fail("open_sessions", error);
  return (data ?? []).map((row) => row.id);
}
