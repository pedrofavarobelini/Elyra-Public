import type { SupabaseClient, User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/repositories/learning-repository", () => ({
  LearningRepositoryError: class extends Error {},
  findExportByFingerprint: vi.fn(),
  findOwnedSnapshot: vi.fn(),
  insertExport: vi.fn(),
  isTrainingConsentActive: vi.fn(),
  listExports: vi.fn(),
  setTrainingConsent: vi.fn(),
  updateExport: vi.fn(),
}));

import { pedroCoreReportFixture } from "@/lib/contracts/pedrocore-fixtures";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  PedroCoreBlockedError,
  PedroCoreUnavailableError,
  type ElyraPedroCoreClient,
} from "@/server/pedrocore/client";
import {
  findExportByFingerprint,
  findOwnedSnapshot,
  insertExport,
  isTrainingConsentActive,
  updateExport,
} from "@/server/repositories/learning-repository";
import {
  LearningServiceError,
  exportSnapshotForLearning,
  revokeLearningExport,
} from "@/server/services/learning-service";



const user = { id: "11111111-1111-4111-8111-111111111111" } as User;
const snapshotId = "22222222-2222-4222-8222-222222222222";
const client = {} as SupabaseClient<Database>;

let submit: ReturnType<typeof vi.fn>;
let revoke: ReturnType<typeof vi.fn>;

function factory() {
  return () =>
    ({
      submitLearningCandidate: submit,
      revokeLearningCandidate: revoke,
    }) as unknown as ElyraPedroCoreClient;
}

/** Relatorio raso: consentido, porem sem historico que sustente um candidato. */
function thinReport() {
  const report = pedroCoreReportFixture();
  return {
    ...report,
    dataQuality: {
      daysInWindow: 28,
      daysWithMood: 1,
      daysWithAnxiety: 0,
      daysWithEnergy: 0,
      daysWithSleep: 0,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // `exportSnapshotForLearning` monta a configuracao antes de aplicar a
  // fabrica injetada, entao o ambiente precisa existir mesmo com cliente falso.
  // Modo `mock`, sem provider real: nenhum teste desta suite sai da maquina.
  vi.stubEnv("PEDROCORE_ELYRA_API_KEY", "elyra-test-key");
  vi.stubEnv("PEDROCORE_BASE_URL", "http://127.0.0.1:8000");
  vi.stubEnv("PEDROCORE_PROVIDER_MODE", "mock");

  submit = vi.fn(async () => ({
    candidateId: "candidate-1",
    lifecycle: "proposed" as const,
    duplicate: false,
    trainingStarted: false,
    modelWeightsUpdated: false,
  }));
  revoke = vi.fn(async () => ({
    candidateId: "candidate-1",
    lifecycle: "revoked" as const,
    duplicate: false,
    trainingStarted: false,
    modelWeightsUpdated: false,
  }));

  vi.mocked(isTrainingConsentActive).mockResolvedValue(true);
  vi.mocked(findOwnedSnapshot).mockResolvedValue({
    id: snapshotId,
    user_id: user.id,
    payload: pedroCoreReportFixture() as unknown as Json,
    created_at: "2026-08-28T10:00:00.000Z",
  } as never);
  vi.mocked(findExportByFingerprint).mockResolvedValue(null);
  // Colunas ausentes voltam do banco como `null`, nunca `undefined`. O mock
  // precisa ter a mesma forma, senao ele esconde exatamente o tipo de confusao
  // entre ausencia e indefinicao que a V1 proibe.
  vi.mocked(insertExport).mockImplementation(
    async (_client, input) =>
      ({
        id: "export-1",
        candidate_id: null,
        candidate_lifecycle: null,
        rejection_code: null,
        exported_at: null,
        revoked_at: null,
        revocation_reason: null,
        ...input,
      }) as never,
  );
  vi.mocked(updateExport).mockImplementation(
    async (_client, _id, _userId, patch) =>
      ({
        id: "export-1",
        user_id: user.id,
        report_snapshot_id: snapshotId,
        fingerprint: "f".repeat(64),
        status: "eligible",
        rejection_code: null,
        candidate_id: null,
        candidate_lifecycle: null,
        produced_at: "2026-08-28T10:00:00.000Z",
        exported_at: null,
        revoked_at: null,
        revocation_reason: null,
        ...patch,
      }) as never,
  );
});

afterEach(() => vi.unstubAllEnvs());

describe("exportSnapshotForLearning - consentimento", () => {
  it("recusa exportar sem consentimento de treino vigente", async () => {
    vi.mocked(isTrainingConsentActive).mockResolvedValue(false);
    await expect(
      exportSnapshotForLearning(client, user, snapshotId, factory()),
    ).rejects.toBeInstanceOf(LearningServiceError);
    expect(submit).not.toHaveBeenCalled();
    expect(insertExport).not.toHaveBeenCalled();
  });

  it("nao atravessa a fronteira antes de decidir localmente", async () => {
    vi.mocked(isTrainingConsentActive).mockResolvedValue(false);
    await exportSnapshotForLearning(client, user, snapshotId, factory()).catch(
      () => undefined,
    );
    // A Elyra decide antes de falar: um candidato sem consentimento nunca sai.
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("exportSnapshotForLearning - elegibilidade", () => {
  it("consentimento nao basta: relatorio raso nao vira candidato", async () => {
    vi.mocked(findOwnedSnapshot).mockResolvedValue({
      id: snapshotId,
      user_id: user.id,
      payload: thinReport() as unknown as Json,
      created_at: "2026-08-28T10:00:00.000Z",
    } as never);

    const result = await exportSnapshotForLearning(
      client,
      user,
      snapshotId,
      factory(),
    );

    expect(result.status).toBe("rejected");
    expect(result.rejectionCode).toBe("insufficient_data");
    expect(result.candidateId).toBeNull();
    expect(submit).not.toHaveBeenCalled();
  });

  it("registra a recusa como governanca, e nao como erro silencioso", async () => {
    vi.mocked(findOwnedSnapshot).mockResolvedValue({
      id: snapshotId,
      user_id: user.id,
      payload: thinReport() as unknown as Json,
      created_at: "2026-08-28T10:00:00.000Z",
    } as never);
    await exportSnapshotForLearning(client, user, snapshotId, factory());
    expect(vi.mocked(insertExport).mock.calls[0]![1]).toMatchObject({
      status: "rejected",
      quality_passed: false,
    });
  });

  it("recusa snapshot sem proveniencia valida", async () => {
    vi.mocked(findOwnedSnapshot).mockResolvedValue({
      id: snapshotId,
      user_id: user.id,
      payload: { qualquer: "coisa" } as unknown as Json,
      created_at: "2026-08-28T10:00:00.000Z",
    } as never);
    await expect(
      exportSnapshotForLearning(client, user, snapshotId, factory()),
    ).rejects.toMatchObject({ rejectionCode: "provenance_invalid" });
  });
});

describe("exportSnapshotForLearning - export elegivel", () => {
  it("exporta e registra a referencia do Candidate", async () => {
    const result = await exportSnapshotForLearning(
      client,
      user,
      snapshotId,
      factory(),
    );
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("exported");
    expect(result.candidateId).toBe("candidate-1");
    expect(result.candidateLifecycle).toBe("proposed");
  });

  it("nunca envia texto livre ao PedroCore", async () => {
    await exportSnapshotForLearning(client, user, snapshotId, factory());
    const payload = JSON.stringify(submit.mock.calls[0]![0]);
    expect(payload).not.toContain(user.id);
    expect(payload).not.toContain(snapshotId);
  });
});

describe("exportSnapshotForLearning - idempotencia", () => {
  it("nao cria segundo export nem segundo Candidate para o mesmo conteudo", async () => {
    vi.mocked(findExportByFingerprint).mockResolvedValue({
      id: "export-existing",
      user_id: user.id,
      report_snapshot_id: snapshotId,
      fingerprint: "a".repeat(64),
      status: "exported",
      rejection_code: null,
      candidate_id: "candidate-1",
      candidate_lifecycle: "proposed",
      produced_at: "2026-08-28T10:00:00.000Z",
      exported_at: "2026-08-28T10:01:00.000Z",
      revoked_at: null,
      revocation_reason: null,
    } as never);

    const result = await exportSnapshotForLearning(
      client,
      user,
      snapshotId,
      factory(),
    );

    expect(result.replayed).toBe(true);
    expect(result.status).toBe("exported");
    expect(submit).not.toHaveBeenCalled();
    expect(insertExport).not.toHaveBeenCalled();
  });

  it("resolve a corrida lendo o export vencedor", async () => {
    vi.mocked(insertExport).mockResolvedValue(null);
    vi.mocked(findExportByFingerprint)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "export-winner",
        user_id: user.id,
        report_snapshot_id: snapshotId,
        fingerprint: "b".repeat(64),
        status: "exported",
        rejection_code: null,
        candidate_id: "candidate-1",
        candidate_lifecycle: "proposed",
        produced_at: "2026-08-28T10:00:00.000Z",
        exported_at: "2026-08-28T10:01:00.000Z",
        revoked_at: null,
        revocation_reason: null,
      } as never);

    const result = await exportSnapshotForLearning(
      client,
      user,
      snapshotId,
      factory(),
    );
    expect(result.replayed).toBe(true);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("exportSnapshotForLearning - falha da fronteira", () => {
  it("registra recusa do PedroCore sem perder o registro de governanca", async () => {
    submit.mockRejectedValue(new PedroCoreBlockedError("ELYRA_LEARNING_DENIED"));
    const result = await exportSnapshotForLearning(
      client,
      user,
      snapshotId,
      factory(),
    );
    expect(result.status).toBe("rejected");
    expect(result.rejectionCode).toBe("pedrocore_denied");
  });

  it("propaga indisponibilidade em vez de fingir sucesso", async () => {
    submit.mockRejectedValue(new PedroCoreUnavailableError());
    await expect(
      exportSnapshotForLearning(client, user, snapshotId, factory()),
    ).rejects.toBeInstanceOf(PedroCoreUnavailableError);
  });
});

describe("exportSnapshotForLearning - isolamento", () => {
  it("recusa snapshot que nao e do proprio usuario", async () => {
    // O repositorio filtra por `user_id`; sem linha, nao ha export.
    vi.mocked(findOwnedSnapshot).mockResolvedValue(null);
    await expect(
      exportSnapshotForLearning(client, user, snapshotId, factory()),
    ).rejects.toMatchObject({ reason: "snapshot_not_found" });
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("revokeLearningExport", () => {
  it("revoga o Candidate do outro lado da fronteira", async () => {
    vi.mocked(findExportByFingerprint).mockResolvedValue({
      id: "export-1",
      user_id: user.id,
      report_snapshot_id: snapshotId,
      fingerprint: "c".repeat(64),
      status: "exported",
      rejection_code: null,
      candidate_id: "candidate-1",
      candidate_lifecycle: "proposed",
      produced_at: "2026-08-28T10:00:00.000Z",
      exported_at: "2026-08-28T10:01:00.000Z",
      revoked_at: null,
      revocation_reason: null,
    } as never);

    const result = await revokeLearningExport(
      client,
      user,
      "c".repeat(64),
      "training_consent_revoked",
      factory(),
    );

    expect(revoke).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("revoked");
    expect(result.candidateLifecycle).toBe("revoked");
  });

  it("revogar de novo e replay, nao erro", async () => {
    vi.mocked(findExportByFingerprint).mockResolvedValue({
      id: "export-1",
      user_id: user.id,
      report_snapshot_id: snapshotId,
      fingerprint: "d".repeat(64),
      status: "revoked",
      rejection_code: null,
      candidate_id: "candidate-1",
      candidate_lifecycle: "revoked",
      produced_at: "2026-08-28T10:00:00.000Z",
      exported_at: "2026-08-28T10:01:00.000Z",
      revoked_at: "2026-08-28T11:00:00.000Z",
      revocation_reason: "training_consent_revoked",
    } as never);

    const result = await revokeLearningExport(
      client,
      user,
      "d".repeat(64),
      "training_consent_revoked",
      factory(),
    );
    expect(result.replayed).toBe(true);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("nao chama a fronteira para export que nunca virou Candidate", async () => {
    vi.mocked(findExportByFingerprint).mockResolvedValue({
      id: "export-1",
      user_id: user.id,
      report_snapshot_id: snapshotId,
      fingerprint: "e".repeat(64),
      status: "rejected",
      rejection_code: "insufficient_data",
      candidate_id: null,
      candidate_lifecycle: null,
      produced_at: "2026-08-28T10:00:00.000Z",
      exported_at: null,
      revoked_at: null,
      revocation_reason: null,
    } as never);

    const result = await revokeLearningExport(
      client,
      user,
      "e".repeat(64),
      "eligibility_lost",
      factory(),
    );
    expect(revoke).not.toHaveBeenCalled();
    expect(result.status).toBe("revoked");
  });
});
