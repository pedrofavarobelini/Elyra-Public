import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  multimodalInputFixture,
  multimodalOutputFixture,
} from "@/lib/contracts/multimodal-fixtures";
import {
  ElyraPedroCoreClient,
  PedroCoreBlockedError,
  PedroCoreContractError,
  PedroCoreTimeoutError,
  PedroCoreUnavailableError,
  buildElyraMultimodalRequest,
} from "@/server/pedrocore/client";

const correlationId = "elyra-stage12-request-001";
const idempotencyKey = "elyra-stage12-idempotency-001";

const config = {
  baseUrl: "http://127.0.0.1:8000",
  apiKey: "elyra-test-credential",
  providerMode: "mock" as const,
  timeoutMs: 1_000,
};

function responseBody(overrides: Record<string, unknown> = {}) {
  const projection = multimodalOutputFixture(correlationId);
  return {
    status: "ok",
    answer: projection.summary,
    task_type: "multimodal_session_signal_interpretation",
    origin_system: "elyra",
    provider_requested: "mock",
    provider_used: "mock",
    model: "mock-v1",
    mode: "tecnico",
    fallback_used: false,
    correlation_id: correlationId,
    idempotency_replayed: false,
    elyra_multimodal: projection,
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

async function interpret(body: unknown, status = 200) {
  const { client } = clientReturning(body, status);
  return client.interpretSessionSignals(
    multimodalInputFixture(),
    correlationId,
    idempotencyKey,
  );
}

describe("buildElyraMultimodalRequest", () => {
  it("publica caller, origin e task canonicos da capability multimodal", () => {
    const request = buildElyraMultimodalRequest(
      multimodalInputFixture(),
      correlationId,
      idempotencyKey,
      "mock",
    );

    expect(request).toMatchObject({
      message: "interpretar_sinais_observaveis_de_sessao",
      mode: "tecnico",
      provider: "mock",
      model: null,
      task_type: "multimodal_session_signal_interpretation",
      origin_system: "elyra",
      allow_real_provider: false,
    });
  });

  it("nunca reutiliza a task textual", () => {
    const request = buildElyraMultimodalRequest(
      multimodalInputFixture(),
      correlationId,
      idempotencyKey,
      "mock",
    );

    expect(request.task_type).not.toBe("wellbeing_report_interpretation");
    expect(request.message).not.toBe("interpretar_relatorio_deterministico");
  });

  it("em modo real exige provider real sem fallback de mock", () => {
    const request = buildElyraMultimodalRequest(
      multimodalInputFixture(),
      correlationId,
      idempotencyKey,
      "auto",
    );

    expect(request.allow_real_provider).toBe(true);
    expect(request.allow_mock_fallback).toBe(false);
  });

  it("a request nao transporta midia, caminho de Storage ou identificador", () => {
    const serialized = JSON.stringify(
      buildElyraMultimodalRequest(
        multimodalInputFixture(),
        correlationId,
        idempotencyKey,
        "mock",
      ),
    );

    for (const forbidden of [
      "elyra-private",
      "storagePath",
      "storage_path",
      "userId",
      "user_id",
      "sessionId",
      "webm",
      "signedUrl",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("recusa montar request com transcricao sem consentimento", () => {
    const input = multimodalInputFixture();
    const corrupted = { ...input, transcriptAnalysisConsent: false };

    expect(() =>
      buildElyraMultimodalRequest(
        corrupted as typeof input,
        correlationId,
        idempotencyKey,
        "mock",
      ),
    ).toThrow();
  });
});

describe("ElyraPedroCoreClient.interpretSessionSignals", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("aceita a projecao tipada completa", async () => {
    const outcome = await interpret(responseBody());

    expect(outcome.elyra_multimodal.correlationId).toBe(correlationId);
    expect(outcome.elyra_multimodal.contractVersion).toBe("elyra-multimodal/v2");
    expect(outcome.elyra_multimodal.safety.emotionInferredFromSignal).toBe(false);
    expect(outcome.elyra_multimodal.safety.rawMediaAccessed).toBe(false);
  });

  it("envia a credencial server-only no header dedicado", async () => {
    const { client, fetcher } = clientReturning(responseBody());
    await client.interpretSessionSignals(
      multimodalInputFixture(),
      correlationId,
      idempotencyKey,
    );

    const init = fetcher.mock.calls[0]![1];
    expect(
      (init.headers as Record<string, string>)["X-PedroCore-Api-Key"],
    ).toBe(config.apiKey);
    expect(init.cache).toBe("no-store");
  });

  it("recusa correlacao divergente", async () => {
    await expect(
      interpret(responseBody({ correlation_id: "outra-correlacao-999" })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa projecao ausente", async () => {
    await expect(
      interpret(responseBody({ elyra_multimodal: null })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa resposta cuja answer diverge do summary", async () => {
    await expect(
      interpret(responseBody({ answer: "outra coisa" })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa fallback silencioso mesmo com status ok", async () => {
    await expect(
      interpret(responseBody({ fallback_used: true })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa provider divergente do modo configurado", async () => {
    await expect(
      interpret(responseBody({ provider_used: "gemini", model: "gemini-3.5-flash" })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa projecao que declara acesso a midia bruta", async () => {
    const projection = multimodalOutputFixture(correlationId);
    const corrupted = {
      ...projection,
      safety: { ...projection.safety, rawMediaAccessed: true },
    };

    await expect(
      interpret(responseBody({ elyra_multimodal: corrupted })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa projecao que declara inferencia de emocao", async () => {
    const projection = multimodalOutputFixture(correlationId);
    const corrupted = {
      ...projection,
      safety: { ...projection.safety, emotionInferredFromSignal: true },
    };

    await expect(
      interpret(responseBody({ elyra_multimodal: corrupted })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("recusa disclaimer alterado", async () => {
    const projection = multimodalOutputFixture(correlationId);
    const corrupted = { ...projection, disclaimer: "apenas informativo" };

    await expect(
      interpret(responseBody({ elyra_multimodal: corrupted })),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it("traduz bloqueio do PedroCore em erro tipado", async () => {
    await expect(
      interpret(
        {
          status: "blocked",
          error_code: "ELYRA_MULTIMODAL_CONSENT_REQUIRED",
          blocked_reason: "consentimento ausente",
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
      client.interpretSessionSignals(
        multimodalInputFixture(),
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
      client.interpretSessionSignals(
        multimodalInputFixture(),
        correlationId,
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(PedroCoreUnavailableError);
  });

  it("recusa corpo que nao e JSON", async () => {
    const fetcher = vi.fn(
      async () => new Response("<html>erro</html>", { status: 200 }),
    );
    const client = new ElyraPedroCoreClient(config, fetcher);

    await expect(
      client.interpretSessionSignals(
        multimodalInputFixture(),
        correlationId,
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(PedroCoreContractError);
  });
});
