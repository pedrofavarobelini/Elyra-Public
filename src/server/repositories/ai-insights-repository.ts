import "server-only";

import {
  SEM_RESULTADO,
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type InsightInsert = Database["public"]["Tables"]["ai_insights"]["Insert"];

export class AiInsightsRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de insights: ${operation}.`);
    this.name = "AiInsightsRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("insights", operation, normalizada);
  }
}

export async function findOwnedReportSnapshot(
  client: Client,
  userId: string,
  snapshotId: string,
) {
  const { data, error } = await client
    .from("report_snapshots")
    .select("id, user_id, payload")
    .eq("id", snapshotId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new AiInsightsRepositoryError("find_snapshot", error);
  return data;
}

export async function findInsightByIdempotency(
  client: Client,
  userId: string,
  idempotencyFingerprint: string,
) {
  const { data, error } = await client
    .from("ai_insights")
    .select(
      "id, user_id, report_snapshot_id, contract_version, output_schema_version, operation, correlation_id, idempotency_key_fingerprint, request_fingerprint, provider_used, model, fallback_used, output, created_at",
    )
    .eq("user_id", userId)
    .eq("idempotency_key_fingerprint", idempotencyFingerprint)
    .maybeSingle();
  if (error) throw new AiInsightsRepositoryError("find_idempotency", error);
  return data;
}

export async function setAiInferenceConsent(
  client: Client,
  enabled: boolean,
) {
  const { data, error } = await client.rpc("set_ai_inference_consent", {
    enabled,
  });
  if (error) throw new AiInsightsRepositoryError("set_consent", error);
  return data;
}

export async function insertAiInsight(client: Client, input: InsightInsert) {
  const { data, error } = await client
    .from("ai_insights")
    .insert(input)
    .select(
      "id, user_id, report_snapshot_id, contract_version, output_schema_version, operation, correlation_id, idempotency_key_fingerprint, request_fingerprint, provider_used, model, fallback_used, output, created_at",
    )
    .single();
  // Insercao propria: zero linhas nao e ausencia, e anomalia (a politica de
  // leitura escondendo o que acabou de ser gravado). Causa propria no log (L-051).
  if (error) throw new AiInsightsRepositoryError("insert_insight", error.code);
  if (!data) throw new AiInsightsRepositoryError("insert_insight", SEM_RESULTADO.code);
  return data;
}
