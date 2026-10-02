import { describe, expect, it } from "vitest";

import {
  canTransitionGoalStatus,
  currentStreak,
  daysOfCurrentPeriod,
  goalInputSchema,
  progressInPeriod,
  toDay,
  type Goal,
  type GoalProgressEntry,
} from "./goals";

const REF = new Date("2026-08-21T12:00:00"); // sexta-feira

function dayOffset(n: number): string {
  const d = new Date(REF);
  d.setDate(d.getDate() - n);
  return toDay(d);
}

const dailyGoal: Goal = {
  id: "g-1",
  title: "Meditar",
  kind: "quantitative",
  status: "active",
  recurrence: "daily",
  target: 10,
  unit: "min",
  createdAt: "2026-08-01T00:00:00.000Z",
};

const weeklyGoal: Goal = { ...dailyGoal, id: "g-2", recurrence: "weekly", target: 7 };

const entry = (goalId: string, day: string, amount = 1): GoalProgressEntry => ({
  id: `${goalId}-${day}`,
  goalId,
  day,
  amount,
});

describe("goalInputSchema", () => {
  it("aceita meta valida", () => {
    const r = goalInputSchema.safeParse({
      title: "Caminhar",
      kind: "frequency",
      recurrence: "weekly",
      target: 3,
      unit: null,
    });
    expect(r.success).toBe(true);
  });

  it("rejeita alvo zero ou negativo", () => {
    for (const target of [0, -1]) {
      const r = goalInputSchema.safeParse({
        title: "X",
        kind: "frequency",
        recurrence: "daily",
        target,
        unit: null,
      });
      expect(r.success).toBe(false);
    }
  });

  it("rejeita titulo vazio", () => {
    const r = goalInputSchema.safeParse({
      title: "",
      kind: "frequency",
      recurrence: "daily",
      target: 1,
      unit: null,
    });
    expect(r.success).toBe(false);
  });
});

describe("daysOfCurrentPeriod", () => {
  it("diaria cobre apenas hoje", () => {
    expect(daysOfCurrentPeriod("daily", REF).size).toBe(1);
  });

  it("semanal cobre 7 dias comecando na segunda", () => {
    const days = daysOfCurrentPeriod("weekly", REF);
    expect(days.size).toBe(7);
    expect(days.has("2026-08-17")).toBe(true); // segunda
    expect(days.has("2026-08-23")).toBe(true); // domingo
    expect(days.has("2026-08-16")).toBe(false);
  });
});

describe("progressInPeriod", () => {
  it("soma apenas os eventos do periodo corrente", () => {
    const entries = [
      entry("g-1", dayOffset(0), 10),
      entry("g-1", dayOffset(1), 10), // fora do periodo diario
    ];
    expect(progressInPeriod(entries, dailyGoal, REF)).toBe(10);
  });

  it("ignora eventos de outra meta", () => {
    const entries = [entry("g-1", dayOffset(0), 10), entry("g-9", dayOffset(0), 99)];
    expect(progressInPeriod(entries, dailyGoal, REF)).toBe(10);
  });

  it("periodo sem evento resulta em zero, nao em erro", () => {
    expect(progressInPeriod([], weeklyGoal, REF)).toBe(0);
  });
});

describe("currentStreak", () => {
  it("conta dias consecutivos a partir de hoje", () => {
    const entries = [
      entry("g-1", dayOffset(0)),
      entry("g-1", dayOffset(1)),
      entry("g-1", dayOffset(2)),
    ];
    expect(currentStreak(entries, "g-1", REF)).toBe(3);
  });

  it("um dia em curso sem registro nao quebra a sequencia", () => {
    const entries = [entry("g-1", dayOffset(1)), entry("g-1", dayOffset(2))];
    expect(currentStreak(entries, "g-1", REF)).toBe(2);
  });

  it("lacuna quebra a sequencia", () => {
    const entries = [
      entry("g-1", dayOffset(0)),
      entry("g-1", dayOffset(2)), // pulou o dia 1
    ];
    expect(currentStreak(entries, "g-1", REF)).toBe(1);
  });

  it("sem eventos o streak e zero", () => {
    expect(currentStreak([], "g-1", REF)).toBe(0);
  });

  it("e deterministico: mesma entrada, mesma saida", () => {
    const entries = [entry("g-1", dayOffset(0)), entry("g-1", dayOffset(1))];
    const a = currentStreak(entries, "g-1", REF);
    const b = currentStreak([...entries].reverse(), "g-1", REF);
    expect(a).toBe(b);
  });
});

describe("canTransitionGoalStatus", () => {
  it("permite pausar, retomar e encerrar uma meta em curso", () => {
    expect(canTransitionGoalStatus("active", "paused")).toBe(true);
    expect(canTransitionGoalStatus("paused", "active")).toBe(true);
    expect(canTransitionGoalStatus("active", "completed")).toBe(true);
    expect(canTransitionGoalStatus("paused", "cancelled")).toBe(true);
  });

  it("mantem estados terminais fechados e aceita repeticao idempotente", () => {
    expect(canTransitionGoalStatus("completed", "active")).toBe(false);
    expect(canTransitionGoalStatus("cancelled", "paused")).toBe(false);
    expect(canTransitionGoalStatus("completed", "completed")).toBe(true);
  });
});

describe("edicao de meta (QA do owner 27/09)", () => {
  it("so titulo, alvo e unidade entram; tipo e recorrencia sao ignorados pelo schema", async () => {
    const { goalEditSchema } = await import("./goals");
    const parsed = goalEditSchema.parse({
      id: "8f7d7f5e-2b6a-4b8e-9d7e-2f1f1f1f1f1f",
      title: "Água",
      target: 10,
      unit: "copos",
      kind: "frequency",
      recurrence: "weekly",
    });
    expect(parsed).toEqual({ id: "8f7d7f5e-2b6a-4b8e-9d7e-2f1f1f1f1f1f", title: "Água", target: 10, unit: "copos" });
    expect(goalEditSchema.safeParse({ id: parsed.id, title: "", target: 1, unit: null }).success).toBe(false);
    expect(goalEditSchema.safeParse({ id: parsed.id, title: "x", target: 0, unit: null }).success).toBe(false);
  });

  it("concluida e cancelada ficam como registro (sem edicao)", async () => {
    const { canEditGoal } = await import("./goals");
    expect([canEditGoal("active"), canEditGoal("paused"), canEditGoal("completed"), canEditGoal("cancelled")]).toEqual([true, true, false, false]);
  });
});
