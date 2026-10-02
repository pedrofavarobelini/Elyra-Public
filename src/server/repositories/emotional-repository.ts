import "server-only";

import {
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";
import { chunkIds } from "./id-chunks";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type CheckinRow = Database["public"]["Tables"]["emotional_checkins"]["Row"];
type FactorRow = Database["public"]["Tables"]["emotional_factors"]["Row"];
type SleepRow = Database["public"]["Tables"]["sleep_records"]["Row"];

export class EmotionalRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio emocional: ${operation}.`);
    this.name = "EmotionalRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("emocional", operation, normalizada);
  }
}


export async function listCheckins(client: Client, userId: string, since?: string) {
  const query = client
    .from("emotional_checkins")
    .select(
      "id, user_id, occurred_at, mood_score, perceived_anxiety_score, energy_score, primary_feeling, note, created_at",
    )
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false });
  const { data, error } = await (since ? query.gte("occurred_at", since) : query);
  if (error) throw new EmotionalRepositoryError("list_checkins", error);
  return data satisfies CheckinRow[];
}

/** Quantos check-ins existem **antes** da janela. Conta no banco, sem trazer linha. */
export async function countCheckinsBefore(client: Client, userId: string, since: string) {
  const { count, error } = await client
    .from("emotional_checkins")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .lt("occurred_at", since);
  if (error) throw new EmotionalRepositoryError("count_checkins_before", error);
  return count ?? 0;
}

/** Pagina de historia mais antiga que `before`, do mais recente para o mais antigo. */
export async function listCheckinsBefore(
  client: Client,
  userId: string,
  before: string,
  limit: number,
) {
  const { data, error } = await client
    .from("emotional_checkins")
    .select(
      "id, user_id, occurred_at, mood_score, perceived_anxiety_score, energy_score, primary_feeling, note, created_at",
    )
    .eq("user_id", userId)
    .lt("occurred_at", before)
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw new EmotionalRepositoryError("list_checkins_before", error);
  return data satisfies CheckinRow[];
}

export async function listCheckinFactorLinks(
  client: Client,
  checkinIds: string[],
) {
  // Em blocos: a lista inteira na query string estoura a URI (ver `id-chunks`).
  const rows: { checkin_id: string; factor_id: string }[] = [];
  for (const chunk of chunkIds(checkinIds)) {
    const { data, error } = await client
      .from("emotional_checkin_factors")
      .select("checkin_id, factor_id")
      .in("checkin_id", chunk);
    if (error) throw new EmotionalRepositoryError("list_checkin_factors", error);
    rows.push(...data);
  }
  return rows;
}

export async function listFactors(client: Client) {
  const { data, error } = await client
    .from("emotional_factors")
    .select("id, label, origin, owner_user_id, created_at")
    .order("origin", { ascending: false })
    .order("label", { ascending: true });
  if (error) throw new EmotionalRepositoryError("list_factors", error);
  return data satisfies FactorRow[];
}

export async function listSleep(client: Client, userId: string, since?: string) {
  const query = client
    .from("sleep_records")
    .select(
      "id, user_id, night, duration_minutes, sleep_quality_score, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("night", { ascending: false });
  const { data, error } = await (since ? query.gte("night", since) : query);
  if (error) throw new EmotionalRepositoryError("list_sleep", error);
  return data satisfies SleepRow[];
}

export async function countSleepBefore(client: Client, userId: string, since: string) {
  const { count, error } = await client
    .from("sleep_records")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .lt("night", since);
  if (error) throw new EmotionalRepositoryError("count_sleep_before", error);
  return count ?? 0;
}

export async function listSleepBefore(
  client: Client,
  userId: string,
  before: string,
  limit: number,
) {
  const { data, error } = await client
    .from("sleep_records")
    .select("id, user_id, night, duration_minutes, sleep_quality_score, created_at, updated_at")
    .eq("user_id", userId)
    .lt("night", before)
    .order("night", { ascending: false })
    .limit(limit);
  if (error) throw new EmotionalRepositoryError("list_sleep_before", error);
  return data satisfies SleepRow[];
}

export async function createCheckin(client: Client, payload: Json) {

  // check-in ja existente do titular em vez de criar outro.
  const { data, error } = await client.rpc("create_emotional_checkin_v3", {
    p_payload: payload,
  });
  if (
    error ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.id !== "string" ||
    typeof data.occurred_at !== "string"
  ) {
    throw new EmotionalRepositoryError("create_checkin", error);
  }
  return { id: data.id, occurredAt: data.occurred_at };
}

/**
 * Atualiza um check-in existente e substitui os fatores dele.
 *
 * A propriedade nao e checada aqui: a RPC roda com `security invoker` e a RLS
 * decide. Check-in de outra pessoa levanta `P0002` - o mesmo erro de check-in
 * inexistente, de proposito.
 */
export async function updateCheckin(client: Client, payload: Json) {
  const { data, error } = await client.rpc("update_emotional_checkin", {
    p_payload: payload,
  });
  if (
    error ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    typeof data.id !== "string" ||
    typeof data.occurred_at !== "string"
  ) {
    throw new EmotionalRepositoryError("update_checkin", error);
  }
  return { id: data.id, occurredAt: data.occurred_at };
}

export async function createCustomFactor(
  client: Client,
  userId: string,
  label: string,
) {
  const findExisting = async () => {
    const { data, error } = await client
      .from("emotional_factors")
      .select("id, label, origin, owner_user_id, created_at")
      .eq("owner_user_id", userId)
      .eq("origin", "custom");
    if (error) throw new EmotionalRepositoryError("find_custom_factor", error);
    return data.find(
      (factor) => factor.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
  };

  const existing = await findExisting();
  if (existing) return existing satisfies FactorRow;

  const { data, error } = await client
    .from("emotional_factors")
    .insert({ label, origin: "custom", owner_user_id: userId })
    .select("id, label, origin, owner_user_id, created_at")
    .single();
  if (error) {
    const concurrent = await findExisting();
    if (concurrent) return concurrent satisfies FactorRow;
    throw new EmotionalRepositoryError("create_custom_factor", error);
  }
  return data satisfies FactorRow;
}

export async function findSleepByNight(client: Client, userId: string, night: string) {
  const { data, error } = await client
    .from("sleep_records")
    .select(
      "id, user_id, night, duration_minutes, sleep_quality_score, created_at, updated_at",
    )
    .eq("user_id", userId)
    .eq("night", night)
    .maybeSingle();
  if (error) throw new EmotionalRepositoryError("find_sleep", error);
  return data satisfies SleepRow | null;
}

export async function upsertSleep(
  client: Client,
  row: {
    user_id: string;
    night: string;
    duration_minutes: number | null;
    sleep_quality_score: number | null;
  },
) {
  const { data, error } = await client
    .from("sleep_records")
    .upsert(row, { onConflict: "user_id,night" })
    .select(
      "id, user_id, night, duration_minutes, sleep_quality_score, created_at, updated_at",
    )
    .single();
  if (error) throw new EmotionalRepositoryError("upsert_sleep", error);
  return data satisfies SleepRow;
}
