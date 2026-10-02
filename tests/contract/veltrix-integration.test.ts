/**
 * @vitest-environment node
 *
 * O cliente PedroCore e server-only: ele roda no Node, e nao no navegador. Sob
 * jsdom o `fetch` carrega a politica de origem de uma pagina e recusa a chamada
 * ao servico local — a falha apareceria como "PedroCore indisponivel", que e
 * exatamente o diagnostico errado para um servico que esta de pe.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ElyraPedroCoreClient,
  type PedroCoreClientConfig,
} from "@/server/pedrocore/client";
import {
  elyraMultimodalInputSchema,
  ELYRA_MULTIMODAL_CONTRACT_VERSION,
} from "@/lib/contracts/multimodal-signals";



const enabled = process.env.VELTRIX_INTEGRATION === "1";
const baseUrl = process.env.PEDROCORE_BASE_URL ?? "http://127.0.0.1:8000";
const apiKey = process.env.PEDROCORE_ELYRA_API_KEY ?? "";

const FIXTURE_DIR = resolve(process.cwd(), "contract-fixtures", "elyra-multimodal-v2");

function fixture(name: string) {
  const raw = JSON.parse(readFileSync(resolve(FIXTURE_DIR, `${name}.json`), "utf8"));
  // Reparseia pelo schema real: o que vai para a rede e o objeto do contrato,
  // e nao um JSON solto que por acaso se parece com ele.
  return elyraMultimodalInputSchema.parse(raw);
}

function client(overrides: Partial<PedroCoreClientConfig> = {}) {
  return new ElyraPedroCoreClient({
    baseUrl,
    apiKey,
    providerMode: "mock",
    timeoutMs: 8_000,
    multimodalTimeoutMs: 30_000,
    ...overrides,
  });
}

describe.skipIf(!enabled)("integracao real Elyra -> Veltrix", () => {
  it("o servico esta de pe", async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.ok).toBe(true);
  });

  it.each([
    "full-multimodal",
    "microphone-only",
    "camera-without-visual-consent",
    "absent-signals",
  ])(
    "o Veltrix aceita e interpreta o payload real da Elyra: %s",
    async (name) => {
      const correlationId = `elyra-multimodal-integration-${name}`;
      const outcome = await client().interpretSessionSignals(
        fixture(name),
        correlationId,
        `elyra-multimodal-key-integration-${name}`,
      );

      expect(outcome.status).toBe("ok");
      expect(outcome.origin_system).toBe("elyra");
      expect(outcome.correlation_id).toBe(correlationId);
      // A saida volta na MESMA versao em que a pergunta entrou.
      expect(outcome.elyra_multimodal.contractVersion).toBe(
        ELYRA_MULTIMODAL_CONTRACT_VERSION,
      );
      expect(outcome.elyra_multimodal.sourceFeatureExtractorVersion).toBe(
        "elyra-signals/v3",
      );
      expect(outcome.fallback_used).toBe(false);

      // Nenhuma afirmacao proibida atravessou de volta.
      for (const flag of Object.values(outcome.elyra_multimodal.safety)) {
        expect(flag).toBe(false);
      }
    },
  );

  it("a resposta nao devolve midia nem identificador", async () => {
    const outcome = await client().interpretSessionSignals(
      fixture("full-multimodal"),
      "elyra-multimodal-integration-privacy",
      "elyra-multimodal-key-integration-privacy",
    );
    const serialized = JSON.stringify(outcome.elyra_multimodal).toLowerCase();
    for (const forbidden of ["http://", "https://", "data:", "userid", "user_id"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("credencial invalida e recusada pelo servico, e nao contornada", async () => {
    // Fail-closed real: a fronteira recusa antes de qualquer dispatch.
    await expect(
      client({ apiKey: "credencial-que-nao-existe" }).interpretSessionSignals(
        fixture("microphone-only"),
        "elyra-multimodal-integration-denied",
        "elyra-multimodal-key-integration-denied",
      ),
    ).rejects.toThrow();
  });
});
