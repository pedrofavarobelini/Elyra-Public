import { z } from "zod";



/** Score 0-10 anulavel. A ausencia e um valor de dominio, nao um default. */
export const scoreSchema = z
  .number()
  .int("O score deve ser um número inteiro.")
  .min(0, "O score mínimo é 0.")
  .max(10, "O score máximo é 10.")
  .nullable();

export type Score = z.infer<typeof scoreSchema>;

/** Sentimento predominante. Campo separado dos scores. */
export const PRIMARY_FEELINGS = [
  "feliz",
  "tranquilo",
  "neutro",
  "triste",
  "ansioso",
] as const;

export const primaryFeelingSchema = z.enum(PRIMARY_FEELINGS).nullable();
export type PrimaryFeeling = (typeof PRIMARY_FEELINGS)[number];

export const PRIMARY_FEELING_LABEL: Record<PrimaryFeeling, string> = {
  feliz: "Feliz",
  tranquilo: "Tranquilo",
  neutro: "Neutro",
  triste: "Triste",
  ansioso: "Ansioso",
};

/** Fator emocional: oficial (system) ou criado pelo usuario (custom). */
export const factorOriginSchema = z.enum(["system", "custom"]);
export type FactorOrigin = z.infer<typeof factorOriginSchema>;

export const emotionalFactorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(40),
  origin: factorOriginSchema,
  /** Preenchido apenas quando `origin === "custom"`. Ownership do autor. */
  ownerId: z.string().min(1).nullable(),
});

export type EmotionalFactor = z.infer<typeof emotionalFactorSchema>;

export const customFactorInputSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Informe o nome do fator.")
    .max(40, "O fator pode ter no máximo 40 caracteres."),
});
export type CustomFactorInput = z.infer<typeof customFactorInputSchema>;

const emotionalPayloadSchema = z.object({
  mood: scoreSchema,
  perceivedAnxiety: scoreSchema,
  energy: scoreSchema,
  primaryFeeling: primaryFeelingSchema,
  factorIds: z.array(z.string().uuid("Fator inválido.")).max(20),
  note: z.string().trim().min(1).max(500).nullable(),
});

function hasEmotionalValue(value: {
  mood: Score;
  perceivedAnxiety: Score;
  energy: Score;
  primaryFeeling: PrimaryFeeling | null;
}) {
  return (
    value.mood !== null ||
    value.perceivedAnxiety !== null ||
    value.energy !== null ||
    value.primaryFeeling !== null
  );
}

/** Check-in emocional. Multiplos por dia sao validos. */
export const emotionalCheckinSchema = emotionalPayloadSchema.extend({
  id: z.string().min(1),
  occurredAt: z.string().datetime({ offset: true }),
}).refine(hasEmotionalValue, "Informe pelo menos um dado emocional.");

export type EmotionalCheckin = z.infer<typeof emotionalCheckinSchema>;

/** Entrada de check-in vinda do formulario. */
export const emotionalCheckinInputSchema = emotionalPayloadSchema.refine(
  hasEmotionalValue,
  "Informe pelo menos um dado emocional.",
);

export type EmotionalCheckinInput = z.infer<typeof emotionalCheckinInputSchema>;

export const emotionalCheckinCreateSchema = emotionalPayloadSchema
  .extend({

    id: z.string().uuid("Check-in inválido.").optional(),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(hasEmotionalValue, "Informe pelo menos um dado emocional.");
export type EmotionalCheckinCreateInput = z.infer<
  typeof emotionalCheckinCreateSchema
>;

/**
 * Correcao de um check-in que ja existe.
 *
 * `occurredAt` e opcional de proposito: ausente, a data original permanece.
 * Corrigir o humor de ontem nao deve mover o registro para hoje - e mover a
 * data e uma acao diferente, que a pessoa precisa pedir explicitamente.
 */
export const emotionalCheckinUpdateSchema = emotionalPayloadSchema
  .extend({
    id: z.string().uuid("Check-in inválido."),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(hasEmotionalValue, "Informe pelo menos um dado emocional.");
export type EmotionalCheckinUpdateInput = z.infer<
  typeof emotionalCheckinUpdateSchema
>;

/** Registro de sono - separado do check-in. */
export const sleepRecordSchema = z.object({
  id: z.string().min(1),
  /** Data civil do despertar (YYYY-MM-DD). */
  night: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida."),
  /** Duracao em minutos. Ausencia e valida. */
  durationMinutes: z.number().int().min(0).max(24 * 60).nullable(),
  quality: scoreSchema,
});

export type SleepRecord = z.infer<typeof sleepRecordSchema>;

export const sleepRecordInputSchema = sleepRecordSchema
  .omit({ id: true })
  .refine(
    (value) => value.durationMinutes !== null || value.quality !== null,
    "Informe a duração ou a qualidade do sono.",
  );
export type SleepRecordInput = z.infer<typeof sleepRecordInputSchema>;

export interface EmotionalSnapshot {
  checkins: EmotionalCheckin[];
  factors: EmotionalFactor[];
  sleep: SleepRecord[];
}
