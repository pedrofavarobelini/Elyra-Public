import {
  ELYRA_NON_CLINICAL_DISCLAIMER,
  ELYRA_TEXTUAL_CONTRACT_VERSION,
  ELYRA_TEXTUAL_OPERATION,
  ELYRA_TEXTUAL_OUTPUT_VERSION,
  type AnalyticsReportContract,
  type ElyraTextualOutput,
} from "@/lib/contracts/pedrocore";

function isoDate(day: number): string {
  return new Date(Date.UTC(2026, 7, day)).toISOString().slice(0, 10);
}

export function pedroCoreReportFixture(): AnalyticsReportContract {
  return {
    schemaVersion: "report_snapshot/v1",
    analyticsVersion: "elyra-analytics/v1",
    cycleHeuristicVersion: "elyra-cycle/v1",
    timeZone: "America/Sao_Paulo",
    window: { from: "2026-08-01", to: "2026-08-28" },
    previousWindow: { from: "2026-07-04", to: "2026-07-31" },
    series: Array.from({ length: 28 }, (_, index) => ({
      date: isoDate(index + 1),
      mood: 7,
      anxiety: 3,
      energy: 6,
      sleepHours: 7.5,
      moodHeatmapBucket: 3,
    })),
    metrics: {
      mood: {
        current: 7,
        previous: 6.5,
        delta: 0.5,
        trend: "up",
        currentSamples: 28,
        previousSamples: 28,
      },
      anxiety: {
        current: 3,
        previous: 3.5,
        delta: -0.5,
        trend: "down",
        currentSamples: 28,
        previousSamples: 28,
      },
      energy: {
        current: 6,
        previous: 6,
        delta: 0,
        trend: "stable",
        currentSamples: 28,
        previousSamples: 28,
      },
      sleepDurationMinutes: {
        current: 450,
        previous: 420,
        delta: 30,
        trend: "up",
        currentSamples: 28,
        previousSamples: 28,
      },
    },
    cycle: {
      enabled: false,
      registeredMenstruationDays: null,
      registeredBands: [],
    },
    associations: {
      prePeriodEnergy: {
        status: "insufficient_data",
        metric: "energy",
        beforePeriodMean: null,
        otherDaysMean: 6,
        delta: null,
        beforePeriodSamples: 0,
        otherDaysSamples: 28,
      },
    },
    dataQuality: {
      daysInWindow: 28,
      daysWithMood: 28,
      daysWithAnxiety: 28,
      daysWithEnergy: 28,
      daysWithSleep: 28,
    },
  };
}

export function pedroCoreOutputFixture(
  correlationId: string,
): ElyraTextualOutput {
  return {
    contractVersion: ELYRA_TEXTUAL_CONTRACT_VERSION,
    outputSchemaVersion: ELYRA_TEXTUAL_OUTPUT_VERSION,
    operation: ELYRA_TEXTUAL_OPERATION,
    correlationId,
    sourceReportSchemaVersion: "report_snapshot/v1",
    sourceAnalyticsVersion: "elyra-analytics/v1",
    language: "pt-BR",
    summary: "Interpretacao sintetica e nao clinica do relatorio deterministico.",
    observations: [
      {
        category: "data_quality",
        evidencePath: "dataQuality",
        text: "A janela contem dados sinteticos em todos os 28 dias.",
      },
    ],
    limitations: [
      "Ausencia de dado nao equivale a zero.",
      "Associacoes temporais nao demonstram causalidade.",
    ],
    disclaimer: ELYRA_NON_CLINICAL_DISCLAIMER,
    safety: {
      diagnosticClaim: false,
      prescription: false,
      causalClaim: false,
      facialEmotionAsFact: false,
      fictitiousEmotionPercentage: false,
    },
  };
}
