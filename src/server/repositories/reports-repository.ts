import "server-only";

import {
  SEM_RESULTADO,
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type SnapshotInsert =
  Database["public"]["Tables"]["report_snapshots"]["Insert"];

export class ReportsRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de relatorios: ${operation}.`);
    this.name = "ReportsRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("relatorios", operation, normalizada);
  }
}

export async function insertReportSnapshot(
  client: Client,
  input: SnapshotInsert,
) {
  const { data, error } = await client
    .from("report_snapshots")
    .insert(input)
    .select(
      "id, user_id, schema_version, analytics_version, cycle_heuristic_version, time_zone, period_start, period_end, range_days, payload, created_at",
    )
    .single();
  // Insercao propria: zero linhas e anomalia, nao ausencia (L-051).
  if (error) throw new ReportsRepositoryError("insert_snapshot", error);
  if (!data) throw new ReportsRepositoryError("insert_snapshot", SEM_RESULTADO);
  return data;
}
