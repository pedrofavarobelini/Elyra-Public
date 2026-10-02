import type { SupabaseClient, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/repositories/goals-repository", () => ({
  GoalsRepositoryError: class GoalsRepositoryError extends Error {
    constructor(public readonly operation: string) {
      super(operation);
      this.name = "GoalsRepositoryError";
    }
  },
  deleteGoal: vi.fn(),
  findGoal: vi.fn(),
  findGoalProgress: vi.fn(),
  insertGoal: vi.fn(),
  insertGoalProgress: vi.fn(),
  listGoalProgress: vi.fn(),
  listGoals: vi.fn(),
  updateGoalStatus: vi.fn(),
}));
vi.mock("@/server/repositories/cycle-repository", () => ({
  CycleRepositoryError: class CycleRepositoryError extends Error {
    constructor(public readonly operation: string) {
      super(operation);
      this.name = "CycleRepositoryError";
    }
  },
  createCustomCycleSymptom: vi.fn(),
  deleteAllCycleData: vi.fn(),
  findCyclePeriod: vi.fn(),
  findCycleProfile: vi.fn(),
  findCycleRecord: vi.fn(),
  findCycleRecordByDate: vi.fn(),
  listCycleDailySymptoms: vi.fn(),
  listCyclePeriods: vi.fn(),
  listCycleRecords: vi.fn(),
  listCycleSymptoms: vi.fn(),
  persistCyclePeriod: vi.fn(),
  persistCycleRecord: vi.fn(),
  removeCyclePeriod: vi.fn(),
  removeCycleRecord: vi.fn(),
  setCycleEnabled: vi.fn(),
}));

import type { Database } from "@/lib/supabase/database.types";
import {
  GoalsRepositoryError,
  deleteGoal,
  findGoal,
  updateGoalStatus,
} from "@/server/repositories/goals-repository";
import {
  CycleRepositoryError,
  removeCyclePeriod,
  removeCycleRecord,
} from "@/server/repositories/cycle-repository";
import { CycleNotFoundError, deleteCycleDailyRecord, deleteCyclePeriod } from "@/server/services/cycle-service";
import { GoalNotFoundError, changeGoalStatus, removeGoal } from "@/server/services/goals-service";



const user = { id: "11111111-1111-4111-8111-111111111111" } as User;
const client = {} as SupabaseClient<Database>;
const goalId = "22222222-2222-4222-8222-222222222222";
const periodId = "33333333-3333-4333-8333-333333333333";
const activeGoal = {
  id: goalId,
  user_id: user.id,
  title: "Caminhar",
  kind: "frequency",
  status: "active",
  recurrence: "daily",
  target: 3,
  unit: null,
  created_at: "2026-09-01T10:00:00.000Z",
  updated_at: "2026-09-01T10:00:00.000Z",
};

beforeEach(() => vi.clearAllMocks());

describe("metas fora de alcance", () => {
  it("status: zero linhas afetadas e meta nao encontrada, nao falha de servidor", async () => {
    vi.mocked(findGoal).mockResolvedValue(activeGoal);
    vi.mocked(updateGoalStatus).mockResolvedValue(null);

    await expect(
      changeGoalStatus(client, user, { id: goalId, status: "paused" }),
    ).rejects.toBeInstanceOf(GoalNotFoundError);
  });

  it("a mensagem nao distingue 'nao existe' de 'existe e nao e sua'", async () => {
    vi.mocked(findGoal).mockResolvedValue(activeGoal);
    vi.mocked(updateGoalStatus).mockResolvedValue(null);

    await expect(
      changeGoalStatus(client, user, { id: goalId, status: "paused" }),
    ).rejects.toThrow("Meta não encontrada.");
  });

  it("falha real do banco continua sendo falha de repositorio", async () => {
    vi.mocked(findGoal).mockResolvedValue(activeGoal);
    vi.mocked(updateGoalStatus).mockRejectedValue(new GoalsRepositoryError("update_status"));

    await expect(
      changeGoalStatus(client, user, { id: goalId, status: "paused" }),
    ).rejects.toBeInstanceOf(GoalsRepositoryError);
  });

  it("exclusao: zero linhas e ausencia; alcancar a propria meta devolve o id", async () => {
    vi.mocked(deleteGoal).mockResolvedValue(null);
    await expect(removeGoal(client, user, { id: goalId })).rejects.toBeInstanceOf(
      GoalNotFoundError,
    );

    vi.mocked(deleteGoal).mockResolvedValue(goalId);
    await expect(removeGoal(client, user, { id: goalId })).resolves.toEqual({ id: goalId });
  });
});

describe("ciclo fora de alcance", () => {
  it("periodo: zero linhas e ausencia, e falha de banco continua 500", async () => {
    vi.mocked(removeCyclePeriod).mockResolvedValue(null);
    await expect(
      deleteCyclePeriod(client, user, { id: periodId }),
    ).rejects.toBeInstanceOf(CycleNotFoundError);

    vi.mocked(removeCyclePeriod).mockRejectedValue(new CycleRepositoryError("delete_period"));
    await expect(
      deleteCyclePeriod(client, user, { id: periodId }),
    ).rejects.toBeInstanceOf(CycleRepositoryError);
  });

  it("registro do dia: zero linhas e ausencia; excluir o proprio devolve id e data", async () => {
    vi.mocked(removeCycleRecord).mockResolvedValue(null);
    await expect(
      deleteCycleDailyRecord(client, user, { date: "2026-09-17" }),
    ).rejects.toBeInstanceOf(CycleNotFoundError);

    vi.mocked(removeCycleRecord).mockResolvedValue(periodId);
    await expect(
      deleteCycleDailyRecord(client, user, { date: "2026-09-17" }),
    ).resolves.toEqual({ id: periodId, date: "2026-09-17" });
  });
});
