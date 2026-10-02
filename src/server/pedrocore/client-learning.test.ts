import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ELYRA_LEARNING_CONTRACT_VERSION,
  ELYRA_LEARNING_EXPORT_VERSION,
  ELYRA_LEARNING_INPUT_VERSION,
  ELYRA_LEARNING_OUTPUT_VERSION,
  ELYRA_LEARNING_POLICY_VERSION,
  REVOKE_OPERATION,
  SUBMIT_OPERATION,
  type ElyraLearningRevocation,
} from "@/lib/contracts/learning";
import { pedroCoreReportFixture } from "@/lib/contracts/pedrocore-fixtures";
import { buildLearningSubmission } from "@/lib/learning-pipeline";
import {
  ElyraPedroCoreClient,
  PedroCoreBlockedError,
  PedroCoreContractError,
  PedroCoreTimeoutError,
  PedroCoreUnavailableError,
  buildElyraLearningRequest,
} from "@/server/pedrocore/client";

const correlationId = "elyra-learning-request-001";
const idempotencyKey = "elyra-learning-idempotency-001";

const config = {
  baseUrl: "http://127.0.0.1:8000",
  apiKey: "elyra-test-credential",
  providerMode: "mock" as const,
  timeoutMs: 1_000,
};

function submission() {
  const outcome = buildLearningSubmission({
    report: pedroCoreReportFixture(),
    trainingConsentActive: true,
    trainingConsentGrantedAt: "2026-08-20T12:00:00.000Z",
    producedAt: "2026-08-26T12:00:00.000Z",
    evaluatedAt: "2026-08-26T12:00:00.000Z",
  });
  if (!outcome.ok) throw new Error("fixture deveria ser elegivel");
  return outcome;
}

function revocation(): ElyraLearningRevocation {
  return {
    contractVersion: ELYRA_LEARNING_CONTRACT_VERSION,
    inputSchemaVersion: ELYRA_LEARNING_INPUT_VERSION,
    operation: REVOKE_OPERATION,
    fingerprint: submission().fingerprint,
    reasonCode: "training_consent_revoked",
    revokedAt: "2026-08-27T12:00:00.000Z",
  };
}

function receipt(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: ELYRA_LEARNING_CONTRACT_VERSION,
    outputSchemaVersion: ELYRA_LEARNING_OUTPUT_VERSION,
    operation: SUBMIT_OPERATION,
    correlationId,
    candidateId: "training-candidate-37bb009aca089cc23d9b9fe0",
    lifecycle: "proposed",
    duplicate: false,
    policyVersion: ELYRA_LEARNING_POLICY_VERSION,
    trainingStarted: false,
    modelWeightsUpdated: false,
    ...overrides,
  };
}

function responseBody(overrides: Record<string, unknown> = {}) {
  return {
    status: "ok",
    task_type: "governed_learning_candidate_submission",
    origin_system: "elyra",
    provider_used: "none",
    model: "none",
    fallback_used: false,
    correlation_id: correlationId,
    idempotency_replayed: false,
    elyra_learning: receipt(),
    project_id: "elyra",
    task_allowed_for_project: true,
    ...overrides,
  };
}

function clientReturning(body: unknown, status = 200) {
  const fetcher = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  return { client: new ElyraPedroCoreClient(config, fetcher), fetcher };
}

async function submit(body: unknown, status = 200) {
  const { client } = clientReturning(body, status);
  return client.submitLearningCandidate(
    submission().submission,
    correlationId,
    idempotencyKey,
  );
}

describe("buildElyraLearningRequest", () => {
  it("publica caller, origin e task canonicos da capability de learning", () => {
    const request = buildElyraLearningRequest(
      submission().submission,
      correlationId,
      idempotencyKey,
    );

    expect(request).toMatchObject({
      message: "submeter_candidato_de_learning_governado",
      mode: "tecnico",
      task_type: "governed_learning_candidate_submission",
      origin_system: "elyra",
    });
  });

  it("governanca nunca consulta provider, nem real nem por fallback", () => {
    const request = buildElyraLearningRequest(
      submission().submission,
      correlationId,
      idempotencyKey,
    );

    expect(request.provider).toBe("mock");
    expect(request.model).toBeNull();
    expect(request.allow_real_provider).toBe(false);
    expect(request.allow_mock_fallback).toBe(false);
  });

  it("nao reutiliza a task textual nem a multimodal", () => {
    const request = buildElyraLearningRequest(
      submission().submission,
      correlationId,
      idempotencyKey,
    );

    expect(request.task_type).not.toBe("wellbeing_report_interpretation");
    expect(request.task_type).not.toBe(
      "multimodal_session_signal_interpretation",
    );
  });

  it("a request nao transporta conteudo bruto nem identificador", () => {
    const serialized = JSON.stringify(
      buildElyraLearningRequest(
        submission().submission,
        correlationId,
        idempotencyKey,
      ),
    );

    for (const forbidden of [
      "journal",
      "transcript",
      "userId",
      "user_id",
      "sessionId",
      "email",
      "storagePath",
      "elyra-private",
      "signedUrl",
      "professionalNote",
      "series",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("declara proveniencia e proposito de exportacao", () => {
    const request = buildElyraLearningRequest(
      submission().submission,
      correlationId,
      idempotencyKey,
    );

    expect(request.context).toMatchObject({
      provenance: { exportSchemaVersion: ELYRA_LEARNING_EXPORT_VERSION },
    });
  });

  it("aceita tambem a revogacao tipada", () => {
    const request = buildElyraLearningRequest(
      revocation(),
      correlationId,
      idempotencyKey,
    );

    expect(request.context.operation).toBe(REVOKE_OPERATION);
  });

  it("recusa fingerprint malformado", () => {
    expect(() =>
      buildElyraLearningRequest(
        { ...revocation(), fingerprint: "nao-e-hash" },
        correlationId,
        idempotencyKey,
      ),
    ).toThrow();
  });

  it("recusa motivo de revogacao fora do catalogo", () => {
    expect(() =>
      buildElyraLearningRequest(
        {
          ...revocation(),
          reasonCode: "mudei_de_ideia",
        } as unknown as ElyraLearningRevocation,
        correlationId,
        idempotencyKey,
      ),
    ).toThrow();
  });
});

describe("ElyraPedroCoreClient.submitLearningCandidate", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("aceita o recibo tipado", async () => {
    const result = await submit(responseBody());

    expect(result.candidateId).toBe("training-candidate-37bb009aca089cc23d9b9fe0");
    expect(result.lifecycle).toBe("proposed");
    expect(result.duplicate).toBe(false);
  });

  it("envia a credencial server-only e nao usa cache", async () => {
    const { client, fetcher } = clientReturning(responseBody());
    await client.submitLearningCandidate(
      submission().submission,
      correlationId,
      idempotencyKey,
    );

    const init = fetcher.mock.calls[0]![1];
    expect(
      (init.headers as Record<string, string>)["X-PedroCore-Api-Key"],
    ).toBe(config.apiKey);
    expect(init.cache).toBe("no-store");
  });

  it("recusa resposta que declara treino iniciado", async () => {
    await expect(
      submit(responseBody({ elyra_learning: receipt({ trainingStarted: true }) })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa resposta que declara pesos atualizados", async () => {
    await expect(
      submit(
        responseBody({ elyra_learning: receipt({ modelWeightsUpdated: true }) }),
      ),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa resposta que usou provider", async () => {
    await expect(
      submit(responseBody({ provider_used: "gemini", model: "gemini-3.5-flash" })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa correlacao divergente", async () => {
    await expect(
      submit(responseBody({ correlation_id: "outra-correlacao-999" })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa recibo com operacao divergente", async () => {
    await expect(
      submit(
        responseBody({
          elyra_learning: receipt({ operation: REVOKE_OPERATION }),
        }),
      ),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa recibo ausente", async () => {
    await expect(
      submit(responseBody({ elyra_learning: null })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa candidate id fora do formato do PedroCore", async () => {
    await expect(
      submit(responseBody({ elyra_learning: receipt({ candidateId: "abc" }) })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa lifecycle fora do catalogo do Dataset Foundation", async () => {
    await expect(
      submit(responseBody({ elyra_learning: receipt({ lifecycle: "trained" }) })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("traduz bloqueio da fronteira em erro tipado", async () => {
    await expect(
      submit(
        {
          status: "blocked",
          error_code: "ELYRA_LEARNING_TRAINING_CONSENT_REQUIRED",
          blocked_reason: "consentimento de treino ausente",
        },
        403,
      ),
    ).rejects.toBeInstanceOf(PedroCoreBlockedError);
  });

  it("nao faz retry apos timeout", async () => {
    const fetcher = vi.fn(async (_input: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    });
    const client = new ElyraPedroCoreClient({ ...config, timeoutMs: 100 }, fetcher);

    await expect(
      client.submitLearningCandidate(
        submission().submission,
        correlationId,
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(PedroCoreTimeoutError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("traduz falha de transporte em indisponibilidade", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const client = new ElyraPedroCoreClient(config, fetcher);

    await expect(
      client.submitLearningCandidate(
        submission().submission,
        correlationId,
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(PedroCoreUnavailableError);
  });
});

describe("ElyraPedroCoreClient.revokeLearningCandidate", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("propaga a revogacao e devolve o lifecycle terminal", async () => {
    const { client } = clientReturning(
      responseBody({
        elyra_learning: receipt({
          operation: REVOKE_OPERATION,
          lifecycle: "excluded",
        }),
      }),
    );

    const result = await client.revokeLearningCandidate(
      revocation(),
      correlationId,
      idempotencyKey,
    );

    expect(result.operation).toBe(REVOKE_OPERATION);
    expect(result.lifecycle).toBe("excluded");
  });

  it("revogar de novo e replay, nao erro", async () => {
    const { client } = clientReturning(
      responseBody({
        elyra_learning: receipt({
          operation: REVOKE_OPERATION,
          lifecycle: "excluded",
          duplicate: true,
        }),
      }),
    );

    const result = await client.revokeLearningCandidate(
      revocation(),
      correlationId,
      idempotencyKey,
    );

    expect(result.duplicate).toBe(true);
  });

  it("recusa submissao disfarcada de revogacao", async () => {
    const { client } = clientReturning(responseBody());

    await expect(
      client.revokeLearningCandidate(
        submission().submission as never,
        correlationId,
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });
});
