import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  OFFLINE_PROGRESS_MAX_AGE_DAYS,
  canEditGoal,
  canTransitionGoalStatus,
  goalCreateSchema,
  goalEditSchema,
  goalDeleteSchema,
  goalProgressInputSchema,
  goalStatusUpdateSchema,
  toDay,
  type Goal,
  type GoalProgressEntry,
  type GoalsSnapshot,
} from "@/lib/contracts/goals";
import { goalEditContent, goalStatusContent } from "@/lib/offline/contracts";
import type { Database } from "@/lib/supabase/database.types";
import {
  deleteGoal,
  findGoal,
  findGoalProgress,
  insertGoal,
  insertGoalProgress,
  listGoalProgressBefore,
  listGoalProgress,
  listGoals,
  updateGoalFields,
  updateGoalStatus,
} from "@/server/repositories/goals-repository";
import {
  OfflineConflictError,
  assertNoOfflineConflict,
  isUniqueViolation,
  readBaseFingerprint,
} from "@/server/services/offline-sync";

type Client = SupabaseClient<Database>;


export class GoalNotFoundError extends Error {
  constructor() {
    super("Meta não encontrada.");
    this.name = "GoalNotFoundError";
  }
}

export class GoalsServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoalsServiceError";
  }
}

function mapGoal(row: Awaited<ReturnType<typeof listGoals>>[number]): Goal {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as Goal["kind"],
    status: row.status as Goal["status"],
    recurrence: row.recurrence as Goal["recurrence"],
    target: row.target,
    unit: row.unit,
    createdAt: row.created_at,
  };
}

function mapProgress(
  row: Awaited<ReturnType<typeof listGoalProgress>>[number],
): GoalProgressEntry {
  return {
    id: row.id,
    goalId: row.goal_id,
    day: row.occurred_on,
    amount: row.amount,
  };
}


export async function getGoalsSnapshot(
  client: Client,
  user: User,
  options: { since?: string } = {},
): Promise<GoalsSnapshot> {
  const rows = await listGoals(client, user.id);
  const progress = await listGoalProgress(
    client,
    rows.map((goal) => goal.id),
    options.since,
  );
  return { goals: rows.map(mapGoal), progress: progress.map(mapProgress) };
}

export async function createGoal(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = goalCreateSchema.parse(rawInput);
  try {
    return mapGoal(
      await insertGoal(client, {
        ...(input.id ? { id: input.id } : {}),
        user_id: user.id,
        title: input.title,
        kind: input.kind,
        status: "active",
        recurrence: input.recurrence,
        target: input.target,
        unit: input.unit,
      }),
    );
  } catch (error) {
    // Reenvio da outbox: a meta com este ID ja foi criada por este titular.
    if (input.id && isUniqueViolation(error)) {
      const existing = await findGoal(client, user.id, input.id);
      if (existing) return mapGoal(existing);
    }
    throw error;
  }
}

export async function changeGoalStatus(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = goalStatusUpdateSchema.parse(rawInput);
  const base = readBaseFingerprint(rawInput);
  const current = await findGoal(client, user.id, input.id);
  if (!current) {
    // Vindo da outbox, meta excluida em outro aparelho e conflito, nao recusa.
    if (base !== undefined) throw new OfflineConflictError(null);
    throw new GoalsServiceError("Meta não encontrada.");
  }
  await assertNoOfflineConflict({
    base,
    currentContent: goalStatusContent(current),
    currentEntity: mapGoal(current),
    nextContent: goalStatusContent(input),
  });
  if (!canTransitionGoalStatus(current.status as Goal["status"], input.status)) {
    throw new GoalsServiceError("Transição de status não permitida.");
  }
  if (current.status === input.status) return mapGoal(current);
  const updated = await updateGoalStatus(client, user.id, input.id, input.status);
  if (!updated) throw new GoalNotFoundError();
  return mapGoal(updated);
}

/**
 * Edita titulo, alvo e unidade (ver `goalEditSchema`). Progresso passado nao e
 * tocado nem recalculado; meta concluida/cancelada fica como registro.
 */
export async function editGoal(client: Client, user: User, rawInput: unknown) {
  const input = goalEditSchema.parse(rawInput);
  /*
    Concorrencia otimista (OFF-2, L-408): o cliente manda a impressao da meta
    como ele a leu (titulo, alvo, unidade, status). Se outro aparelho mudou
    qualquer um deles, e 409 com a versao atual — nunca last-write-wins
    silencioso. Sem base, nao ha como provar que a edicao e sobre o estado
    atual: recusa.
  */
  const base = readBaseFingerprint(rawInput);
  if (base === undefined) {
    throw new GoalsServiceError("Recarregue a meta antes de editar.");
  }
  const current = await findGoal(client, user.id, input.id);
  if (!current) {
    // Excluida em outro aparelho (ou criacao que nunca chegou): conflito visivel.
    throw new OfflineConflictError(null);
  }
  const unit = current.kind === "quantitative" ? (input.unit?.trim() || null) : null;
  await assertNoOfflineConflict({
    base,
    currentContent: goalEditContent(current),
    currentEntity: mapGoal(current),
    nextContent: goalEditContent({ title: input.title, target: input.target, unit, status: current.status }),
  });
  if (!canEditGoal(current.status as Goal["status"])) {
    throw new GoalsServiceError("Metas concluídas ou canceladas não podem ser editadas.");
  }
  const updated = await updateGoalFields(client, user.id, input.id, { title: input.title.trim(), target: input.target, unit });
  if (!updated) throw new GoalNotFoundError();
  return mapGoal(updated);
}

export async function addGoalProgress(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = goalProgressInputSchema.parse(rawInput);
  // Reenvio da outbox: progresso com este ID ja existe — devolve, nao duplica.
  if (input.id) {
    const existing = await findGoalProgress(client, input.id);
    if (existing && existing.goal_id === input.goalId) return mapProgress(existing);
  }
  const goal = await findGoal(client, user.id, input.goalId);
  if (!goal) throw new GoalsServiceError("Meta não encontrada.");
  if (goal.status !== "active") {
    throw new GoalsServiceError("Somente metas ativas recebem progresso.");
  }
  const today = new Date();
  let day = toDay(today);
  if (input.day) {
    const oldest = new Date(today);
    oldest.setDate(oldest.getDate() - OFFLINE_PROGRESS_MAX_AGE_DAYS);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    // Um dia de folga para fuso: o aparelho pode estar a frente do servidor.
    if (input.day > toDay(tomorrow) || input.day < toDay(oldest)) {
      throw new GoalsServiceError("Data do progresso fora do período aceito.");
    }
    day = input.day;
  }
  try {
    return mapProgress(
      await insertGoalProgress(client, {
        ...(input.id ? { id: input.id } : {}),
        goal_id: input.goalId,
        occurred_on: day,
        amount: input.amount,
      }),
    );
  } catch (error) {
    if (input.id && isUniqueViolation(error)) {
      const existing = await findGoalProgress(client, input.id);
      if (existing) return mapProgress(existing);
    }
    throw error;
  }
}

export async function removeGoal(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const { id } = goalDeleteSchema.parse(rawInput);
  const deleted = await deleteGoal(client, user.id, id);
  if (!deleted) throw new GoalNotFoundError();
  return { id: deleted };
}


export async function getOlderGoalProgress(
  client: Client,
  user: User,
  before: string,
  limit: number,
) {
  const goals = await listGoals(client, user.id);
  const rows = await listGoalProgressBefore(
    client,
    goals.map((goal) => goal.id),
    before,
    limit,
  );
  return rows.map(mapProgress);
}
