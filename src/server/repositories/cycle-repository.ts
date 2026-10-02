import "server-only";

import {
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";
import { chunkIds } from "./id-chunks";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type ProfileRow = Database["public"]["Tables"]["cycle_profiles"]["Row"];
type PeriodRow = Database["public"]["Tables"]["cycle_periods"]["Row"];
type RecordRow = Database["public"]["Tables"]["cycle_daily_records"]["Row"];
type SymptomRow = Database["public"]["Tables"]["cycle_symptoms"]["Row"];

export class CycleRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de ciclo: ${operation}.`);
    this.name = "CycleRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("ciclo", operation, normalizada);
  }
}

export async function findCycleProfile(client: Client, userId: string) {
  const { data, error } = await client
    .from("cycle_profiles")
    .select("user_id, enabled, opted_in_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new CycleRepositoryError("find_profile", error);
  return data satisfies ProfileRow | null;
}

export async function listCyclePeriods(client: Client, userId: string) {
  const { data, error } = await client
    .from("cycle_periods")
    .select("id, user_id, start_date, end_date, created_at, updated_at")
    .eq("user_id", userId)
    .order("start_date", { ascending: true });
  if (error) throw new CycleRepositoryError("list_periods", error);
  return data satisfies PeriodRow[];
}

export async function listCycleRecords(client: Client, userId: string, since?: string) {
  const query = client
    .from("cycle_daily_records")
    .select("id, user_id, record_date, flow, note, created_at, updated_at")
    .eq("user_id", userId)
    .order("record_date", { ascending: true });
  const { data, error } = await (since ? query.gte("record_date", since) : query);
  if (error) throw new CycleRepositoryError("list_records", error);
  return data satisfies RecordRow[];
}

export async function countCycleRecordsBefore(client: Client, userId: string, since: string) {
  const { count, error } = await client
    .from("cycle_daily_records")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .lt("record_date", since);
  if (error) throw new CycleRepositoryError("count_records_before", error);
  return count ?? 0;
}

export async function listCycleRecordsBefore(
  client: Client,
  userId: string,
  before: string,
  limit: number,
) {
  const { data, error } = await client
    .from("cycle_daily_records")
    .select("id, user_id, record_date, flow, note, created_at, updated_at")
    .eq("user_id", userId)
    .lt("record_date", before)
    .order("record_date", { ascending: false })
    .limit(limit);
  if (error) throw new CycleRepositoryError("list_records_before", error);
  return data satisfies RecordRow[];
}

export async function listCycleSymptoms(client: Client) {
  const { data, error } = await client
    .from("cycle_symptoms")
    .select("id, label, origin, owner_user_id, created_at")
    .order("origin", { ascending: false })
    .order("label", { ascending: true });
  if (error) throw new CycleRepositoryError("list_symptoms", error);
  return data satisfies SymptomRow[];
}

export async function listCycleDailySymptoms(client: Client, recordIds: string[]) {
  const rows: { record_id: string; symptom_id: string; severity: string }[] = [];
  for (const chunk of chunkIds(recordIds)) {
    const { data, error } = await client
      .from("cycle_daily_symptoms")
      .select("record_id, symptom_id, severity")
      .in("record_id", chunk);
    if (error) throw new CycleRepositoryError("list_daily_symptoms", error);
    rows.push(...data);
  }
  return rows;
}

export async function setCycleEnabled(client: Client, enabled: boolean) {
  const { data, error } = await client.rpc("set_cycle_enabled", {
    p_enabled: enabled,
  });
  if (error) throw new CycleRepositoryError("set_enabled", error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new CycleRepositoryError("set_enabled", { code: "empty_result", message: "a funcao nao devolveu linha" });
  }
  return data;
}

export async function persistCyclePeriod(client: Client, payload: Json) {
  const { data, error } = await client.rpc("save_cycle_period", {
    p_payload: payload,
  });
  if (error) throw new CycleRepositoryError("save_period", error);
  if (!data) throw new CycleRepositoryError("save_period", { code: "empty_result", message: "a funcao nao devolveu linha" });
  return data;
}

export async function findCyclePeriod(client: Client, userId: string, id: string) {
  const { data, error } = await client
    .from("cycle_periods")
    .select("id, user_id, start_date, end_date, created_at, updated_at")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new CycleRepositoryError("find_period", error);
  return data satisfies PeriodRow | null;
}

export async function removeCyclePeriod(client: Client, userId: string, id: string) {
  const { data, error } = await client
    .from("cycle_periods")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  // `error` e falha real do banco; `!data` e zero linhas — inclusive linha de
  // outra pessoa, invisivel pela RLS. Quem decide o status e o servico (L-051).
  if (error) throw new CycleRepositoryError("delete_period", error);
  return data ? data.id : null;
}

export async function persistCycleRecord(client: Client, payload: Json) {
  const { data, error } = await client.rpc("save_cycle_daily_record", {
    p_payload: payload,
  });
  if (error) throw new CycleRepositoryError("save_record", error);
  if (!data) throw new CycleRepositoryError("save_record", { code: "empty_result", message: "a funcao nao devolveu linha" });
  return data;
}

export async function findCycleRecord(client: Client, userId: string, id: string) {
  const { data, error } = await client
    .from("cycle_daily_records")
    .select("id, user_id, record_date, flow, note, created_at, updated_at")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new CycleRepositoryError("find_record", error);
  return data satisfies RecordRow | null;
}

export async function findCycleRecordByDate(client: Client, userId: string, date: string) {
  const { data, error } = await client
    .from("cycle_daily_records")
    .select("id, user_id, record_date, flow, note, created_at, updated_at")
    .eq("user_id", userId)
    .eq("record_date", date)
    .maybeSingle();
  if (error) throw new CycleRepositoryError("find_record_by_date", error);
  return data satisfies RecordRow | null;
}

export async function removeCycleRecord(
  client: Client,
  userId: string,
  date: string,
) {
  const { data, error } = await client
    .from("cycle_daily_records")
    .delete()
    .eq("user_id", userId)
    .eq("record_date", date)
    .select("id")
    .maybeSingle();
  if (error) throw new CycleRepositoryError("delete_record", error);
  return data ? data.id : null;
}

export async function createCustomCycleSymptom(
  client: Client,
  userId: string,
  label: string,
) {
  const findExisting = async () => {
    const { data, error } = await client
      .from("cycle_symptoms")
      .select("id, label, origin, owner_user_id, created_at")
      .eq("owner_user_id", userId)
      .eq("origin", "custom");
    if (error) throw new CycleRepositoryError("find_custom_symptom", error);
    return data.find(
      (symptom) => symptom.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
  };

  const existing = await findExisting();
  if (existing) return existing satisfies SymptomRow;

  const { data, error } = await client
    .from("cycle_symptoms")
    .insert({ label, origin: "custom", owner_user_id: userId })
    .select("id, label, origin, owner_user_id, created_at")
    .single();
  if (error) {
    const concurrent = await findExisting();
    if (concurrent) return concurrent satisfies SymptomRow;
    throw new CycleRepositoryError("create_custom_symptom", error);
  }
  return data satisfies SymptomRow;
}

export async function deleteAllCycleData(client: Client) {
  const { data, error } = await client.rpc("delete_cycle_data");
  if (error) throw new CycleRepositoryError("delete_all_data", error);
  if (!data) throw new CycleRepositoryError("delete_all_data", { code: "empty_result", message: "a funcao nao devolveu linha" });
  return data;
}
