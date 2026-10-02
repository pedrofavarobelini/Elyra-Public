import { z } from "zod";



export const goalKindSchema = z.enum(["frequency", "quantitative"]);
export type GoalKind = z.infer<typeof goalKindSchema>;

export const goalStatusSchema = z.enum([
  "active",
  "completed",
  "paused",
  "cancelled",
]);
export type GoalStatus = z.infer<typeof goalStatusSchema>;

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: "Ativa",
  completed: "Concluída",
  paused: "Pausada",
  cancelled: "Cancelada",
};

/** Recorrencia simples. RRULE avancado NAO entra na V1. */
export const recurrenceSchema = z.enum(["daily", "weekly"]);
export type Recurrence = z.infer<typeof recurrenceSchema>;

export const goalSchema = z.object({
  id: z.string().min(1),
  title: z
    .string()
    .min(1, "Informe um título para a meta.")
    .max(80, "O título pode ter no máximo 80 caracteres."),
  kind: goalKindSchema,
  status: goalStatusSchema,
  recurrence: recurrenceSchema,
  /** Alvo por periodo: vezes (frequency) ou quantidade (quantitative). */
  target: z
    .number({ invalid_type_error: "Informe um alvo numérico." })
    .int("O alvo deve ser um número inteiro.")
    .min(1, "O alvo mínimo é 1."),
  /** Unidade exibida em metas quantitativas, ex.: "min", "copos". */
  unit: z
    .string()
    .max(12, "A unidade pode ter no máximo 12 caracteres.")
    .nullable(),
  createdAt: z.string().datetime({ offset: true }),
});

export type Goal = z.infer<typeof goalSchema>;

export const goalInputSchema = goalSchema.pick({
  title: true,
  kind: true,
  recurrence: true,
  target: true,
  unit: true,
});

export type GoalInput = z.infer<typeof goalInputSchema>;


export const goalCreateSchema = goalInputSchema.extend({
  id: z.string().uuid("Meta inválida.").optional(),
});

export const goalStatusUpdateSchema = z.object({
  id: z.string().uuid(),
  status: goalStatusSchema,
});

export const goalDeleteSchema = z.object({ id: z.string().uuid() });


export const goalEditSchema = z.object({
  id: z.string().uuid("Meta inválida."),
  title: goalSchema.shape.title,
  target: goalSchema.shape.target,
  unit: goalSchema.shape.unit,
});
export type GoalEdit = z.infer<typeof goalEditSchema>;

/** Status em que a meta ainda pode ser editada (terminal fica como registro). */
export function canEditGoal(status: GoalStatus): boolean {
  return status === "active" || status === "paused";
}

/** Evento fonte de progresso. A verdade vive aqui, nao em um contador. */
export const goalProgressEntrySchema = z.object({
  id: z.string().min(1),
  goalId: z.string().min(1),
  /** Data civil do evento (YYYY-MM-DD). */
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().int().min(1),
});

export type GoalProgressEntry = z.infer<typeof goalProgressEntrySchema>;

export const goalProgressInputSchema = z.object({
  goalId: z.string().uuid(),
  amount: z.number().int().min(1),

  id: z.string().uuid("Progresso inválido.").optional(),

  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.").optional(),
});

/** Janela aceita para progresso registrado offline e sincronizado depois. */
export const OFFLINE_PROGRESS_MAX_AGE_DAYS = 60;

export interface GoalsSnapshot {
  goals: Goal[];
  progress: GoalProgressEntry[];
}

const ALLOWED_STATUS_TRANSITIONS: Record<GoalStatus, readonly GoalStatus[]> = {
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "completed", "cancelled"],
  completed: [],
  cancelled: [],
};

/** Transicoes terminais nao sao reabertas silenciosamente na V1. */
export function canTransitionGoalStatus(from: GoalStatus, to: GoalStatus): boolean {
  return from === to || ALLOWED_STATUS_TRANSITIONS[from].includes(to);
}

// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------

/** Soma dos eventos do periodo corrente. Deterministico. */
export function progressInPeriod(
  entries: GoalProgressEntry[],
  goal: Goal,
  reference: Date = new Date(),
): number {
  const days = daysOfCurrentPeriod(goal.recurrence, reference);
  return entries
    .filter((e) => e.goalId === goal.id && days.has(e.day))
    .reduce((sum, e) => sum + e.amount, 0);
}

/** Conjunto de dias civis do periodo corrente. */
export function daysOfCurrentPeriod(
  recurrence: Recurrence,
  reference: Date,
): Set<string> {
  const days = new Set<string>();
  if (recurrence === "daily") {
    days.add(toDay(reference));
    return days;
  }
  // Semana comecando na segunda-feira.
  const ref = new Date(reference);
  const weekday = (ref.getDay() + 6) % 7;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - weekday);
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.add(toDay(d));
  }
  return days;
}

/**
 * Streak deterministico: dias civis consecutivos com pelo menos um evento,
 * contados para tras a partir de hoje.
 *
 * Se hoje ainda nao tem evento, a contagem comeca em ontem - um dia em curso
 * nao quebra a sequencia antes de terminar.
 *
 * Recalculavel a qualquer momento a partir dos eventos. Nada e persistido.
 */
export function currentStreak(
  entries: GoalProgressEntry[],
  goalId: string,
  reference: Date = new Date(),
): number {
  const days = new Set(
    entries.filter((e) => e.goalId === goalId).map((e) => e.day),
  );
  if (days.size === 0) return 0;

  const cursor = new Date(reference);
  if (!days.has(toDay(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(toDay(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(toDay(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Data civil local no formato YYYY-MM-DD. */
export function toDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
