import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  pedroCoreOutputFixture,
  pedroCoreReportFixture,
} from "@/lib/contracts/pedrocore-fixtures";
import {
  ElyraPedroCoreClient,
  PedroCoreConfigurationError,
  PedroCoreContractError,
  PedroCoreTimeoutError,
  PedroCoreUnavailableError,
  buildElyraOrchestrateRequest,
  createElyraTextualInput,
  pedroCoreConfigFromEnvironment,
} from "@/server/pedrocore/client";

const correlationId = "elyra-stage09-request-001";
const idempotencyKey = "elyra-stage09-idempotency-001";

function responseBody(overrides: Record<string, unknown> = {}) {
  const output = pedroCoreOutputFixture(correlationId);
  return {
    status: "ok",
    answer: output.summary,
    task_type: "wellbeing_report_interpretation",
    origin_system: "elyra",
    provider_requested: "mock",
    provider_used: "mock",
    model: "mock-v1",
    mode: "tecnico",
    fallback_used: false,
    correlation_id: correlationId,
    idempotency_replayed: false,
    elyra: output,
    project_id: "elyra",
    task_allowed_for_project: true,
    audit: { correlation_id: correlationId },
    ...overrides,
  };
}

describe("orcamento de espera alinhado com o servico", () => {
  const base = {
    PEDROCORE_BASE_URL: "http://127.0.0.1:8000",
    PEDROCORE_ELYRA_API_KEY: "chave-de-teste",
    PEDROCORE_PROVIDER_MODE: "mock",
  };

  it("sem declaracao, a rota multimodal espera mais que a textual", () => {

    const config = pedroCoreConfigFromEnvironment(base);
    expect(config.timeoutMs).toBe(8_000);
    expect(config.multimodalTimeoutMs).toBe(30_000);
  });

  it("declaracao explicita vence nas duas rotas, para mais e para menos", () => {
    // Um `Math.max` aqui pareceria prudente e ignoraria em silencio uma
    // configuracao escrita de proposito.
    const curto = pedroCoreConfigFromEnvironment({
      ...base,
      PEDROCORE_TIMEOUT_MS: "500",
    });
    expect(curto.timeoutMs).toBe(500);
    expect(curto.multimodalTimeoutMs).toBe(500);

    const longo = pedroCoreConfigFromEnvironment({
      ...base,
      PEDROCORE_TIMEOUT_MS: "20000",
    });
    expect(longo.multimodalTimeoutMs).toBe(20_000);
  });

  it("espera infinita continua recusada", () => {
    // Paciencia tem teto: acima do limite do servico, esperar so prende a sessao.
    expect(() =>
      pedroCoreConfigFromEnvironment({ ...base, PEDROCORE_TIMEOUT_MS: "60000" }),
    ).toThrow();
  });
});

describe("ElyraPedroCoreClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("monta somente caller/origin/task/capability publicados", () => {
    const request = buildElyraOrchestrateRequest(
      createElyraTextualInput(pedroCoreReportFixture()),
      correlationId,
      idempotencyKey,
      "mock",
    );
    expect(request).toMatchObject({
      message: "interpretar_relatorio_deterministico",
      provider: "mock",
      model: null,
      task_type: "wellbeing_report_interpretation",
      origin_system: "elyra",
      allow_real_provider: false,
      allow_mock_fallback: true,
    });
    expect(JSON.stringify(request)).not.toContain("rawJournal");
  });

  it("envia a credential somente no header server-only e valida o mock", async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      expect(new Headers(init.headers).get("X-PedroCore-Api-Key")).toBe(
        "synthetic-elyra-key",
      );
      expect(init.body).not.toContain("synthetic-elyra-key");
      return Response.json(responseBody());
    });
    const client = new ElyraPedroCoreClient(
      {
        baseUrl: "http://127.0.0.1:8000",
        apiKey: "synthetic-elyra-key",
        providerMode: "mock",
        timeoutMs: 1_000,
      },
      fetcher,
    );
    const result = await client.interpretDeterministicReport(
      createElyraTextualInput(pedroCoreReportFixture()),
      correlationId,
      idempotencyKey,
    );
    expect(result.provider_used).toBe("mock");
    expect(result.fallback_used).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("recusa output parcial, correlation divergente e fallback", async () => {
    for (const body of [
      responseBody({ elyra: { summary: "parcial" } }),
      responseBody({ correlation_id: "elyra-stage09-request-other" }),
      responseBody({ fallback_used: true }),
    ]) {
      const client = new ElyraPedroCoreClient(
        {
          baseUrl: "http://127.0.0.1:8000",
          apiKey: "synthetic-elyra-key",
          providerMode: "mock",
          timeoutMs: 1_000,
        },
        async () => Response.json(body),
      );
      await expect(
        client.interpretDeterministicReport(
          createElyraTextualInput(pedroCoreReportFixture()),
          correlationId,
          idempotencyKey,
        ),
      ).rejects.toBeInstanceOf(PedroCoreContractError);
    }
  });

  it("degrada indisponibilidade sem retry", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("network unavailable");
    });
    const client = new ElyraPedroCoreClient(
      {
        baseUrl: "http://127.0.0.1:8000",
        apiKey: "synthetic-elyra-key",
        providerMode: "mock",
        timeoutMs: 1_000,
      },
      fetcher,
    );
    await expect(
      client.interpretDeterministicReport(
        createElyraTextualInput(pedroCoreReportFixture()),
        correlationId,
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(PedroCoreUnavailableError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("aborta timeout sem segunda tentativa", async () => {
    const fetcher = vi.fn(
      async (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const client = new ElyraPedroCoreClient(
      {
        baseUrl: "http://127.0.0.1:8000",
        apiKey: "synthetic-elyra-key",
        providerMode: "mock",
        timeoutMs: 5,
      },
      fetcher,
    );
    await expect(
      client.interpretDeterministicReport(
        createElyraTextualInput(pedroCoreReportFixture()),
        correlationId,
        idempotencyKey,
      ),
    ).rejects.toBeInstanceOf(PedroCoreTimeoutError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("falha fechado sem base URL/key e proibe real em production", () => {
    expect(() => pedroCoreConfigFromEnvironment({})).toThrow(
      PedroCoreConfigurationError,
    );
    expect(() =>
      pedroCoreConfigFromEnvironment({
        PEDROCORE_BASE_URL: "https://pedrocore.invalid",
        PEDROCORE_ELYRA_API_KEY: "synthetic-elyra-key",
        PEDROCORE_PROVIDER_MODE: "auto",
        PEDROCORE_ALLOW_REAL_PROVIDER: "true",
        ELYRA_RUNTIME_ENV: "production",
      }),
    ).toThrow(PedroCoreConfigurationError);
  });
});
