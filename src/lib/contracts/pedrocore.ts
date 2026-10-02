import { z } from "zod";

export const ELYRA_PEDROCORE_BASELINE =
  "public-contract-v1" as const;
export const ELYRA_TEXTUAL_CONTRACT_VERSION = "elyra-textual/v1" as const;
export const ELYRA_TEXTUAL_INPUT_VERSION = "elyra-textual-input/v1" as const;
export const ELYRA_TEXTUAL_OUTPUT_VERSION = "elyra-textual-output/v1" as const;
export const ELYRA_TEXTUAL_OPERATION =
  "interpret_deterministic_report" as const;
export const ELYRA_TEXTUAL_TASK =
  "wellbeing_report_interpretation" as const;
export const ELYRA_TEXTUAL_MESSAGE =
  "interpretar_relatorio_deterministico" as const;
export const ELYRA_ORIGIN_SYSTEM = "elyra" as const;
export const PEDROCORE_MOCK_PROVIDER = "mock" as const;
export const PEDROCORE_MOCK_MODEL = "mock-v1" as const;
export const ELYRA_AI_CONSENT_PURPOSE = "ai_inference" as const;
export const ELYRA_AI_CONSENT_VERSION = "v1" as const;

export const ELYRA_NON_CLINICAL_DISCLAIMER =
  "Conteúdo informativo e não clínico. Não constitui diagnóstico, prescrição ou afirmação causal e deve ser interpretado pela pessoa usuária." as const;

const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  });

const analyticsWindowSchema = z
  .object({ from: civilDateSchema, to: civilDateSchema })
  .strict()
  .refine((window) => window.from <= window.to, "Janela analitica invertida.");

const comparisonSchema = z
  .object({
    current: z.number().nullable(),
    previous: z.number().nullable(),
    delta: z.number().nullable(),
    trend: z.enum(["up", "down", "stable", "insufficient_data"]),
    currentSamples: z.number().int().min(0).max(90),
    previousSamples: z.number().int().min(0).max(90),
  })
  .strict();

const dailyAnalyticsPointSchema = z
  .object({
    date: civilDateSchema,
    mood: z.number().min(0).max(10).nullable(),
    anxiety: z.number().min(0).max(10).nullable(),
    energy: z.number().min(0).max(10).nullable(),
    sleepHours: z.number().min(0).max(24).nullable(),
    moodHeatmapBucket: z.number().int().min(0).max(4).nullable(),
  })
  .strict();

const registeredBandSchema = z
  .object({ from: civilDateSchema, to: civilDateSchema })
  .strict()
  .refine((band) => band.from <= band.to, "Faixa menstrual invertida.");

const cycleSummarySchema = z
  .object({
    enabled: z.boolean(),
    registeredMenstruationDays: z.number().int().min(0).max(90).nullable(),
    registeredBands: z.array(registeredBandSchema).max(20),
  })
  .strict()
  .superRefine((cycle, context) => {
    if (
      !cycle.enabled &&
      (cycle.registeredMenstruationDays !== null || cycle.registeredBands.length > 0)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ciclo desligado nao pode atravessar a fronteira.",
      });
    }
  });

const temporalAssociationSchema = z
  .object({
    status: z.enum(["available", "insufficient_data"]),
    metric: z.literal("energy"),
    beforePeriodMean: z.number().min(0).max(10).nullable(),
    otherDaysMean: z.number().min(0).max(10).nullable(),
    delta: z.number().min(-10).max(10).nullable(),
    beforePeriodSamples: z.number().int().min(0).max(90),
    otherDaysSamples: z.number().int().min(0).max(90),
  })
  .strict();

const daysInWindowSchema = z.union([
  z.literal(28),
  z.literal(56),
  z.literal(90),
]);

const dataQualitySchema = z
  .object({
    daysInWindow: daysInWindowSchema,
    daysWithMood: z.number().int().min(0).max(90),
    daysWithAnxiety: z.number().int().min(0).max(90),
    daysWithEnergy: z.number().int().min(0).max(90),
    daysWithSleep: z.number().int().min(0).max(90),
  })
  .strict()
  .superRefine((quality, context) => {
    for (const count of [
      quality.daysWithMood,
      quality.daysWithAnxiety,
      quality.daysWithEnergy,
      quality.daysWithSleep,
    ]) {
      if (count > quality.daysInWindow) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Contagem de qualidade excede a janela.",
        });
      }
    }
  });

function dateSpan(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(`${to}T00:00:00.000Z`) -
        Date.parse(`${from}T00:00:00.000Z`)) /
        86_400_000,
    ) + 1
  );
}

function validateComparisonDomain(
  comparison: z.infer<typeof comparisonSchema>,
  maximum: number,
  deltaMaximum: number,
): boolean {
  return (
    [comparison.current, comparison.previous].every(
      (value) => value === null || (value >= 0 && value <= maximum),
    ) &&
    (comparison.delta === null ||
      (comparison.delta >= -deltaMaximum && comparison.delta <= deltaMaximum))
  );
}

export const analyticsReportSchema = z
  .object({
    schemaVersion: z.literal("report_snapshot/v1"),
    analyticsVersion: z.literal("elyra-analytics/v1"),
    cycleHeuristicVersion: z.literal("elyra-cycle/v1"),
    timeZone: z
      .string()
      .min(1)
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, "Fuso IANA invalido."),
    window: analyticsWindowSchema,
    previousWindow: analyticsWindowSchema,
    series: z.array(dailyAnalyticsPointSchema).max(90),
    metrics: z
      .object({
        mood: comparisonSchema,
        anxiety: comparisonSchema,
        energy: comparisonSchema,
        sleepDurationMinutes: comparisonSchema,
      })
      .strict(),
    cycle: cycleSummarySchema,
    associations: z
      .object({ prePeriodEnergy: temporalAssociationSchema })
      .strict(),
    dataQuality: dataQualitySchema,
  })
  .strict()
  .superRefine((report, context) => {
    const days = report.dataQuality.daysInWindow;
    if (
      dateSpan(report.window.from, report.window.to) !== days ||
      dateSpan(report.previousWindow.from, report.previousWindow.to) !== days ||
      report.previousWindow.to >= report.window.from
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Janelas incompativeis com o contrato analitico.",
      });
    }
    const dates = report.series.map((point) => point.date);
    if (
      dates.length !== days ||
      dates.some((date, index) =>
        index === 0
          ? date < report.window.from || date > report.window.to
          : date <= (dates[index - 1] ?? ""),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Serie precisa cobrir a janela com datas unicas e ordenadas.",
      });
    }
    for (const comparison of [
      report.metrics.mood,
      report.metrics.anxiety,
      report.metrics.energy,
    ]) {
      if (!validateComparisonDomain(comparison, 10, 10)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Metrica emocional fora do dominio.",
        });
      }
    }
    if (!validateComparisonDomain(report.metrics.sleepDurationMinutes, 1440, 1440)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duracao de sono fora do dominio.",
      });
    }
  });

export const elyraTextualInputSchema = z
  .object({
    contractVersion: z.literal(ELYRA_TEXTUAL_CONTRACT_VERSION),
    inputSchemaVersion: z.literal(ELYRA_TEXTUAL_INPUT_VERSION),
    operation: z.literal(ELYRA_TEXTUAL_OPERATION),
    aiInferenceConsent: z.literal(true),
    report: analyticsReportSchema,
  })
  .strict();

export const elyraObservationSchema = z
  .object({
    category: z.enum(["metric", "data_quality", "temporal_association"]),
    evidencePath: z.enum([
      "metrics.mood",
      "metrics.anxiety",
      "metrics.energy",
      "metrics.sleepDurationMinutes",
      "dataQuality",
      "associations.prePeriodEnergy",
    ]),
    text: z.string().min(1).max(320),
  })
  .strict();

export const elyraTextualOutputSchema = z
  .object({
    contractVersion: z.literal(ELYRA_TEXTUAL_CONTRACT_VERSION),
    outputSchemaVersion: z.literal(ELYRA_TEXTUAL_OUTPUT_VERSION),
    operation: z.literal(ELYRA_TEXTUAL_OPERATION),
    correlationId: z.string().min(3).max(128),
    sourceReportSchemaVersion: z.literal("report_snapshot/v1"),
    sourceAnalyticsVersion: z.literal("elyra-analytics/v1"),
    language: z.literal("pt-BR"),
    summary: z.string().min(1).max(1000),
    observations: z.array(elyraObservationSchema).min(1).max(5),
    limitations: z.array(z.string().trim().min(1).max(320)).min(2).max(5),
    disclaimer: z.literal(ELYRA_NON_CLINICAL_DISCLAIMER),
    safety: z
      .object({
        diagnosticClaim: z.literal(false),
        prescription: z.literal(false),
        causalClaim: z.literal(false),
        facialEmotionAsFact: z.literal(false),
        fictitiousEmotionPercentage: z.literal(false),
      })
      .strict(),
  })
  .strict();

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/);

/**
 * Identificadores que o Veltrix usa para "nao houve inferencia real".
 *
 * A Elyra nao conhece a lista de providers externos - quem escolhe, homologa e
 * autoriza e o Veltrix (ADR-0034). Mas ela conhece o que NAO e inferencia real,
 * porque aceitar um destes como sucesso seria o fallback silencioso que a V1
 * proibe. Espelhado na constraint `ai_insights_provider_used_check`.
 */
export const VELTRIX_NON_INFERENCE_PROVIDER_IDS = [
  "none",
  "unknown",
  "auto",
  "local",
  "local_qa",
  "local_model",
] as const;

const NON_INFERENCE = new Set<string>(VELTRIX_NON_INFERENCE_PROVIDER_IDS);

/**
 * `provider_used` como metadata de auditoria: formato fechado, sem lista de
 * nomes. Mesmo predicado da migration 20261001110000.
 */
export const veltrixProviderIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{1,31}$/)
  .refine((value) => !NON_INFERENCE.has(value), {
    message: "Pseudo-provider do Veltrix nao e inferencia.",
  });

/** `model` como metadata de auditoria: formato fechado, ate 80 caracteres. */
export const veltrixModelIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/);

export type VeltrixProviderId = z.infer<typeof veltrixProviderIdSchema>;

export const elyraOrchestrateRequestSchema = z
  .object({
    message: z.literal(ELYRA_TEXTUAL_MESSAGE),
    mode: z.literal("tecnico"),
    provider: z.enum(["mock", "auto"]),
    model: z.null(),
    task_type: z.literal(ELYRA_TEXTUAL_TASK),
    origin_system: z.literal(ELYRA_ORIGIN_SYSTEM),
    allow_real_provider: z.boolean(),
    allow_mock_fallback: z.boolean(),
    correlation_id: identifierSchema,
    idempotency_key: identifierSchema,
    context: elyraTextualInputSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const mock =
      request.provider === "mock" && request.allow_real_provider === false;
    const real =
      request.provider === "auto" &&
      request.allow_real_provider === true &&
      request.allow_mock_fallback === false;
    if (!mock && !real) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider policy Elyra negada.",
      });
    }
  });

export const elyraOrchestrateSuccessSchema = z
  .object({
    status: z.literal("ok"),
    answer: z.string(),
    task_type: z.literal(ELYRA_TEXTUAL_TASK),
    origin_system: z.literal(ELYRA_ORIGIN_SYSTEM),
    provider_requested: z.enum(["mock", "auto"]),
    provider_used: veltrixProviderIdSchema,
    model: veltrixModelIdSchema,
    mode: z.literal("tecnico"),
    fallback_used: z.literal(false),
    correlation_id: identifierSchema,
    idempotency_replayed: z.boolean(),
    elyra: elyraTextualOutputSchema,
    project_id: z.literal("elyra"),
    task_allowed_for_project: z.literal(true),
    audit: z.object({}).passthrough(),
  })
  .passthrough();

export const elyraOrchestrateErrorSchema = z
  .object({
    status: z.literal("blocked"),
    error_code: z.string().min(1),
    blocked_reason: z.string().optional(),
    correlation_id: identifierSchema.optional(),
  })
  .passthrough();

export const insightRequestSchema = z
  .object({
    reportSnapshotId: z.string().uuid(),
    idempotencyKey: identifierSchema,
    aiInferenceConsent: z.boolean(),
  })
  .strict();

export type AnalyticsReportContract = z.infer<typeof analyticsReportSchema>;
export type ElyraTextualInput = z.infer<typeof elyraTextualInputSchema>;
export type ElyraTextualOutput = z.infer<typeof elyraTextualOutputSchema>;
export type ElyraOrchestrateRequest = z.infer<
  typeof elyraOrchestrateRequestSchema
>;
export type ElyraOrchestrateSuccess = z.infer<
  typeof elyraOrchestrateSuccessSchema
>;
export type InsightRequest = z.infer<typeof insightRequestSchema>;
export type ElyraProviderMode = "mock" | "auto";
