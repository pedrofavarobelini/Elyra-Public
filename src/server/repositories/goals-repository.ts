import "server-only";

import {
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";
import { chunkIds } from "./id-chunks";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type GoalRow = Database["public"]["Tables"]["goals"]["Row"];
type ProgressRow = Database["public"]["Tables"]["goal_progress_entries"]["Row"];

export class GoalsRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de metas: ${operation}.`);
    this.name = "GoalsRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("metas", operation, normalizada);
  }
}

export async function listGoals(client: Client, userId: string) {
  const { data, error } = await client
    .from("goals")
    .select("id, user_id, title, kind, status, recurrence, target, unit, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new GoalsRepositoryError("list_goals", error);
  return data satisfies GoalRow[];
}

export async function findGoal(client: Client, userId: string, id: string) {
  const { data, error } = await client
    .from("goals")
    .select("id, user_id, title, kind, status, recurrence, target, unit, created_at, updated_at")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new GoalsRepositoryError("find_goal", error);
  return data satisfies GoalRow | null;
}

export async function listGoalProgress(client: Client, goalIds: string[], since?: string) {
  const rows: ProgressRow[] = [];
  for (const chunk of chunkIds(goalIds)) {
    const query = client
      .from("goal_progress_entries")
      .select("id, goal_id, occurred_on, amount, created_at")
      .in("goal_id", chunk)
      .order("occurred_on", { ascending: false })
      .order("created_at", { ascending: false });
    const { data, error } = await (since ? query.gte("occurred_on", since) : query);
    if (error) throw new GoalsRepositoryError("list_progress", error);
    rows.push(...data);
  }
  // A ordem global precisa valer entre blocos, e nao so dentro de cada um.
  return rows.sort(
    (a, b) =>
      b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at),
  ) satisfies ProgressRow[];
}

export async function insertGoal(
  client: Client,
  row: Database["public"]["Tables"]["goals"]["Insert"],
) {
  const { data, error } = await client
    .from("goals")
    .insert(row)
    .select("id, user_id, title, kind, status, recurrence, target, unit, created_at, updated_at")
    .single();
  if (error) throw new GoalsRepositoryError("create_goal", error);
  return data satisfies GoalRow;
}

export async function updateGoalStatus(
  client: Client,
  userId: string,
  id: string,
  status: string,
) {
  const { data, error } = await client
    .from("goals")
    .update({ status })
    .eq("user_id", userId)
    .eq("id", id)
    .select("id, user_id, title, kind, status, recurrence, target, unit, created_at, updated_at")
    .maybeSingle();
  // `error` e falha real do banco; `!data` e zero linhas — meta inexistente ou
  // de outra pessoa (invisivel pela RLS). O status quem decide e o servico (L-051).
  if (error) throw new GoalsRepositoryError("update_status", error);
  return data satisfies GoalRow | null;
}

/** Edicao de titulo/alvo/unidade; nunca toca em tipo, recorrencia nem progresso. */
export async function updateGoalFields(
  client: Client,
  userId: string,
  id: string,
  fields: { title: string; target: number; unit: string | null },
) {
  const { data, error } = await client
    .from("goals")
    .update(fields)
    .eq("user_id", userId)
    .eq("id", id)
    .select("id, user_id, title, kind, status, recurrence, target, unit, created_at, updated_at")
    .maybeSingle();
  if (error) throw new GoalsRepositoryError("update_fields", error);
  return data satisfies GoalRow | null;
}

export async function insertGoalProgress(
  client: Client,
  row: Database["public"]["Tables"]["goal_progress_entries"]["Insert"],
) {
  const { data, error } = await client
    .from("goal_progress_entries")
    .insert(row)
    .select("id, goal_id, occurred_on, amount, created_at")
    .single();
  if (error) throw new GoalsRepositoryError("create_progress", error);
  return data satisfies ProgressRow;
}

export async function countGoalProgressBefore(
  client: Client,
  goalIds: string[],
  since: string,
) {
  let total = 0;
  for (const chunk of chunkIds(goalIds)) {
    const { count, error } = await client
      .from("goal_progress_entries")
      .select("id", { count: "exact", head: true })
      .in("goal_id", chunk)
      .lt("occurred_on", since);
    if (error) throw new GoalsRepositoryError("count_progress_before", error);
    total += count ?? 0;
  }
  return total;
}

export async function listGoalProgressBefore(
  client: Client,
  goalIds: string[],
  before: string,
  limit: number,
) {
  const rows: ProgressRow[] = [];
  for (const chunk of chunkIds(goalIds)) {
    const { data, error } = await client
      .from("goal_progress_entries")
      .select("id, goal_id, occurred_on, amount, created_at")
      .in("goal_id", chunk)
      .lt("occurred_on", before)
      .order("occurred_on", { ascending: false })
      .limit(limit);
    if (error) throw new GoalsRepositoryError("list_progress_before", error);
    rows.push(...data);
  }
  return rows
    .sort(
      (a, b) =>
        b.occurred_on.localeCompare(a.occurred_on) || b.created_at.localeCompare(a.created_at),
    )
    .slice(0, limit) satisfies ProgressRow[];
}

/** Progresso por ID; a RLS so devolve entradas de metas do proprio titular. */
export async function findGoalProgress(client: Client, id: string) {
  const { data, error } = await client
    .from("goal_progress_entries")
    .select("id, goal_id, occurred_on, amount, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new GoalsRepositoryError("find_progress", error);
  return data satisfies ProgressRow | null;
}

export async function deleteGoal(client: Client, userId: string, id: string) {
  const { data, error } = await client
    .from("goals")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new GoalsRepositoryError("delete_goal", error);
  return data ? data.id : null;
}
