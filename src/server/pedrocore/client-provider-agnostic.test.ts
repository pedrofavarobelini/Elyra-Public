import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  multimodalInputFixture,
  multimodalOutputFixture,
} from "@/lib/contracts/multimodal-fixtures";
import {
  VELTRIX_NON_INFERENCE_PROVIDER_IDS,
  elyraOrchestrateSuccessSchema,
  veltrixProviderIdSchema,
} from "@/lib/contracts/pedrocore";
import {
  pedroCoreOutputFixture,
  pedroCoreReportFixture,
} from "@/lib/contracts/pedrocore-fixtures";
import { analysisInterpretationViewSchema } from "@/lib/contracts/session-analysis";
import {
  ElyraPedroCoreClient,
  PedroCoreContractError,
  buildElyraMultimodalRequest,
  buildElyraOrchestrateRequest,
  createElyraTextualInput,
  pedroCoreConfigFromEnvironment,
  type PedroCoreClientConfig,
} from "@/server/pedrocore/client";

/**
 * ADR-0034: a Elyra e consumer. Ela pede `provider=auto` sem modelo e aceita a
 * resposta de QUALQUER provider que o Veltrix tenha escolhido, desde que o
 * contrato seja valido. Ela nunca decide nem autoriza provider pelo nome.
 */

const textualCorrelation = "elyra-stage09-request-001";
const multimodalCorrelation = "elyra-stage12-request-001";
const idempotencyKey = "elyra-provider-agnostic-001";

const VELTRIX_PROVIDERS = [
  ["gemini", "gemini-3.5-flash"],
  ["claude", "claude-sonnet-4-5"],
  ["openai", "gpt-5.2-mini"],
  ["grok", "grok-4.3"],
  ["deepseek", "deepseek-chat"],
  // Um provider que ainda nem existe hoje: homologa-lo no Veltrix nao pode
  // exigir mudanca de codigo aqui.
  ["future-provider", "future-model-1"],
] as const;

const PROVIDER_KEY_NAMES = [
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "DEEPSEEK_API_KEY",
] as const;

function config(providerMode: "mock" | "auto"): PedroCoreClientConfig {
  return {
    baseUrl: "http://127.0.0.1:8000",
    apiKey: "synthetic-elyra-key",
    providerMode,
    timeoutMs: 1_000,
  };
}

function textualBody(overrides: Record<string, unknown>) {
  const output = pedroCoreOutputFixture(textualCorrelation);
  return {
    status: "ok",
    answer: output.summary,
    task_type: "wellbeing_report_interpretation",
    origin_system: "elyra",
    provider_requested: "auto",
    provider_used: "gemini",
    model: "gemini-3.5-flash",
    mode: "tecnico",
    fallback_used: false,
    correlation_id: textualCorrelation,
    idempotency_replayed: false,
    elyra: output,
    project_id: "elyra",
    task_allowed_for_project: true,
    audit: { correlation_id: textualCorrelation },
    ...overrides,
  };
}

function multimodalBody(overrides: Record<string, unknown>) {
  const projection = multimodalOutputFixture(multimodalCorrelation);
  return {
    status: "ok",
    answer: projection.summary,
    task_type: "multimodal_session_signal_interpretation",
    origin_system: "elyra",
    provider_requested: "auto",
    provider_used: "gemini",
    model: "gemini-3.5-flash",
    mode: "tecnico",
    fallback_used: false,
    correlation_id: multimodalCorrelation,
    idempotency_replayed: false,
    elyra_multimodal: projection,
    project_id: "elyra",
    task_allowed_for_project: true,
    ...overrides,
  };
}

function interpretTextual(mode: "mock" | "auto", body: unknown) {
  const fetcher = vi.fn(async () => Response.json(body));
  const client = new ElyraPedroCoreClient(config(mode), fetcher);
  return {
    fetcher,
    result: client.interpretDeterministicReport(
      createElyraTextualInput(pedroCoreReportFixture()),
      textualCorrelation,
      idempotencyKey,
    ),
  };
}

function interpretMultimodal(mode: "mock" | "auto", body: unknown) {
  const client = new ElyraPedroCoreClient(config(mode), async () =>
    Response.json(body),
  );
  return client.interpretSessionSignals(
    multimodalInputFixture(),
    multimodalCorrelation,
    idempotencyKey,
  );
}

describe("A. consumer comum envia auto sem modelo", () => {
  it("textual e multimodal pedem provider=auto, model=null, sem fallback", () => {
    const textual = buildElyraOrchestrateRequest(
      createElyraTextualInput(pedroCoreReportFixture()),
      textualCorrelation,
      idempotencyKey,
      "auto",
    );
    const multimodal = buildElyraMultimodalRequest(
      multimodalInputFixture(),
      multimodalCorrelation,
      idempotencyKey,
      "auto",
    );
    for (const request of [textual, multimodal]) {
      expect(request.provider).toBe("auto");
      expect(request.model).toBeNull();
      expect(request.allow_real_provider).toBe(true);
      expect(request.allow_mock_fallback).toBe(false);
    }
  });

  it("o request nunca nomeia provider externo", () => {
    const serialized = JSON.stringify(
      buildElyraOrchestrateRequest(
        createElyraTextualInput(pedroCoreReportFixture()),
        textualCorrelation,
        idempotencyKey,
        "auto",
      ),
    ).toLowerCase();
    for (const [provider] of VELTRIX_PROVIDERS) {
      expect(serialized).not.toContain(`"${provider}"`);
    }
  });
});

describe("J. auto aceita qualquer provider escolhido pelo Veltrix", () => {
  it.each(VELTRIX_PROVIDERS)(
    "textual aceita provider_used=%s / model=%s",
    async (provider, model) => {
      const { result, fetcher } = interpretTextual(
        "auto",
        textualBody({ provider_used: provider, model }),
      );
      await expect(result).resolves.toMatchObject({
        provider_used: provider,
        model,
        fallback_used: false,
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(VELTRIX_PROVIDERS)(
    "multimodal aceita provider_used=%s / model=%s",
    async (provider, model) => {
      await expect(
        interpretMultimodal(
          "auto",
          multimodalBody({ provider_used: provider, model }),
        ),
      ).resolves.toMatchObject({ provider_used: provider, model });
    },
  );

  it.each(VELTRIX_PROVIDERS)(
    "a leitura persistida aceita providerUsed=%s",
    (provider, model) => {
      expect(veltrixProviderIdSchema.safeParse(provider).success).toBe(true);
      const view = analysisInterpretationViewSchema.safeParse({
        state: "available",
        output: multimodalOutputFixture(multimodalCorrelation),
        providerUsed: provider,
        model,
        createdAt: "2026-10-01T00:00:00.000Z",
      });
      expect(view.success).toBe(true);
    },
  );

  it("a leitura persistida recusa pseudo-provider", () => {
    const view = analysisInterpretationViewSchema.safeParse({
      state: "available",
      output: multimodalOutputFixture(multimodalCorrelation),
      providerUsed: "unknown",
      model: "x",
      createdAt: "2026-10-01T00:00:00.000Z",
    });
    expect(view.success).toBe(false);
  });
});

describe("J. agnostico nao significa aceitar qualquer string", () => {
  it.each([
    ["mock respondeu quando o real foi pedido", { provider_used: "mock", model: "mock-v1" }],
    ["real declarando o modelo simulado", { provider_used: "claude", model: "mock-v1" }],
    ["mock com modelo real", { provider_used: "mock", model: "gemini-3.5-flash" }],
    ["fallback declarado", { provider_used: "claude", fallback_used: true }],
  ])("recusa %s", async (_label, overrides) => {
    const { result } = interpretTextual("auto", textualBody(overrides));
    await expect(result).rejects.toBeInstanceOf(PedroCoreContractError);
  });

  it.each(VELTRIX_NON_INFERENCE_PROVIDER_IDS)(
    "recusa o pseudo-provider %s como inferencia",
    async (provider) => {
      const { result } = interpretTextual(
        "auto",
        textualBody({ provider_used: provider, model: "qualquer-modelo" }),
      );
      await expect(result).rejects.toBeInstanceOf(PedroCoreContractError);
    },
  );

  it.each([
    ["", "gemini-3.5-flash"],
    ["Gemini", "gemini-3.5-flash"],
    ["gemini; drop table", "gemini-3.5-flash"],
    ["g".repeat(33), "gemini-3.5-flash"],
    ["gemini", ""],
    ["gemini", " espaco"],
    ["gemini", "m".repeat(81)],
  ])("recusa formato invalido provider=%j model=%j", async (provider, model) => {
    const { result } = interpretTextual(
      "auto",
      textualBody({ provider_used: provider, model }),
    );
    await expect(result).rejects.toBeInstanceOf(PedroCoreContractError);
    expect(
      elyraOrchestrateSuccessSchema.safeParse(
        textualBody({ provider_used: provider, model }),
      ).success,
    ).toBe(false);
  });

  it("recusa provider_requested diferente do pedido", async () => {
    const { result } = interpretTextual(
      "auto",
      textualBody({ provider_requested: "mock", provider_used: "claude" }),
    );
    await expect(result).rejects.toBeInstanceOf(PedroCoreContractError);
  });
});

describe("L. o fluxo mock atual nao muda", () => {
  it("mock aceita somente mock/mock-v1", async () => {
    const { result } = interpretTextual(
      "mock",
      textualBody({
        provider_requested: "mock",
        provider_used: "mock",
        model: "mock-v1",
      }),
    );
    await expect(result).resolves.toMatchObject({
      provider_used: "mock",
      model: "mock-v1",
    });
  });

  it.each(VELTRIX_PROVIDERS)(
    "mock recusa resposta real de %s",
    async (provider, model) => {
      const { result } = interpretTextual(
        "mock",
        textualBody({ provider_requested: "mock", provider_used: provider, model }),
      );
      await expect(result).rejects.toBeInstanceOf(PedroCoreContractError);
    },
  );
});

describe("K. a Elyra nao recebe nem contem chave de provider", () => {
  it("a configuracao ignora chaves de provider mesmo se existirem no ambiente", () => {
    const leaked = Object.fromEntries(
      PROVIDER_KEY_NAMES.map((name) => [name, `synthetic-${name}-must-not-leak`]),
    );
    const resolved = pedroCoreConfigFromEnvironment({
      PEDROCORE_BASE_URL: "http://127.0.0.1:8000",
      PEDROCORE_ELYRA_API_KEY: "synthetic-elyra-key",
      PEDROCORE_PROVIDER_MODE: "auto",
      PEDROCORE_ALLOW_REAL_PROVIDER: "true",
      ...leaked,
    });
    const serialized = JSON.stringify(resolved);
    for (const value of Object.values(leaked)) {
      expect(serialized).not.toContain(value);
    }
    // A configuracao so conhece o Veltrix: nenhum campo nomeia provider ou
    // carrega chave dele, seja qual for o conjunto de campos da versao atual.
    for (const key of Object.keys(resolved)) {
      expect(key).not.toMatch(/gemini|anthropic|claude|openai|xai|grok|deepseek/i);
    }
  });

  it("nenhum header ou corpo enviado ao Veltrix carrega chave de provider", async () => {
    const leakedValues = PROVIDER_KEY_NAMES.map((name) => `synthetic-${name}`);
    const previous = PROVIDER_KEY_NAMES.map((name) => process.env[name]);
    PROVIDER_KEY_NAMES.forEach((name, index) => {
      process.env[name] = leakedValues[index];
    });
    try {
      const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
        const headers = JSON.stringify([...new Headers(init.headers).entries()]);
        for (const value of leakedValues) {
          expect(headers).not.toContain(value);
          expect(String(init.body)).not.toContain(value);
        }
        return Response.json(textualBody({ provider_used: "claude", model: "claude-sonnet-4-5" }));
      });
      const client = new ElyraPedroCoreClient(config("auto"), fetcher);
      await client.interpretDeterministicReport(
        createElyraTextualInput(pedroCoreReportFixture()),
        textualCorrelation,
        idempotencyKey,
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      PROVIDER_KEY_NAMES.forEach((name, index) => {
        if (previous[index] === undefined) delete process.env[name];
        else process.env[name] = previous[index];
      });
    }
  });

  it("a aplicacao nao cita chave de provider; script de QA so pode zera-la", () => {
    const root = process.cwd();
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx|mjs|js|json)$/.test(entry)) files.push(path);
      }
    };
    walk(join(root, "src"));
    walk(join(root, "scripts"));
    files.push(
      join(root, ".env.example"),
      join(root, "next.config.ts"),
      join(root, "package.json"),
    );

    const offenders = files.filter((path) => {
      if (path.endsWith("client-provider-agnostic.test.ts")) return false;
      const content = readFileSync(path, "utf8");
      const isQaScript = path.startsWith(join(root, "scripts"));
      return PROVIDER_KEY_NAMES.some((name) => {
        if (!content.includes(name)) return false;
        if (!isQaScript) return true;
        // Script de QA que sobe o Veltrix local pode citar a chave apenas para
        // ZERA-LA no ambiente do processo filho. Qualquer outra mencao (ler,
        // repassar, atribuir valor) e violacao.
        const mentions = content.split(name).length - 1;
        const blanked = content.split(`${name}: ""`).length - 1;
        return mentions !== blanked;
      });
    });
    expect(offenders).toEqual([]);
  });
});
