import type { SupabaseClient, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fingerprint,
  goalEditContent,
  goalStatusContent,
  journalContent,
  sleepContent,
} from "@/lib/offline/contracts";



const h = vi.hoisted(() => ({
  goals: new Map<string, Record<string, unknown>>(),
  progress: new Map<string, Record<string, unknown>>(),
  journal: new Map<string, Record<string, unknown>>(),
  sleep: new Map<string, Record<string, unknown>>(),
  insertGoal: vi.fn(),
  insertGoalProgress: vi.fn(),
  persistJournalEntry: vi.fn(),
  upsertSleep: vi.fn(),
}));

class UniqueViolation extends Error {
  code = "23505";
}

vi.mock("@/server/repositories/goals-repository", () => ({
  GoalsRepositoryError: class extends Error {},
  findGoal: async (_c: unknown, _u: string, id: string) => h.goals.get(id) ?? null,
  findGoalProgress: async (_c: unknown, id: string) => h.progress.get(id) ?? null,
  insertGoal: h.insertGoal,
  insertGoalProgress: h.insertGoalProgress,
  listGoals: vi.fn(),
  listGoalProgress: vi.fn(),
  updateGoalFields: async (_c: unknown, _u: string, id: string, fields: Record<string, unknown>) => {
    const goal = { ...h.goals.get(id)!, ...fields };
    h.goals.set(id, goal);
    return goal;
  },
  updateGoalStatus: async (_c: unknown, _u: string, id: string, status: string) => {
    const goal = { ...h.goals.get(id)!, status };
    h.goals.set(id, goal);
    return goal;
  },
  deleteGoal: vi.fn(),
}));

vi.mock("@/server/repositories/journal-repository", () => ({
  JournalRepositoryError: class extends Error {},
  findJournalEntry: async (_c: unknown, _u: string, id: string) => h.journal.get(id) ?? null,
  listJournalEntryTagLinks: async () => [],
  listJournalEntries: vi.fn(),
  listJournalTags: vi.fn(),
  persistJournalEntry: h.persistJournalEntry,
  createCustomJournalTag: vi.fn(),
  setJournalTrashState: vi.fn(),
  deleteJournalEntry: vi.fn(),
  purgeExpiredJournal: vi.fn(),
}));

vi.mock("@/server/repositories/emotional-repository", () => ({
  EmotionalRepositoryError: class extends Error {},
  findSleepByNight: async (_c: unknown, _u: string, night: string) => h.sleep.get(night) ?? null,
  upsertSleep: h.upsertSleep,
  createCheckin: vi.fn(),
  updateCheckin: vi.fn(),
  createCustomFactor: vi.fn(),
  listCheckinFactorLinks: vi.fn(),
  listCheckins: vi.fn(),
  listFactors: vi.fn(),
  listSleep: vi.fn(),
}));

vi.mock("@/server/repositories/identity-repository", () => ({ appendAudit: vi.fn() }));

const goalsService = await import("@/server/services/goals-service");
const journalService = await import("@/server/services/journal-service");
const emotionalService = await import("@/server/services/emotional-service");
const { OfflineConflictError } = await import("@/server/services/offline-sync");

const client = {} as SupabaseClient;
vi.mock("server-only", () => ({}));
const user = { id: "user-1" } as User;
const GOAL_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";

function goalRow(status = "active") {
  return {
    id: GOAL_ID,
    user_id: user.id,
    title: "Caminhar",
    kind: "frequency",
    status,
    recurrence: "daily",
    target: 1,
    unit: null,
    created_at: "2026-09-16T10:00:00Z",
    updated_at: "2026-09-16T10:00:00Z",
  };
}

beforeEach(() => {
  h.goals.clear();
  h.progress.clear();
  h.journal.clear();
  h.sleep.clear();
  h.insertGoal.mockReset();
  h.insertGoalProgress.mockReset();
  h.persistJournalEntry.mockReset();
  h.upsertSleep.mockReset();
  h.insertGoal.mockImplementation(async (_client: unknown, row: Record<string, unknown>) => {
    if (row.id && h.goals.has(String(row.id))) throw new UniqueViolation();
    const created = { ...goalRow(), ...row };
    h.goals.set(String(created.id), created);
    return created;
  });
  h.insertGoalProgress.mockImplementation(async (_client: unknown, row: Record<string, unknown>) => {
    if (row.id && h.progress.has(String(row.id))) throw new UniqueViolation();
    const created = { id: row.id ?? "server-id", created_at: "x", ...row };
    h.progress.set(String(created.id), created);
    return created;
  });
});

describe("metas", () => {
  it("criacao repetida com o mesmo ID devolve a existente", async () => {
    const input = { id: GOAL_ID, title: "Caminhar", kind: "frequency", recurrence: "daily", target: 1, unit: null };
    const first = await goalsService.createGoal(client, user, input);
    const second = await goalsService.createGoal(client, user, input);
    expect(second).toEqual(first);
    expect(h.goals.size).toBe(1);
  });

  it("progresso repetido nao duplica e respeita o dia do aparelho", async () => {
    h.goals.set(GOAL_ID, goalRow());
    const today = new Date();
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate() - 1 || today.getDate()).padStart(2, "0")}`;
    const input = { id: "33333333-3333-4333-8333-333333333333", goalId: GOAL_ID, amount: 1, day };
    await goalsService.addGoalProgress(client, user, input);
    // Mesmo com a meta pausada depois, o reenvio do progresso ja gravado e neutro.
    h.goals.set(GOAL_ID, goalRow("paused"));
    const replay = await goalsService.addGoalProgress(client, user, input);
    expect(h.progress.size).toBe(1);
    expect(replay.day).toBe(day);
    expect(h.insertGoalProgress).toHaveBeenCalledTimes(1);
  });

  it("dia fora da janela aceita e recusado", async () => {
    h.goals.set(GOAL_ID, goalRow());
    await expect(
      goalsService.addGoalProgress(client, user, { goalId: GOAL_ID, amount: 1, day: "2020-01-01" }),
    ).rejects.toThrow("fora do período");
  });

  it("status: reenvio da propria escrita e neutro; mudanca concorrente e 409", async () => {
    h.goals.set(GOAL_ID, goalRow("active"));
    const base = await fingerprint(goalStatusContent({ status: "active" }));
    await goalsService.changeGoalStatus(client, user, { id: GOAL_ID, status: "paused", baseFingerprint: base });
    // ACK perdido: servidor ja esta pausado, mesmo envio de novo.
    await expect(
      goalsService.changeGoalStatus(client, user, { id: GOAL_ID, status: "paused", baseFingerprint: base }),
    ).resolves.toMatchObject({ status: "paused" });
    // Outro aparelho concluiu a meta: pedir "ativa" a partir de "ativa" e conflito.
    h.goals.set(GOAL_ID, goalRow("completed"));
    await expect(
      goalsService.changeGoalStatus(client, user, { id: GOAL_ID, status: "paused", baseFingerprint: base }),
    ).rejects.toBeInstanceOf(OfflineConflictError);
  });

  it("status de meta excluida: conflito vindo da fila, recusa normal sem base", async () => {
    await expect(
      goalsService.changeGoalStatus(client, user, {
        id: GOAL_ID,
        status: "paused",
        baseFingerprint: await fingerprint(goalStatusContent({ status: "active" })),
      }),
    ).rejects.toBeInstanceOf(OfflineConflictError);
    await expect(
      goalsService.changeGoalStatus(client, user, { id: GOAL_ID, status: "paused" }),
    ).rejects.toThrow("Meta não encontrada.");
  });
});

describe("edicao de meta — concorrencia otimista (OFF-2, L-408)", () => {
  const edit = (overrides: Record<string, unknown> = {}) => ({ id: GOAL_ID, title: "Caminhar 30 min", target: 2, unit: null, ...overrides });
  const baseOf = (row: ReturnType<typeof goalRow>) => fingerprint(goalEditContent(row));

  it("sem base e recusada (nunca last-write-wins silencioso)", async () => {
    h.goals.set(GOAL_ID, goalRow());
    await expect(goalsService.editGoal(client, user, edit())).rejects.toThrow("Recarregue a meta antes de editar.");
    expect(h.goals.get(GOAL_ID)!.title).toBe("Caminhar");
  });

  it("base igual: salva; reenvio da mesma edicao (ACK perdido) e neutro", async () => {
    h.goals.set(GOAL_ID, goalRow());
    const base = await baseOf(goalRow());
    await expect(goalsService.editGoal(client, user, edit({ baseFingerprint: base }))).resolves.toMatchObject({ title: "Caminhar 30 min", target: 2 });
    await expect(goalsService.editGoal(client, user, edit({ baseFingerprint: base }))).resolves.toMatchObject({ title: "Caminhar 30 min" });
  });

  it("outro aparelho mudou titulo/alvo: 409 com a versao atual; nada sobrescrito", async () => {
    const base = await baseOf(goalRow());
    h.goals.set(GOAL_ID, { ...goalRow(), title: "Caminhar no parque" });
    const error = await goalsService.editGoal(client, user, edit({ baseFingerprint: base })).catch((e) => e);
    expect(error).toBeInstanceOf(OfflineConflictError);
    expect((error as { current: unknown }).current).toMatchObject({ title: "Caminhar no parque" });
    expect(h.goals.get(GOAL_ID)!.title).toBe("Caminhar no parque");
  });

  it("outro aparelho concluiu: conflito (nao 'recusa'), e excluida: conflito sem versao", async () => {
    const base = await baseOf(goalRow());
    h.goals.set(GOAL_ID, goalRow("completed"));
    await expect(goalsService.editGoal(client, user, edit({ baseFingerprint: base }))).rejects.toBeInstanceOf(OfflineConflictError);
    h.goals.delete(GOAL_ID);
    const gone = await goalsService.editGoal(client, user, edit({ baseFingerprint: base })).catch((e) => e);
    expect(gone).toBeInstanceOf(OfflineConflictError);
    expect((gone as { current: unknown }).current).toBeNull();
  });
});

describe("diario", () => {
  const entry = (overrides: Record<string, unknown> = {}) => ({
    id: ENTRY_ID,
    user_id: user.id,
    title: "Dia",
    content: "Texto do servidor",
    status: "saved",
    created_at: "2026-09-16T10:00:00Z",
    updated_at: "2026-09-16T11:00:00Z",
    trashed_at: null,
    ...overrides,
  });

  beforeEach(() => {
    h.persistJournalEntry.mockImplementation(async (_client: unknown, payload: Record<string, unknown>) => {
      h.journal.set(ENTRY_ID, entry({ title: payload.title, content: payload.content, status: payload.status }));
      return ENTRY_ID;
    });
  });

  it("edicao offline sobre base atual grava; texto diferente no servidor vira 409 com a versao atual", async () => {
    h.journal.set(ENTRY_ID, entry({ content: "Original" }));
    const base = await fingerprint(journalContent({ title: "Dia", content: "Original", status: "saved", tagIds: [] }));
    const saved = await journalService.saveJournalEntry(client, user, {
      id: ENTRY_ID, title: "Dia", content: "Minha edicao offline", status: "saved", tagIds: [], baseFingerprint: base,
    });
    expect(saved.content).toBe("Minha edicao offline");

    // Outro aparelho reescreveu antes do sync.
    h.journal.set(ENTRY_ID, entry({ content: "Edicao de outro aparelho" }));
    const conflict = journalService.saveJournalEntry(client, user, {
      id: ENTRY_ID, title: "Dia", content: "Segunda edicao offline", status: "saved", tagIds: [], baseFingerprint: base,
    });
    await expect(conflict).rejects.toBeInstanceOf(OfflineConflictError);
    await conflict.catch((error: InstanceType<typeof OfflineConflictError>) => {
      expect(error.current).toMatchObject({ content: "Edicao de outro aparelho" });
    });
    expect(h.persistJournalEntry).toHaveBeenCalledTimes(1);
  });

  it("criacao offline repetida (base null) nao e conflito", async () => {
    const input = { id: ENTRY_ID, title: "Novo", content: "Escrito sem rede", status: "saved", tagIds: [], baseFingerprint: null };
    await journalService.saveJournalEntry(client, user, input);
    await expect(journalService.saveJournalEntry(client, user, input)).resolves.toMatchObject({ content: "Escrito sem rede" });
  });

  it("anotacao na lixeira em outro aparelho vira conflito", async () => {
    h.journal.set(ENTRY_ID, entry({ trashed_at: "2026-09-16T12:00:00Z" }));
    await expect(
      journalService.saveJournalEntry(client, user, {
        id: ENTRY_ID, title: "Dia", content: "x", status: "saved", tagIds: [], baseFingerprint: null,
      }),
    ).rejects.toBeInstanceOf(OfflineConflictError);
  });

  it("sem baseFingerprint o comportamento online nao muda", async () => {
    h.journal.set(ENTRY_ID, entry({ content: "Qualquer coisa" }));
    await expect(
      journalService.saveJournalEntry(client, user, { id: ENTRY_ID, title: "Dia", content: "Online", status: "saved", tagIds: [] }),
    ).resolves.toMatchObject({ content: "Online" });
  });
});

describe("sono", () => {
  it("conflito por noite so quando o servidor mudou para outro valor", async () => {
    h.upsertSleep.mockImplementation(async (_client: unknown, row: Record<string, unknown>) => {
      const saved = { id: "s1", created_at: "x", updated_at: "y", ...row };
      h.sleep.set(String(row.night), saved);
      return saved;
    });
    const base = await fingerprint(sleepContent({ durationMinutes: null, quality: null }));
    // Nada no servidor e base "vazio": nao e a mesma coisa que base null.
    await expect(
      emotionalService.saveSleepRecord(client, user, {
        night: "2026-09-16", durationMinutes: 420, quality: 7, baseFingerprint: null,
      }),
    ).resolves.toMatchObject({ durationMinutes: 420 });
    await expect(
      emotionalService.saveSleepRecord(client, user, {
        night: "2026-09-16", durationMinutes: 300, quality: 4, baseFingerprint: base,
      }),
    ).rejects.toBeInstanceOf(OfflineConflictError);
  });
});
