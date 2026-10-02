import "server-only";

import {
  SEM_RESULTADO,
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type LearningExportInsert =
  Database["public"]["Tables"]["learning_exports"]["Insert"];
type LearningExportUpdate =
  Database["public"]["Tables"]["learning_exports"]["Update"];

const EXPORT_COLUMNS =
  "id, user_id, report_snapshot_id, contract_version, export_schema_version, policy_version, source_schema_version, analytics_version, fingerprint, status, rejection_code, quality_passed, candidate_id, candidate_lifecycle, correlation_id, training_consent_event_id, produced_at, exported_at, revoked_at, revocation_reason, created_at, updated_at";

export class LearningRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de learning: ${operation}.`);
    this.name = "LearningRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("learning", operation, normalizada);
  }
}

/** `23505` — violacao de unique. E como a idempotencia duravel se manifesta. */
export const UNIQUE_VIOLATION = "23505";

export async function isTrainingConsentActive(client: Client, userId: string) {
  const { data, error } = await client.rpc("training_consent_active", {
    p_user_id: userId,
  });
  if (error) throw new LearningRepositoryError("consent_active", error);
  return data === true;
}

export async function setTrainingConsent(client: Client, enabled: boolean) {
  const { data, error } = await client.rpc("set_training_consent", { enabled });
  if (error) throw new LearningRepositoryError("set_consent", error);
  return data;
}

export async function findOwnedSnapshot(
  client: Client,
  userId: string,
  snapshotId: string,
) {
  const { data, error } = await client
    .from("report_snapshots")
    .select("id, user_id, payload, created_at")
    .eq("id", snapshotId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new LearningRepositoryError("find_snapshot", error);
  return data;
}

export async function findExportByFingerprint(
  client: Client,
  userId: string,
  fingerprint: string,
) {
  const { data, error } = await client
    .from("learning_exports")
    .select(EXPORT_COLUMNS)
    .eq("user_id", userId)
    .eq("fingerprint", fingerprint)
    .maybeSingle();
  if (error) throw new LearningRepositoryError("find_fingerprint", error);
  return data;
}

export async function findExportBySnapshot(
  client: Client,
  userId: string,
  snapshotId: string,
) {
  const { data, error } = await client
    .from("learning_exports")
    .select(EXPORT_COLUMNS)
    .eq("user_id", userId)
    .eq("report_snapshot_id", snapshotId)
    .maybeSingle();
  if (error) throw new LearningRepositoryError("find_snapshot_export", error);
  return data;
}

export async function listExports(client: Client, userId: string) {
  const { data, error } = await client
    .from("learning_exports")
    .select(EXPORT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new LearningRepositoryError("list_exports", error);
  return data ?? [];
}

/**
 * Insere o registro de governanca.
 *
 * Devolve `null` em violacao de unique em vez de lancar: exportar de novo o
 * mesmo conteudo governado nao e erro, e replay. Quem chama le o registro
 * existente e devolve o mesmo resultado.
 */
export async function insertExport(
  client: Client,
  input: LearningExportInsert,
) {
  const { data, error } = await client
    .from("learning_exports")
    .insert(input)
    .select(EXPORT_COLUMNS)
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return null;
    throw new LearningRepositoryError("insert_export", error);
  }
  return data;
}

export async function updateExport(
  client: Client,
  exportId: string,
  userId: string,
  patch: LearningExportUpdate,
) {
  const { data, error } = await client
    .from("learning_exports")
    .update(patch)
    .eq("id", exportId)
    .eq("user_id", userId)
    .select(EXPORT_COLUMNS)
    .single();
  /*
    Fluxo interno de contribuicao: a posse do export ja foi verificada antes
    desta chamada, e a clausula filtra por `user_id`. Zero linhas aqui nao e
    recusa de rotina — e o export ter desaparecido no meio do caminho. Continua
    500, mas com causa distinguivel no log em vez de "falha de banco" (L-051).
  */
  if (error) throw new LearningRepositoryError("update_export", error.code);
  if (!data) throw new LearningRepositoryError("update_export", SEM_RESULTADO.code);
  return data;
}

export type LearningExportRow = NonNullable<
  Awaited<ReturnType<typeof findExportByFingerprint>>
>;
