import "server-only";

import {
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type SessionInsert = Database["public"]["Tables"]["multimodal_sessions"]["Insert"];
type AssetInsert = Database["public"]["Tables"]["media_assets"]["Insert"];
type JobInsert = Database["public"]["Tables"]["processing_jobs"]["Insert"];

export class MultimodalRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio multimodal: ${operation}.`);
    this.name = "MultimodalRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("multimodal", operation, normalizada);
  }
}

const SESSION_FIELDS =
  "id,user_id,kind,status,screen_consent,camera_consent,microphone_consent,transcription_consent,visual_analysis_consent,storage_consent,ai_analysis_consent,share_result_consent,share_transcript_consent,share_original_consent,training_eligibility_consent,started_at,ended_at,created_at,updated_at,professional_session_id" as const;
const ASSET_FIELDS =
  "id,session_id,user_id,media_kind,storage_path,mime_type,size_bytes,duration_ms,checksum_sha256,retention_until,status,created_at,updated_at,deleted_at" as const;

export async function findMultimodalSessions(client: Client, userId: string) {
  const { data, error } = await client
    .from("multimodal_sessions")
    .select(SESSION_FIELDS)
    .eq("user_id", userId)
    .neq("status", "deleted")
    .order("started_at", { ascending: false });
  if (error) throw new MultimodalRepositoryError("find_sessions", error);
  return data;
}

export async function findMultimodalSession(
  client: Client,
  sessionId: string,
) {
  const { data, error } = await client
    .from("multimodal_sessions")
    .select(SESSION_FIELDS)
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new MultimodalRepositoryError("find_session", error);
  return data;
}

export async function findSessionAssets(client: Client, sessionId: string) {
  const { data, error } = await client
    .from("media_assets")
    .select(ASSET_FIELDS)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw new MultimodalRepositoryError("find_assets", error);
  return data;
}

export async function insertMultimodalSession(
  client: Client,
  input: SessionInsert,
) {
  const { data, error } = await client
    .from("multimodal_sessions")
    .insert(input)
    .select(SESSION_FIELDS)
    .single();
  if (error) throw new MultimodalRepositoryError("insert_session", error);
  return data;
}

export async function updateMultimodalSession(
  client: Client,
  sessionId: string,
  patch: { status: string; ended_at?: string | null },
) {
  const { data, error } = await client
    .from("multimodal_sessions")
    .update(patch)
    .eq("id", sessionId)
    .select(SESSION_FIELDS)
    .single();
  if (error) throw new MultimodalRepositoryError("update_session", error);
  return data;
}

export async function insertMediaAsset(client: Client, input: AssetInsert) {
  const { data, error } = await client
    .from("media_assets")
    .insert(input)
    .select(ASSET_FIELDS)
    .single();
  if (error) throw new MultimodalRepositoryError("insert_asset", error);
  return data;
}

export async function updateMediaAsset(
  client: Client,
  assetId: string,
  patch: { status: string; deleted_at?: string | null },
) {
  const { data, error } = await client
    .from("media_assets")
    .update(patch)
    .eq("id", assetId)
    .select(ASSET_FIELDS)
    .single();
  if (error) throw new MultimodalRepositoryError("update_asset", error);
  return data;
}

export async function findMediaAsset(client: Client, assetId: string) {
  const { data, error } = await client
    .from("media_assets")
    .select(ASSET_FIELDS)
    .eq("id", assetId)
    .maybeSingle();
  if (error) throw new MultimodalRepositoryError("find_asset", error);
  return data;
}

/**
 * Apaga **um** asset, e nao os da sessao.
 *
 * Existe ao lado de `deleteSessionAssets` de proposito: apagar a gravacao de
 * uma sessao que continua valida e apagar tudo o que a sessao guardava sao
 * decisoes diferentes, e reaproveitar a segunda para fazer a primeira
 * significaria filtrar por id **depois** de escrever uma consulta que fala em
 * sessao. A RLS (`media_assets_delete_own`) e quem garante a posse.
 */
export async function deleteMediaAsset(client: Client, assetId: string) {
  const { error } = await client
    .from("media_assets")
    .delete()
    .eq("id", assetId);
  if (error) throw new MultimodalRepositoryError("delete_asset", error);
}

export async function deleteSessionAssets(client: Client, sessionId: string) {
  const { error } = await client
    .from("media_assets")
    .delete()
    .eq("session_id", sessionId);
  if (error) throw new MultimodalRepositoryError("delete_assets", error);
}

export async function insertProcessingJob(client: Client, input: JobInsert) {
  const { data, error } = await client
    .from("processing_jobs")
    .insert(input)
    .select("id,status")
    .single();
  if (error) throw new MultimodalRepositoryError("insert_job", error);
  return data;
}

export async function updateProcessingJob(
  client: Client,
  jobId: string,
  patch: {
    status: string;
    attempts?: number;
    error_code?: string | null;
    started_at?: string | null;
    finished_at?: string | null;
  },
) {
  const { error } = await client
    .from("processing_jobs")
    .update(patch)
    .eq("id", jobId);
  if (error) throw new MultimodalRepositoryError("update_job", error);
}

export async function cancelActiveSessionJobs(
  client: Client,
  sessionId: string,
) {
  const now = new Date().toISOString();
  const { error } = await client
    .from("processing_jobs")
    .update({ status: "cancelled", finished_at: now, error_code: null })
    .eq("session_id", sessionId)
    .in("status", ["queued", "running", "cancel_requested"]);
  if (error) throw new MultimodalRepositoryError("cancel_jobs", error);
}
