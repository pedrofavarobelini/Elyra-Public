import type { CycleDailyRecord, CyclePeriod } from "@/lib/contracts/cycle";
import type { EmotionalCheckin, SleepRecord } from "@/lib/contracts/emotional";
import type { Goal, GoalProgressEntry } from "@/lib/contracts/goals";
import type { JournalEntry } from "@/lib/contracts/journal";
import {
  OUTBOX_DOMAIN,
  OUTBOX_KIND,
  type OutboxOperation,
} from "@/lib/offline/contracts";

/**
 * Estado exibido = base confirmada pelo servidor + operacoes pendentes.
 *
 * Todas as aplicacoes sao **upsert por ID ou chave natural** (nunca append
 * cego): aplicar a mesma operacao duas vezes, ou aplica-la sobre uma base que
 * ja recebeu o ACK, da o mesmo resultado. E isso que impede duplicata na tela
 * quando o snapshot novo chega antes da fila esvaziar, e o que impede uma
 * exclusao pendente de "ressuscitar" o registro.
 */

export interface PersonalSlices {
  checkins: EmotionalCheckin[];
  sleep: SleepRecord[];
  journal: JournalEntry[];
  goals: Goal[];
  goalProgress: GoalProgressEntry[];
  cycleRecords: CycleDailyRecord[];
}

type Body = Record<string, unknown>;

function upsertById<T extends { id: string }>(list: T[], item: T, prepend = true): T[] {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) return prepend ? [item, ...list] : [...list, item];
  const next = [...list];
  next[index] = item;
  return next;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function applyOperation(slices: PersonalSlices, operation: OutboxOperation): PersonalSlices {
  const body = operation.request.body as Body;

  switch (operation.domain) {
    case OUTBOX_DOMAIN.CHECKIN: {
      if (operation.kind !== OUTBOX_KIND.CREATE) return slices;
      const checkin: EmotionalCheckin = {
        id: asString(body.id),
        occurredAt: asString(body.occurredAt, operation.createdAt),
        mood: asNullableNumber(body.mood),
        perceivedAnxiety: asNullableNumber(body.perceivedAnxiety),
        energy: asNullableNumber(body.energy),
        primaryFeeling: (body.primaryFeeling ?? null) as EmotionalCheckin["primaryFeeling"],
        factorIds: asStringArray(body.factorIds),
        note: typeof body.note === "string" ? body.note : null,
      };
      return {
        ...slices,
        checkins: upsertById(slices.checkins, checkin).sort((a, b) =>
          a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
        ),
      };
    }

    case OUTBOX_DOMAIN.SLEEP: {
      const night = asString(body.night);
      const existing = slices.sleep.find((record) => record.night === night);
      const record: SleepRecord = {
        id: existing?.id ?? `local-sleep-${night}`,
        night,
        durationMinutes: asNullableNumber(body.durationMinutes),
        quality: asNullableNumber(body.quality),
      };
      return { ...slices, sleep: [record, ...slices.sleep.filter((item) => item.night !== night)] };
    }

    case OUTBOX_DOMAIN.JOURNAL: {
      const id = asString(body.id);
      const existing = slices.journal.find((entry) => entry.id === id);
      if (operation.kind === OUTBOX_KIND.DELETE) {
        return { ...slices, journal: slices.journal.filter((entry) => entry.id !== id) };
      }
      if (body.action === "trash" || body.action === "restore") {
        if (!existing) return slices;
        return {
          ...slices,
          journal: upsertById(slices.journal, {
            ...existing,
            trashedAt: body.action === "trash" ? operation.createdAt : null,
          }),
        };
      }
      const entry: JournalEntry = {
        id,
        title: asString(body.title),
        content: asString(body.content),
        status: body.status === "saved" ? "saved" : "draft",
        tagIds: asStringArray(body.tagIds),
        createdAt: existing?.createdAt ?? operation.createdAt,
        updatedAt: operation.createdAt,
        trashedAt: existing?.trashedAt ?? null,
      };
      return {
        ...slices,
        journal: [entry, ...slices.journal.filter((item) => item.id !== id)],
      };
    }

    case OUTBOX_DOMAIN.GOAL: {
      const id = asString(body.id);
      if (operation.kind === OUTBOX_KIND.CREATE) {
        const goal: Goal = {
          id,
          title: asString(body.title),
          kind: body.kind === "quantitative" ? "quantitative" : "frequency",
          status: "active",
          recurrence: body.recurrence === "weekly" ? "weekly" : "daily",
          target: typeof body.target === "number" ? body.target : 1,
          unit: typeof body.unit === "string" ? body.unit : null,
          createdAt: operation.createdAt,
        };
        const existing = slices.goals.find((item) => item.id === id);
        return { ...slices, goals: upsertById(slices.goals, existing ?? goal) };
      }
      const existing = slices.goals.find((item) => item.id === id);
      if (!existing) return slices;
      if (operation.request.method === "PUT") {
        // OFF-2: edicao na fila (titulo, alvo, unidade); o status nao muda aqui.
        return {
          ...slices,
          goals: upsertById(slices.goals, {
            ...existing,
            title: asString(body.title) || existing.title,
            target: typeof body.target === "number" ? body.target : existing.target,
            unit: typeof body.unit === "string" ? body.unit : null,
          }),
        };
      }
      return {
        ...slices,
        goals: upsertById(slices.goals, { ...existing, status: body.status as Goal["status"] }),
      };
    }

    case OUTBOX_DOMAIN.GOAL_PROGRESS: {
      const entry: GoalProgressEntry = {
        id: asString(body.id),
        goalId: asString(body.goalId),
        day: asString(body.day, operation.createdAt.slice(0, 10)),
        amount: typeof body.amount === "number" ? body.amount : 1,
      };
      return { ...slices, goalProgress: upsertById(slices.goalProgress, entry, false) };
    }

    case OUTBOX_DOMAIN.CYCLE_RECORD: {
      const date = asString(body.date);
      if (operation.kind === OUTBOX_KIND.DELETE) {
        return { ...slices, cycleRecords: slices.cycleRecords.filter((record) => record.date !== date) };
      }
      const existing = slices.cycleRecords.find((record) => record.date === date);
      // Registro diario e sempre dado **observado**: nenhuma estimativa entra aqui.
      const record: CycleDailyRecord = {
        id: existing?.id ?? `local-cycle-${date}`,
        date,
        flow: (body.flow ?? null) as CycleDailyRecord["flow"],
        note: typeof body.note === "string" ? body.note : null,
        symptoms: Array.isArray(body.symptoms)
          ? (body.symptoms as CycleDailyRecord["symptoms"])
          : [],
      };
      return {
        ...slices,
        cycleRecords: [...slices.cycleRecords.filter((item) => item.date !== date), record],
      };
    }

    default:
      return slices;
  }
}

export function applyOperations(slices: PersonalSlices, operations: readonly OutboxOperation[]): PersonalSlices {
  return operations.reduce(applyOperation, slices);
}

/**
 * Reconciliacao do ACK: a resposta do servidor substitui a versao local na base.
 * Periodos do ciclo (materializados no servidor) voltam junto na resposta.
 */
export function reconcileAck(
  base: PersonalSlices & { periods: CyclePeriod[] },
  operation: OutboxOperation,
  responseBody: unknown,
): PersonalSlices & { periods: CyclePeriod[] } {
  const data =
    responseBody && typeof responseBody === "object" && "data" in responseBody
      ? (responseBody as { data: unknown }).data
      : null;
  const body = operation.request.body as Body;

  switch (operation.domain) {
    case OUTBOX_DOMAIN.CHECKIN:
      return data ? { ...base, checkins: upsertById(base.checkins, data as EmotionalCheckin) } : base;
    case OUTBOX_DOMAIN.SLEEP: {
      if (!data) return base;
      const record = data as SleepRecord;
      return { ...base, sleep: [record, ...base.sleep.filter((item) => item.night !== record.night)] };
    }
    case OUTBOX_DOMAIN.JOURNAL:
      if (operation.kind === OUTBOX_KIND.DELETE) {
        return { ...base, journal: base.journal.filter((entry) => entry.id !== body.id) };
      }
      return data ? { ...base, journal: upsertById(base.journal, data as JournalEntry) } : base;
    case OUTBOX_DOMAIN.GOAL:
      return data ? { ...base, goals: upsertById(base.goals, data as Goal) } : base;
    case OUTBOX_DOMAIN.GOAL_PROGRESS:
      return data ? { ...base, goalProgress: upsertById(base.goalProgress, data as GoalProgressEntry, false) } : base;
    case OUTBOX_DOMAIN.CYCLE_RECORD: {
      if (operation.kind === OUTBOX_KIND.DELETE) {
        return { ...base, cycleRecords: base.cycleRecords.filter((record) => record.date !== body.date) };
      }
      const payload = data as { record?: CycleDailyRecord; periods?: CyclePeriod[] } | null;
      if (!payload?.record) return base;
      const record = payload.record;
      return {
        ...base,
        cycleRecords: [...base.cycleRecords.filter((item) => item.date !== record.date), record],
        periods: payload.periods ?? base.periods,
      };
    }
    default:
      return base;
  }
}
