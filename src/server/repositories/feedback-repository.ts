import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "@/server/repositories/repository-error";

type Client = SupabaseClient<Database>;

export type SessionFeedbackRow =
  Database["public"]["Tables"]["session_feedback"]["Row"];
export type TranscriptCorrectionRow =
  Database["public"]["Tables"]["transcript_corrections"]["Row"];

const FEEDBACK_FIELDS =
  "id,session_id,user_id,target_type,target_id,rating,reason,created_at,updated_at" as const;
const CORRECTION_FIELDS =
  "id,session_id,user_id,transcript_id,original_content,corrected_content,original_source,revision,training_eligible,created_at,updated_at,revoked_at" as const;

export class FeedbackRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de feedback: ${operation}.`);
    this.name = "FeedbackRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("feedback", operation, normalizada);
  }
}

/** `42501` — a RLS recusou. E como "nao e seu" chega ate aqui. */
export const INSUFFICIENT_PRIVILEGE = "42501";



export async function findSessionFeedback(
  client: Client,
  sessionId: string,
): Promise<SessionFeedbackRow[]> {
  const { data, error } = await client
    .from("session_feedback")
    .select(FEEDBACK_FIELDS)
    .eq("session_id", sessionId);
  if (error) throw new FeedbackRepositoryError("find_feedback", error);
  return data ?? [];
}

export async function upsertSessionFeedback(
  client: Client,
  input: Database["public"]["Tables"]["session_feedback"]["Insert"],
): Promise<SessionFeedbackRow> {
  /*
    Uma avaliacao por alvo por pessoa: trocar de ideia ATUALIZA a linha em vez de
    acrescentar outra. Acumular votos transformaria insistencia em peso.
  */
  const { data, error } = await client
    .from("session_feedback")
    .upsert(input, { onConflict: "user_id,session_id,target_type" })
    .select(FEEDBACK_FIELDS)
    .single();
  if (error) throw new FeedbackRepositoryError("upsert_feedback", error);
  return data;
}

export async function deleteSessionFeedback(
  client: Client,
  sessionId: string,
  targetType: string,
): Promise<void> {
  const { error } = await client
    .from("session_feedback")
    .delete()
    .eq("session_id", sessionId)
    .eq("target_type", targetType);
  if (error) throw new FeedbackRepositoryError("delete_feedback", error);
}

export async function findTranscriptCorrections(
  client: Client,
  sessionId: string,
): Promise<TranscriptCorrectionRow[]> {
  const { data, error } = await client
    .from("transcript_corrections")
    .select(CORRECTION_FIELDS)
    .eq("session_id", sessionId)
    .order("revision", { ascending: false });
  if (error) throw new FeedbackRepositoryError("find_corrections", error);
  return data ?? [];
}

export async function insertTranscriptCorrection(
  client: Client,
  input: Database["public"]["Tables"]["transcript_corrections"]["Insert"],
): Promise<TranscriptCorrectionRow> {
  const { data, error } = await client
    .from("transcript_corrections")
    .insert(input)
    .select(CORRECTION_FIELDS)
    .single();
  if (error) throw new FeedbackRepositoryError("insert_correction", error);
  return data;
}

/**
 * Revoga a correcao sem apaga-la.
 *
 * `update` de `revoked_at`, e nao `delete`: o rastro de que houve correcao e
 * informacao, e uma exportacao futura precisa saber o que foi revogado para
 * respeitar a revogacao — o que ela nao conseguiria fazer com uma linha que
 * simplesmente sumiu.
 */
export async function revokeTranscriptCorrection(
  client: Client,
  sessionId: string,
  revision: number,
): Promise<void> {
  const { error } = await client
    .from("transcript_corrections")
    .update({ revoked_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("revision", revision);
  if (error) throw new FeedbackRepositoryError("revoke_correction", error);
}
