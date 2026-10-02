import "server-only";

import {
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type TranscriptInsert =
  Database["public"]["Tables"]["session_transcripts"]["Insert"];
type FeatureInsert = Database["public"]["Tables"]["derived_features"]["Insert"];
type InterpretationInsert =
  Database["public"]["Tables"]["session_interpretations"]["Insert"];



export class SessionAnalysisRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de analise de sessao: ${operation}.`);
    this.name = "SessionAnalysisRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("analise_sessao", operation, normalizada);
  }
}

/** `23505` — unique. E como a idempotencia duravel aparece. */
export const UNIQUE_VIOLATION = "23505";

const TRANSCRIPT_FIELDS =
  "id,session_id,user_id,status,language,source,asr_model,asr_quantization,asr_runtime,asr_runtime_version,asr_vad,extractor_version,content,word_count,voiced_duration_ms,truncated,unavailable_reason,created_at,updated_at,deleted_at" as const;
const FEATURE_FIELDS =
  "id,session_id,user_id,signal_name,unit,value,status,personal_baseline_mean,personal_baseline_samples,delta_vs_personal_baseline,coverage_ms,coverage_outcome,extractor_version,created_at,updated_at" as const;
const COVERAGE_FIELDS =
  "id,session_id,user_id,modality,outcome,reason,coverage_ms,session_duration_ms,extractor_version,created_at,updated_at" as const;
const INTERPRETATION_FIELDS =
  "id,session_id,user_id,contract_version,signals_schema_version,correlation_id,request_fingerprint,provider_used,model,payload,created_at" as const;

// ---------------------------------------------------------------------------
// Transcricao
// ---------------------------------------------------------------------------

export async function findSessionTranscript(client: Client, sessionId: string) {
  const { data, error } = await client
    .from("session_transcripts")
    .select(TRANSCRIPT_FIELDS)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) {
    throw new SessionAnalysisRepositoryError("find_transcript", error);
  }
  return data;
}

/**
 * Grava a transcricao da sessao.
 *
 * `session_id` e unico, entao reprocessar a mesma sessao **atualiza** em vez de
 * criar uma segunda transcricao. O trigger de contrato ja garante que uma
 * transcricao apagada nao volta a existir por update.
 */
export async function upsertSessionTranscript(
  client: Client,
  input: TranscriptInsert,
) {
  const { data, error } = await client
    .from("session_transcripts")
    .upsert(input, { onConflict: "session_id" })
    .select(TRANSCRIPT_FIELDS)
    .single();
  if (error) {
    throw new SessionAnalysisRepositoryError("upsert_transcript", error);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Sinais derivados
// ---------------------------------------------------------------------------

export async function findSessionFeatures(client: Client, sessionId: string) {
  const { data, error } = await client
    .from("derived_features")
    .select(FEATURE_FIELDS)
    .eq("session_id", sessionId)
    .order("signal_name", { ascending: true });
  if (error) {
    throw new SessionAnalysisRepositoryError("find_features", error);
  }
  return data ?? [];
}

/**
 * Historico do proprio usuario, para a baseline pessoal.
 *
 * Exclui a sessao corrente de proposito: comparar uma sessao consigo mesma
 * produziria delta zero e uma falsa sensacao de normalidade. Rows sem valor nao
 * entram — `NULL` nao e zero, e uma captura que nao aconteceu nao pode puxar a
 * media da pessoa para baixo.
 */
export async function findSignalHistory(
  client: Client,
  userId: string,
  excludeSessionId: string,
) {

  const { data, error } = await client
    .from("derived_features")
    .select("signal_name,value,coverage_outcome")
    .eq("user_id", userId)
    .neq("session_id", excludeSessionId)
    .not("value", "is", null)
    .order("created_at", { ascending: false })
    .limit(540);
  if (error) {
    throw new SessionAnalysisRepositoryError("find_history", error);
  }
  return data ?? [];
}

export async function upsertDerivedFeatures(
  client: Client,
  input: FeatureInsert[],
) {
  if (input.length === 0) return [];
  const { data, error } = await client
    .from("derived_features")
    .upsert(input, { onConflict: "session_id,signal_name" })
    .select(FEATURE_FIELDS);
  if (error) {
    throw new SessionAnalysisRepositoryError("upsert_features", error);
  }
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Interpretacao
// ---------------------------------------------------------------------------

export async function findInterpretationByFingerprint(
  client: Client,
  sessionId: string,
  fingerprint: string,
) {
  const { data, error } = await client
    .from("session_interpretations")
    .select(INTERPRETATION_FIELDS)
    .eq("session_id", sessionId)
    .eq("request_fingerprint", fingerprint)
    .maybeSingle();
  if (error) {
    throw new SessionAnalysisRepositoryError("find_interpretation", error);
  }
  return data;
}

export async function findLatestInterpretation(
  client: Client,
  sessionId: string,
) {
  const { data, error } = await client
    .from("session_interpretations")
    .select(INTERPRETATION_FIELDS)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new SessionAnalysisRepositoryError("latest_interpretation", error);
  }
  return data;
}

/**
 * Insere a interpretacao. Devolve `null` em violacao de unique.
 *
 * Reprocessar a mesma sessao com o mesmo payload nao e erro: e replay. Quem
 * chama le a linha existente e devolve o mesmo resultado. A tabela e append-only
 * por trigger, entao nao existe caminho de update para "corrigir" o replay.
 */
export async function insertSessionInterpretation(
  client: Client,
  input: InterpretationInsert,
) {
  const { data, error } = await client
    .from("session_interpretations")
    .insert(input)
    .select(INTERPRETATION_FIELDS)
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    throw new SessionAnalysisRepositoryError("insert_interpretation", error);
  }
  return data;
}

export type SessionTranscriptRow = NonNullable<
  Awaited<ReturnType<typeof findSessionTranscript>>
>;
export type DerivedFeatureRow = Awaited<
  ReturnType<typeof findSessionFeatures>
>[number];
export type SessionInterpretationRow = NonNullable<
  Awaited<ReturnType<typeof findLatestInterpretation>>
>;

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

type CoverageInsert =
  Database["public"]["Tables"]["session_modality_coverage"]["Insert"];

export async function findSessionCoverage(client: Client, sessionId: string) {
  const { data, error } = await client
    .from("session_modality_coverage")
    .select(COVERAGE_FIELDS)
    .eq("session_id", sessionId)
    .order("modality", { ascending: true });
  if (error) {
    throw new SessionAnalysisRepositoryError("find_coverage", error);
  }
  return data ?? [];
}

export async function upsertSessionCoverage(
  client: Client,
  input: CoverageInsert[],
) {
  if (input.length === 0) return [];
  const { data, error } = await client
    .from("session_modality_coverage")
    .upsert(input, { onConflict: "session_id,modality" })
    .select(COVERAGE_FIELDS);
  if (error) {
    throw new SessionAnalysisRepositoryError("upsert_coverage", error);
  }
  return data ?? [];
}

export type SessionCoverageRow = Awaited<
  ReturnType<typeof findSessionCoverage>
>[number];

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

type WindowInsert =
  Database["public"]["Tables"]["session_signal_windows"]["Insert"];
type SegmentInsert =
  Database["public"]["Tables"]["session_transcript_segments"]["Insert"];

const WINDOW_FIELDS =
  "id,session_id,user_id,signal_name,start_offset_ms,end_offset_ms,value,extractor_version,retention_until,created_at" as const;
const SEGMENT_FIELDS =
  "id,session_id,user_id,segment_index,content,start_offset_ms,recognized_at_offset_ms,speaker,extractor_version,retention_until,created_at" as const;

export async function findSignalWindows(client: Client, sessionId: string) {
  const { data, error } = await client
    .from("session_signal_windows")
    .select(WINDOW_FIELDS)
    .eq("session_id", sessionId)
    .order("start_offset_ms", { ascending: true })
    .order("signal_name", { ascending: true });
  if (error) throw new SessionAnalysisRepositoryError("find_windows", error);
  return data ?? [];
}

/**
 * Reescreve as janelas da sessao.
 *
 * `delete` seguido de `insert`, e nao `upsert`: reprocessar com uma janela a
 * menos precisa **remover** a janela que sobrou. Um upsert deixaria a antiga
 * viva, e a serie passaria a descrever uma sessao que nao existe mais.
 */
export async function replaceSignalWindows(
  client: Client,
  sessionId: string,
  input: WindowInsert[],
) {
  const { error: clearError } = await client
    .from("session_signal_windows")
    .delete()
    .eq("session_id", sessionId);
  if (clearError) {
    throw new SessionAnalysisRepositoryError("clear_windows", clearError);
  }
  if (input.length === 0) return [];
  const { data, error } = await client
    .from("session_signal_windows")
    .insert(input)
    .select(WINDOW_FIELDS);
  if (error) throw new SessionAnalysisRepositoryError("insert_windows", error);
  return data ?? [];
}

export async function findTranscriptSegments(client: Client, sessionId: string) {
  const { data, error } = await client
    .from("session_transcript_segments")
    .select(SEGMENT_FIELDS)
    .eq("session_id", sessionId)
    .order("segment_index", { ascending: true });
  if (error) throw new SessionAnalysisRepositoryError("find_segments", error);
  return data ?? [];
}

export async function replaceTranscriptSegments(
  client: Client,
  sessionId: string,
  input: SegmentInsert[],
) {
  const { error: clearError } = await client
    .from("session_transcript_segments")
    .delete()
    .eq("session_id", sessionId);
  if (clearError) {
    throw new SessionAnalysisRepositoryError("clear_segments", clearError);
  }
  if (input.length === 0) return [];
  const { data, error } = await client
    .from("session_transcript_segments")
    .insert(input)
    .select(SEGMENT_FIELDS);
  if (error) throw new SessionAnalysisRepositoryError("insert_segments", error);
  return data ?? [];
}

export type SignalWindowRow = Awaited<ReturnType<typeof findSignalWindows>>[number];
export type TranscriptSegmentRow = Awaited<
  ReturnType<typeof findTranscriptSegments>
>[number];

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

type SelfReportInsert =
  Database["public"]["Tables"]["session_self_reports"]["Insert"];

const SELF_REPORT_FIELDS =
  "id,session_id,user_id,mood,perceived_anxiety,energy,created_at,updated_at" as const;

export async function findSessionSelfReport(client: Client, sessionId: string) {
  const { data, error } = await client
    .from("session_self_reports")
    .select(SELF_REPORT_FIELDS)
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw new SessionAnalysisRepositoryError("find_self_report", error);
  return data;
}

export async function upsertSessionSelfReport(
  client: Client,
  input: SelfReportInsert,
) {
  const { data, error } = await client
    .from("session_self_reports")
    .upsert(input, { onConflict: "session_id" })
    .select(SELF_REPORT_FIELDS)
    .single();
  if (error) throw new SessionAnalysisRepositoryError("upsert_self_report", error);
  return data;
}

export type SessionSelfReportRow = NonNullable<
  Awaited<ReturnType<typeof findSessionSelfReport>>
>;
