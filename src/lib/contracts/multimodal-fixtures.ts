import type { CaptureCoverage } from "@/lib/contracts/capture-coverage";
import {
  ELYRA_MULTIMODAL_CONTRACT_VERSION,
  ELYRA_MULTIMODAL_DISCLAIMER,
  ELYRA_MULTIMODAL_INPUT_VERSION,
  ELYRA_MULTIMODAL_OPERATION,
  ELYRA_MULTIMODAL_OUTPUT_VERSION,
  FEATURE_EXTRACTOR_VERSION,
  SIGNALS_SCHEMA_VERSION,
  elyraMultimodalInputSchema,
  elyraMultimodalOutputSchema,
  type ElyraMultimodalInput,
  type ElyraMultimodalOutput,
  type ObservableSignalContract,
} from "@/lib/contracts/multimodal-signals";

/**
 * Fixtures sinteticas do dominio multimodal.
 *
 * Nenhum aparelho, microfone, camera ou midia real participa. Sao os mesmos
 * dados usados pela suite do PedroCore, para que as duas pontas do contrato
 * sejam exercitadas contra a mesma forma.
 */

export function multimodalSignalsFixture(): ObservableSignalContract[] {
  return [
    {
      name: "speech_rate",
      value: 132,
      unit: "words_per_minute",
      personalBaselineMean: 120,
      personalBaselineSamples: 12,
      deltaVsPersonalBaseline: 12,
      status: "available",
      coverage: {
        modality: "microphone",
        outcome: "full",
        reason: null,
        coverageMs: 300_000,
        sessionDurationMs: 300_000,
      },
    },
    {
      name: "pause_count",
      value: 18,
      unit: "count",
      personalBaselineMean: 15,
      personalBaselineSamples: 12,
      deltaVsPersonalBaseline: 3,
      status: "available",
      coverage: {
        modality: "microphone",
        outcome: "full",
        reason: null,
        coverageMs: 300_000,
        sessionDurationMs: 300_000,
      },
    },
    {
      name: "vocal_variation",
      value: 0.42,
      unit: "index",
      personalBaselineMean: null,
      personalBaselineSamples: 0,
      deltaVsPersonalBaseline: null,
      status: "insufficient_baseline",
      coverage: {
        modality: "microphone",
        outcome: "full",
        reason: null,
        coverageMs: 300_000,
        sessionDurationMs: 300_000,
      },
    },
    {
      name: "movement_frequency",
      value: 0.31,
      unit: "index",
      personalBaselineMean: 0.28,
      personalBaselineSamples: 9,
      deltaVsPersonalBaseline: 0.03,
      status: "available",
      // Deliberadamente **parcial**: a camera cobriu 8 dos 30 minutos. E o caso

      // cobertura completa nunca o exercitaria.
      coverage: {
        modality: "camera",
        outcome: "partial",
        reason: "interrupted",
        coverageMs: 80_000,
        sessionDurationMs: 300_000,
      },
    },
  ];
}

/**
 * Cobertura coerente com os recursos capturados de uma fixture.
 *
 * Toda modalidade aparece, inclusive a que nao foi pedida: ausencia de entrada
 * nao distingue "nao foi autorizada" de "foi autorizada e falhou".
 */
function coverageFixture(
  captured: readonly ("screen" | "camera" | "microphone")[],
  durationMs: number,
): CaptureCoverage[] {
  return (["screen", "camera", "microphone"] as const).map((modality) => {
    if (!captured.includes(modality)) {
      return {
        modality,
        outcome: "absent" as const,
        reason: "not_requested" as const,
        coverageMs: 0,
        sessionDurationMs: durationMs,
      };
    }
    /*
      A camera e **parcial** aqui, e isso nao e detalhe da fixture: ela precisa
      concordar com `multimodalSignalsFixture`, onde `movement_frequency` ja
      declara cobertura parcial. Duas fixtures que discordassem entre si
      produziriam uma projecao que o contrato recusa - e o teste passaria a medir
      a inconsistencia da fixture, e nao o comportamento do produto.
    */
    if (modality === "camera") {
      return {
        modality,
        outcome: "partial" as const,
        reason: "interrupted" as const,
        coverageMs: Math.round(durationMs * 0.2667),
        sessionDurationMs: durationMs,
      };
    }
    return {
      modality,
      outcome: "full" as const,
      reason: null,
      coverageMs: durationMs,
      sessionDurationMs: durationMs,
    };
  });
}

export function multimodalInputFixture(
  overrides: Partial<{
    transcriptAnalysisConsent: boolean;
    /**
     * Padrao `false`, como o consentimento real.
     *
     * A fixture nasce **sem** analise visual de proposito: se ela nascesse com,
     * todo teste que nao pensa no assunto passaria a exercitar o caminho
     * consentido, e o caminho sem consentimento - que e o padrao de producao -
     * ficaria coberto so por quem lembrasse de desligar.
     */
    visualAnalysisConsent: boolean;
    signals: ObservableSignalContract[];
    capturedResources: ("screen" | "camera" | "microphone")[];
    transcript: ElyraMultimodalInput["session"]["transcript"];
    selfReport: ElyraMultimodalInput["session"]["selfReport"];
    windows: ElyraMultimodalInput["session"]["windows"];
  }> = {},
): ElyraMultimodalInput {
  const transcriptAnalysisConsent =
    overrides.transcriptAnalysisConsent ?? true;
  const visualAnalysisConsent = overrides.visualAnalysisConsent ?? false;

  return elyraMultimodalInputSchema.parse({
    contractVersion: ELYRA_MULTIMODAL_CONTRACT_VERSION,
    inputSchemaVersion: ELYRA_MULTIMODAL_INPUT_VERSION,
    operation: ELYRA_MULTIMODAL_OPERATION,
    aiInferenceConsent: true,
    multimodalAnalysisConsent: true,
    transcriptAnalysisConsent,
    visualAnalysisConsent,
    session: {
      signalsSchemaVersion: SIGNALS_SCHEMA_VERSION,
      featureExtractorVersion: FEATURE_EXTRACTOR_VERSION,
      sessionKind: "guided",
      capturedResources: overrides.capturedResources ?? [
        "microphone",
        "camera",
      ],
      durationMs: 300_000,
      /*
        Derivada dos recursos capturados, e nao escrita a mao: uma fixture com
        cobertura que contradiz a lista de captura passaria a exercitar um estado
        que o contrato recusa - e um teste que so o proprio teste aceita nao prova
        nada sobre o produto.
      */
      modalityCoverage: coverageFixture(
        overrides.capturedResources ?? ["microphone", "camera"],
        300_000,
      ),
      // `null` e o caso comum: a coleta e opcional (`ADR-0008`), e a fixture
      // base nao deve sugerir que autorrelato seja esperado.
      selfReport: overrides.selfReport ?? null,
      windows: overrides.windows ?? [],
      transcript:
        overrides.transcript !== undefined
          ? overrides.transcript
          : transcriptAnalysisConsent
            ? {
                language: "pt-BR",
                text: "Hoje falei sobre a semana e sobre o que me cansou.",
                wordCount: 11,
                voicedDurationMs: 240_000,
                truncated: false,
              }
            : null,
      signals: overrides.signals ?? multimodalSignalsFixture(),
    },
  });
}

export function multimodalOutputFixture(
  correlationId: string,
): ElyraMultimodalOutput {
  return elyraMultimodalOutputSchema.parse({
    contractVersion: ELYRA_MULTIMODAL_CONTRACT_VERSION,
    outputSchemaVersion: ELYRA_MULTIMODAL_OUTPUT_VERSION,
    operation: ELYRA_MULTIMODAL_OPERATION,
    correlationId,
    sourceSignalsSchemaVersion: SIGNALS_SCHEMA_VERSION,
    sourceFeatureExtractorVersion: FEATURE_EXTRACTOR_VERSION,
    language: "pt-BR",
    summary:
      "Leitura não clínica dos sinais observáveis registrados em parte da sessão.",
    /*
      `moderate` de proposito, e nao `high`: a fixture da camera e **parcial**
      (8 dos 30 minutos), e uma saida que se dissesse muito confiante sobre
      cobertura parcial e exatamente o que o quality gate recusa. A fixture
      precisa ser um exemplo do que passa, e nao do que gostariamos de ver.
    */
    confidence: "moderate",
    observations: [
      {
        category: "capture_quality",
        evidencePath: "captureQuality",
        text: "A sessão do tipo guided durou 300000 ms.",
      },
      {
        category: "observable_signal",
        evidencePath: "signals.speech_rate",
        text: "Ritmo de fala: 132 palavras por minuto, acima da média pessoal de 120.",
      },
    ],
    limitations: [
      "Sinais observáveis descrevem a forma do registro e não indicam emoção.",
      "Ausência de dado não equivale a zero e limita qualquer comparação.",
    ],
    disclaimer: ELYRA_MULTIMODAL_DISCLAIMER,
    safety: {
      diagnosticClaim: false,
      prescription: false,
      causalClaim: false,
      facialEmotionAsFact: false,
      fictitiousEmotionPercentage: false,
      emotionInferredFromSignal: false,
      rawMediaAccessed: false,
      populationNormComparison: false,
      selfReportContradictedBySignal: false,
    },
  });
}
