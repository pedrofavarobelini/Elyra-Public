import { describe, expect, it } from "vitest";

import {
  multimodalInputFixture,
  multimodalOutputFixture,
  multimodalSignalsFixture,
} from "@/lib/contracts/multimodal-fixtures";
import type { ElyraMultimodalOutput } from "@/lib/contracts/multimodal-signals";
import { evaluateInterpretationQuality } from "@/server/pedrocore/quality-gate";

const CORRELATION = "era4-quality-gate-01";

/** Sinais de uma sessao so-microfone. Sem eles, o contrato recusa a projecao. */
const AUDIO_ONLY_SIGNALS = multimodalSignalsFixture().filter(
  (signal) => signal.name !== "movement_frequency",
);

function output(overrides: Partial<ElyraMultimodalOutput> = {}) {
  return { ...multimodalOutputFixture(CORRELATION), ...overrides };
}

/**
 * A fixture base tem cobertura de camera **parcial** (8 dos 30 minutos), entao o
 * caminho feliz ja exercita a regra de ressalva - e nao um cenario idealizado
 * que nunca acontece em sessao real.
 */
describe("caminho aprovado", () => {
  it("aceita saida com evidencia, confianca e ressalva de cobertura", () => {
    const result = evaluateInterpretationQuality(
      multimodalInputFixture(),
      output(),
    );
    expect(result).toEqual({ ok: true, failures: [] });
  });
});

describe("evidencia", () => {
  it("recusa observacao apoiada em sinal que a sessao nao mediu", () => {
    const result = evaluateInterpretationQuality(
      // Sessao sem camera: o proprio contrato ja recusaria o sinal de movimento,
      // entao a fixture troca os sinais junto - o gate precisa ser exercitado
      // com uma projecao que o contrato aceita.
      multimodalInputFixture({
        capturedResources: ["microphone"],
        signals: AUDIO_ONLY_SIGNALS,
      }),
      output({
        observations: [
          {
            category: "observable_signal",
            evidencePath: "signals.movement_frequency",
            text: "Houve variação de movimento em parte da sessão.",
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("evidence_unsupported");
  });

  it("recusa observacao sobre transcricao quando nao houve transcricao", () => {
    const result = evaluateInterpretationQuality(
      multimodalInputFixture({ transcript: null, transcriptAnalysisConsent: false }),
      output({
        observations: [
          {
            category: "transcript",
            evidencePath: "transcript",
            text: "O relato menciona a semana, em parte da sessão.",
          },
        ],
      }),
    );
    expect(result.failures).toContain("evidence_unsupported");
  });

  it("recusa observacao sobre serie temporal quando nao ha serie", () => {
    const result = evaluateInterpretationQuality(
      multimodalInputFixture({ windows: [] }),
      output({
        observations: [
          {
            category: "observable_signal",
            evidencePath: "timeline",
            text: "As pausas mudaram ao longo de parte da sessão.",
          },
        ],
      }),
    );
    expect(result.failures).toContain("evidence_unsupported");
  });

  it("recusa observacao sobre autorrelato quando a pessoa nao relatou", () => {
    const result = evaluateInterpretationQuality(
      multimodalInputFixture({ selfReport: null }),
      output({
        observations: [
          {
            category: "observable_signal",
            evidencePath: "selfReport",
            text: "O relato acompanha os sinais em parte da sessão.",
          },
        ],
      }),
    );
    expect(result.failures).toContain("evidence_unsupported");
  });
});

describe("confianca altera a assertividade", () => {
  /**
   * O ponto da Definition of Done: baixa confianca **muda o que se afirma**, e
   * nao vira asterisco embaixo de uma frase categorica.
   */
  it("recusa linguagem categorica com confianca baixa", () => {
    const result = evaluateInterpretationQuality(
      multimodalInputFixture(),
      output({
        confidence: "low",
        summary:
          "A sessão demonstra claramente uma mudança em parte da sessão.",
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.failures).toContain("confidence_overclaims");
  });

  it("aceita a mesma confianca baixa com linguagem que recua", () => {
    const result = evaluateInterpretationQuality(
      multimodalInputFixture(),
      output({
        confidence: "low",
        summary:
          "Os dados disponíveis não sustentam uma leitura forte desta parte da sessão.",
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("a mesma frase categorica passa com confianca alta", () => {
    const result = evaluateInterpretationQuality(
      multimodalInputFixture(),
      output({
        confidence: "high",
        summary:
          "A sessão demonstra claramente uma mudança em parte da sessão.",
      }),
    );
    expect(result.failures).not.toContain("confidence_overclaims");
  });
});

describe("cobertura parcial precisa ser declarada", () => {
  /**
   * Uma frase sobre movimento derivada de 8 dos 30 minutos de camera e
   * verdadeira e enganosa ao mesmo tempo. A unica correcao possivel e a propria
   * frase carregar a ressalva - o numero sozinho nao consegue.
   */
  it("recusa saida que nao menciona o recorte quando ha cobertura parcial", () => {
    const result = evaluateInterpretationQuality(
      multimodalInputFixture(),
      output({
        summary: "Leitura não clínica dos sinais registrados nesta sessão.",
        observations: [
          {
            category: "capture_quality",
            evidencePath: "captureQuality",
            text: "A sessão do tipo guided durou 300000 ms.",
          },
        ],
      }),
    );
    expect(result.failures).toContain("coverage_unqualified");
  });
});

describe("linguagem", () => {
  it("recusa vocabulario clinico", () => {
    const result = evaluateInterpretationQuality(
      multimodalInputFixture(),
      output({
        summary: "O padrão observado em parte da sessão sugere um transtorno.",
      }),
    );
    expect(result.failures).toContain("clinical_language");
  });

  it("recusa afirmacao causal", () => {
    const result = evaluateInterpretationQuality(
      multimodalInputFixture(),
      output({
        summary:
          "O ritmo de fala causou a mudança observada em parte da sessão.",
      }),
    );
    expect(result.failures).toContain("causal_language");
  });

  it("acumula todas as falhas em vez de parar na primeira", () => {
    const result = evaluateInterpretationQuality(
      multimodalInputFixture({
        capturedResources: ["microphone"],
        signals: AUDIO_ONLY_SIGNALS,
      }),
      output({
        confidence: "low",
        summary: "Isso comprova um transtorno e causou a mudança.",
        observations: [
          {
            category: "observable_signal",
            evidencePath: "signals.movement_frequency",
            text: "Movimento acima da média.",
          },
        ],
      }),
    );
    // Um gate que parasse na primeira falha esconderia as outras de quem for
    // investigar por que a interpretacao nao apareceu.
    expect(result.failures.length).toBeGreaterThanOrEqual(3);
  });
});
