import { z } from "zod";



export const ELYRA_LEARNING_CONTRACT_VERSION = "elyra-learning/v1" as const;
export const ELYRA_LEARNING_INPUT_VERSION = "elyra-learning-input/v1" as const;
export const ELYRA_LEARNING_OUTPUT_VERSION = "elyra-learning-output/v1" as const;
export const ELYRA_LEARNING_TASK =
  "governed_learning_candidate_submission" as const;
export const ELYRA_LEARNING_MESSAGE =
  "submeter_candidato_de_learning_governado" as const;

export const ELYRA_LEARNING_POLICY_VERSION = "elyra-learning-policy/v1" as const;
export const ELYRA_LEARNING_EXPORT_VERSION = "elyra-learning-export/v1" as const;

export const SUBMIT_OPERATION = "submit_governed_candidate" as const;
export const REVOKE_OPERATION = "revoke_governed_candidate" as const;

/** Consentimento de TREINO — proposito proprio, separado de `ai_inference`. */
export const TRAINING_CONSENT_PURPOSE = "training_data" as const;
export const TRAINING_CONSENT_VERSION = "v1" as const;

/**
 * Minimo de dias com dado para um agregado ser defensavel.
 *
 * Nao e um numero clinico: e o ponto abaixo do qual uma media diz mais sobre a
 * ausencia de registro do que sobre a pessoa. Mudar exige nova versao de
 * politica.
 */
export const MINIMUM_DAYS_WITH_DATA = 14;

/** Fracao minima da janela que precisa ter registro para o export ser aceito. */
export const MINIMUM_WINDOW_COMPLETENESS = 0.5;

export const QUALITY_CHECKS = [
  "minimum_days_with_data",
  "window_completeness",
  "no_free_text",
  "no_direct_identifier",
  "value_domains",
] as const;
export type QualityCheckName = (typeof QUALITY_CHECKS)[number];

export const REJECTION_CODES = [
  "training_consent_missing",
  "training_consent_revoked",
  "insufficient_data",
  "quality_gate_failed",
  "sanitization_failed",
  "provenance_invalid",
  "source_not_allowed",
  "pedrocore_denied",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export const REVOCATION_REASONS = [
  "training_consent_revoked",
  "user_data_deleted",
  "eligibility_lost",
] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

export const EXPORT_STATUSES = [
  "eligible",
  "exported",
  "rejected",
  "revoked",
] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export const CANDIDATE_LIFECYCLES = [
  "proposed",
  "authorized",
  "review_required",
  "excluded",
  "revoked",
  "consumed",
] as const;
export type CandidateLifecycle = (typeof CANDIDATE_LIFECYCLES)[number];

const isoInstantSchema = z
  .string()
  .refine(
    (value) => !Number.isNaN(Date.parse(value)) && /[Zz]|[+-]\d{2}:\d{2}$/.test(value),
    "Instante precisa incluir fuso.",
  );

/**
 * Agregado numerico. Sem texto, sem data, sem identificador.
 *
 * `samples = 0` significa ausencia de registro, e ausencia nao e zero: nesse
 * caso nao existe media nem tendencia.
 */
export const learningAggregateSchema = z
  .object({
    mean: z.number().nullable(),
    delta: z.number().nullable(),
    trend: z.enum(["up", "down", "stable", "insufficient_data"]),
    samples: z.number().int().min(0).max(90),
  })
  .strict()
  .superRefine((aggregate, ctx) => {
    if (aggregate.samples === 0) {
      if (aggregate.mean !== null || aggregate.delta !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Agregado sem amostra nao pode transportar valor.",
        });
      }
      if (aggregate.trend !== "insufficient_data") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Agregado sem amostra exige insufficient_data.",
        });
      }
    } else if (aggregate.mean === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Agregado com amostra precisa de media.",
      });
    }
  });

export type LearningAggregate = z.infer<typeof learningAggregateSchema>;

/**
 * O candidato em si. **Nao existe campo de texto neste schema.**
 *
 * Diario, transcricao, nome, e-mail, nota profissional e saida do PedroCore nao
 * tem onde caber — por tipo, nao por politica. `.strict()` faz um campo a mais
 * derrubar a validacao inteira em vez de ser ignorado.
 */
export const sanitizedLearningPayloadSchema = z
  .object({
    daysInWindow: z.union([z.literal(28), z.literal(56), z.literal(90)]),
    mood: learningAggregateSchema,
    anxiety: learningAggregateSchema,
    energy: learningAggregateSchema,
    sleepDurationMinutes: learningAggregateSchema,
    daysWithMood: z.number().int().min(0).max(90),
    daysWithAnxiety: z.number().int().min(0).max(90),
    daysWithEnergy: z.number().int().min(0).max(90),
    daysWithSleep: z.number().int().min(0).max(90),
    cycleEnabled: z.boolean(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const counts = [
      payload.daysWithMood,
      payload.daysWithAnxiety,
      payload.daysWithEnergy,
      payload.daysWithSleep,
    ];
    if (counts.some((count) => count > payload.daysInWindow)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Contagem excede a janela declarada.",
      });
    }

    const pairs: [LearningAggregate, number][] = [
      [payload.mood, payload.daysWithMood],
      [payload.anxiety, payload.daysWithAnxiety],
      [payload.energy, payload.daysWithEnergy],
      [payload.sleepDurationMinutes, payload.daysWithSleep],
    ];
    for (const [aggregate, count] of pairs) {
      if (aggregate.samples > count) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Amostras do agregado excedem os dias com dado.",
        });
      }
    }

    for (const aggregate of [payload.mood, payload.anxiety, payload.energy]) {
      if (aggregate.mean !== null && (aggregate.mean < 0 || aggregate.mean > 10)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Metrica emocional fora do dominio 0..10.",
        });
      }
      if (
        aggregate.delta !== null &&
        (aggregate.delta < -10 || aggregate.delta > 10)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Delta emocional fora do dominio.",
        });
      }
    }

    const sleep = payload.sleepDurationMinutes;
    if (sleep.mean !== null && (sleep.mean < 0 || sleep.mean > 1440)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duracao de sono fora do dominio 0..1440.",
      });
    }
    if (sleep.delta !== null && (sleep.delta < -1440 || sleep.delta > 1440)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Delta de sono fora do dominio.",
      });
    }
  });

export type SanitizedLearningPayload = z.infer<
  typeof sanitizedLearningPayloadSchema
>;

export const eligibilityDeclarationSchema = z
  .object({
    eligible: z.literal(true),
    policyVersion: z.literal(ELYRA_LEARNING_POLICY_VERSION),
    evaluatedAt: isoInstantSchema,
  })
  .strict();

export const trainingConsentSchema = z
  .object({
    trainingConsentGranted: z.literal(true),
    consentVersion: z.literal(TRAINING_CONSENT_VERSION),
    grantedAt: isoInstantSchema,
  })
  .strict();

export const provenanceSchema = z
  .object({
    sourceKind: z.literal("report_snapshot"),
    sourceSchemaVersion: z.literal("report_snapshot/v1"),
    analyticsVersion: z.literal("elyra-analytics/v1"),
    exportSchemaVersion: z.literal(ELYRA_LEARNING_EXPORT_VERSION),
    producedAt: isoInstantSchema,
  })
  .strict();

export const qualityResultSchema = z
  .object({
    passed: z.literal(true),
    checks: z
      .array(
        z
          .object({ name: z.enum(QUALITY_CHECKS), passed: z.literal(true) })
          .strict(),
      )
      .length(QUALITY_CHECKS.length),
  })
  .strict()
  .superRefine((quality, ctx) => {
    const names = quality.checks.map((check) => check.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Gate de qualidade duplicado.",
      });
    }
  });

export const elyraLearningSubmissionSchema = z
  .object({
    contractVersion: z.literal(ELYRA_LEARNING_CONTRACT_VERSION),
    inputSchemaVersion: z.literal(ELYRA_LEARNING_INPUT_VERSION),
    operation: z.literal(SUBMIT_OPERATION),
    eligibility: eligibilityDeclarationSchema,
    consent: trainingConsentSchema,
    provenance: provenanceSchema,
    quality: qualityResultSchema,
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    payload: sanitizedLearningPayloadSchema,
  })
  .strict()
  .superRefine((submission, ctx) => {
    // O consentimento precisa existir ANTES de o dado ser exportado.
    if (
      Date.parse(submission.consent.grantedAt) >
      Date.parse(submission.provenance.producedAt)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Consentimento de treino posterior ao dado exportado.",
      });
    }
  });

export type ElyraLearningSubmission = z.infer<
  typeof elyraLearningSubmissionSchema
>;

export const elyraLearningRevocationSchema = z
  .object({
    contractVersion: z.literal(ELYRA_LEARNING_CONTRACT_VERSION),
    inputSchemaVersion: z.literal(ELYRA_LEARNING_INPUT_VERSION),
    operation: z.literal(REVOKE_OPERATION),
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    reasonCode: z.enum(REVOCATION_REASONS),
    revokedAt: isoInstantSchema,
  })
  .strict();

export type ElyraLearningRevocation = z.infer<
  typeof elyraLearningRevocationSchema
>;

/** Recibo da operacao. Nunca devolve o payload submetido. */
export const elyraLearningReceiptSchema = z
  .object({
    contractVersion: z.literal(ELYRA_LEARNING_CONTRACT_VERSION),
    outputSchemaVersion: z.literal(ELYRA_LEARNING_OUTPUT_VERSION),
    operation: z.enum([SUBMIT_OPERATION, REVOKE_OPERATION]),
    correlationId: z.string().min(3).max(128),
    candidateId: z.string().regex(/^training-candidate-[0-9a-f]{24}$/),
    lifecycle: z.enum(CANDIDATE_LIFECYCLES),
    duplicate: z.boolean(),
    policyVersion: z.literal(ELYRA_LEARNING_POLICY_VERSION),
    trainingStarted: z.literal(false),
    modelWeightsUpdated: z.literal(false),
  })
  .strict();

export type ElyraLearningReceipt = z.infer<typeof elyraLearningReceiptSchema>;

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/);

export const elyraLearningOrchestrateRequestSchema = z
  .object({
    message: z.literal(ELYRA_LEARNING_MESSAGE),
    mode: z.literal("tecnico"),
    provider: z.literal("mock"),
    model: z.null(),
    task_type: z.literal(ELYRA_LEARNING_TASK),
    origin_system: z.literal("elyra"),
    // Governanca nao consulta provider: nem real, nem fallback.
    allow_real_provider: z.literal(false),
    allow_mock_fallback: z.literal(false),
    correlation_id: identifierSchema,
    idempotency_key: identifierSchema,
    context: z.union([
      elyraLearningSubmissionSchema,
      elyraLearningRevocationSchema,
    ]),
  })
  .strict();

export type ElyraLearningOrchestrateRequest = z.infer<
  typeof elyraLearningOrchestrateRequestSchema
>;

export const elyraLearningOrchestrateSuccessSchema = z
  .object({
    status: z.literal("ok"),
    task_type: z.literal(ELYRA_LEARNING_TASK),
    origin_system: z.literal("elyra"),
    provider_used: z.literal("none"),
    model: z.literal("none"),
    fallback_used: z.literal(false),
    correlation_id: identifierSchema,
    idempotency_replayed: z.boolean(),
    elyra_learning: elyraLearningReceiptSchema,
    project_id: z.literal("elyra"),
    task_allowed_for_project: z.literal(true),
  })
  .passthrough();

export type ElyraLearningOrchestrateSuccess = z.infer<
  typeof elyraLearningOrchestrateSuccessSchema
>;
