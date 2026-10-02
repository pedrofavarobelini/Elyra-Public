import type { SupabaseClient, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/repositories/ai-insights-repository", () => ({
  AiInsightsRepositoryError: class AiInsightsRepositoryError extends Error {
    constructor(
      public readonly operation: string,
      public readonly code?: string,
    ) {
      super(operation);
    }
  },
  findInsightByIdempotency: vi.fn(),
  findOwnedReportSnapshot: vi.fn(),
  insertAiInsight: vi.fn(),
  setAiInferenceConsent: vi.fn(),
}));
vi.mock("@/server/repositories/identity-repository", () => ({
  appendAudit: vi.fn(),
}));

import {
  ELYRA_TEXTUAL_CONTRACT_VERSION,
  ELYRA_TEXTUAL_OPERATION,
  ELYRA_TEXTUAL_OUTPUT_VERSION,
} from "@/lib/contracts/pedrocore";
import {
  pedroCoreOutputFixture,
  pedroCoreReportFixture,
} from "@/lib/contracts/pedrocore-fixtures";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  findInsightByIdempotency,
  findOwnedReportSnapshot,
  insertAiInsight,
  setAiInferenceConsent,
} from "@/server/repositories/ai-insights-repository";
import { appendAudit } from "@/server/repositories/identity-repository";
import {
  type ElyraPedroCoreClient,
  PedroCoreUnavailableError,
} from "@/server/pedrocore/client";
import {
  AiInsightServiceError,
  createAiInsight,
} from "@/server/services/ai-insights-service";

const user = { id: "11111111-1111-4111-8111-111111111111" } as User;
const snapshotId = "22222222-2222-4222-8222-222222222222";
const client = {} as SupabaseClient<Database>;
const request = {
  reportSnapshotId: snapshotId,
  idempotencyKey: "elyra-stage09-idempotency-001",
  aiInferenceConsent: true,
};

function dependencies(
  interpret: ReturnType<typeof vi.fn>,
): { createPedroCoreClient: () => ElyraPedroCoreClient } {
  return {
    createPedroCoreClient: () =>
      ({ interpretDeterministicReport: interpret }) as unknown as ElyraPedroCoreClient,
  };
}

describe("createAiInsight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findOwnedReportSnapshot).mockResolvedValue({
      id: snapshotId,
      user_id: user.id,
      payload: pedroCoreReportFixture() as unknown as Json,
    });
    vi.mocked(findInsightByIdempotency).mockResolvedValue(null);
    vi.mocked(setAiInferenceConsent).mockResolvedValue(
      "33333333-3333-4333-8333-333333333333",
    );
    vi.mocked(appendAudit).mockResolvedValue(undefined);
    vi.mocked(insertAiInsight).mockImplementation(async (_client, input) => ({
      id: "44444444-4444-4444-8444-444444444444",
      user_id: input.user_id,
      report_snapshot_id: input.report_snapshot_id,
      contract_version:
        input.contract_version ?? ELYRA_TEXTUAL_CONTRACT_VERSION,
      output_schema_version:
        input.output_schema_version ?? ELYRA_TEXTUAL_OUTPUT_VERSION,
      operation: input.operation ?? ELYRA_TEXTUAL_OPERATION,
      correlation_id: input.correlation_id,
      idempotency_key_fingerprint: input.idempotency_key_fingerprint,
      request_fingerprint: input.request_fingerprint,
      provider_used: input.provider_used,
      model: input.model,
      fallback_used: input.fallback_used ?? false,
      output: input.output,
      created_at: "2026-08-25T20:00:00.000Z",
    }));
  });

  it("nega antes de snapshot ou PedroCore sem consentimento explicito", async () => {
    const interpret = vi.fn();
    await expect(
      createAiInsight(
        client,
        user,
        { ...request, aiInferenceConsent: false },
        dependencies(interpret),
      ),
    ).rejects.toMatchObject({
      code: "AI_INFERENCE_CONSENT_REQUIRED",
      status: 403,
    });
    expect(findOwnedReportSnapshot).not.toHaveBeenCalled();
    expect(interpret).not.toHaveBeenCalled();
    expect(appendAudit).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ outcome: "denied" }),
    );
  });

  it("minimiza ao snapshot, persiste output separado e nunca guarda a key bruta", async () => {
    const interpret = vi.fn(async (input, correlationId) => ({
      provider_used: "mock",
      model: "mock-v1",
      elyra: pedroCoreOutputFixture(correlationId),
    }));
    const result = await createAiInsight(
      client,
      user,
      request,
      dependencies(interpret),
    );
    expect(interpret).toHaveBeenCalledWith(
      expect.objectContaining({
        aiInferenceConsent: true,
        report: pedroCoreReportFixture(),
      }),
      expect.any(String),
      request.idempotencyKey,
    );
    expect(setAiInferenceConsent).toHaveBeenCalledWith(client, true);
    const inserted = vi.mocked(insertAiInsight).mock.calls[0]?.[1];
    expect(inserted?.idempotency_key_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(inserted?.idempotency_key_fingerprint).not.toContain(
      request.idempotencyKey,
    );
    expect(inserted?.report_snapshot_id).toBe(snapshotId);
    expect(result.output.sourceAnalyticsVersion).toBe("elyra-analytics/v1");
    expect(result.idempotencyReplayed).toBe(false);
  });

  it("reusa o outcome local para mesma key e mesmo request", async () => {
    const interpret = vi.fn(async (_input, correlationId) => ({
      provider_used: "mock",
      model: "mock-v1",
      elyra: pedroCoreOutputFixture(correlationId),
    }));
    const first = await createAiInsight(
      client,
      user,
      request,
      dependencies(interpret),
    );
    const persisted = vi.mocked(insertAiInsight).mock.results[0]?.value;
    const row = await persisted;
    vi.mocked(findInsightByIdempotency).mockResolvedValue(row);
    const replay = await createAiInsight(
      client,
      user,
      request,
      dependencies(interpret),
    );
    expect(first.id).toBe(replay.id);
    expect(replay.idempotencyReplayed).toBe(true);
    expect(interpret).toHaveBeenCalledTimes(1);
  });

  it("recusa a mesma key com payload diferente antes do dispatch", async () => {
    vi.mocked(findInsightByIdempotency).mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      user_id: user.id,
      report_snapshot_id: snapshotId,
      contract_version: ELYRA_TEXTUAL_CONTRACT_VERSION,
      output_schema_version: ELYRA_TEXTUAL_OUTPUT_VERSION,
      operation: ELYRA_TEXTUAL_OPERATION,
      correlation_id: "55555555-5555-4555-8555-555555555555",
      idempotency_key_fingerprint: "a".repeat(64),
      request_fingerprint: "b".repeat(64),
      provider_used: "mock",
      model: "mock-v1",
      fallback_used: false,
      output: pedroCoreOutputFixture(
        "55555555-5555-4555-8555-555555555555",
      ) as unknown as Json,
      created_at: "2026-08-25T20:00:00.000Z",
    });
    const interpret = vi.fn();
    await expect(
      createAiInsight(client, user, request, dependencies(interpret)),
    ).rejects.toMatchObject({ code: "ELYRA_IDEMPOTENCY_CONFLICT", status: 409 });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("degrada indisponibilidade e audita falha sem persistir insight", async () => {
    const interpret = vi.fn(async () => {
      throw new PedroCoreUnavailableError();
    });
    await expect(
      createAiInsight(client, user, request, dependencies(interpret)),
    ).rejects.toBeInstanceOf(AiInsightServiceError);
    expect(insertAiInsight).not.toHaveBeenCalled();
    expect(appendAudit).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ outcome: "failure" }),
    );
  });
});
