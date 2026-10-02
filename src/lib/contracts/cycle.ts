import { z } from "zod";



const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");


export const FLOW_LEVELS = ["spotting", "light", "medium", "heavy"] as const;

export const flowSchema = z.enum(FLOW_LEVELS).nullable();
export type Flow = (typeof FLOW_LEVELS)[number];

export const FLOW_LABEL: Record<Flow, string> = {
  spotting: "Escape",
  light: "Leve",
  medium: "Moderado",
  heavy: "Intenso",
};

/** Posicao na escala, 1-based. Usada so para desenhar a escala de gotas. */
export const FLOW_RANK: Record<Flow, number> = {
  spotting: 1,
  light: 2,
  medium: 3,
  heavy: 4,
};

/** Severidade de sintoma. Tres niveis, conforme escopo aprovado da V1. */
export const SEVERITIES = ["leve", "moderada", "intensa"] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_RANK: Record<Severity, number> = {
  leve: 1,
  moderada: 2,
  intensa: 3,
};

/** Perfil do modulo. `enabled === false` mantem os dados: desativar nao apaga. */
export const cycleProfileSchema = z.object({
  enabled: z.boolean(),
  /** Instante do opt-in. `null` enquanto nunca foi ativado. */
  optedInAt: z.string().datetime({ offset: true }).nullable(),
});

export type CycleProfile = z.infer<typeof cycleProfileSchema>;


export const cyclePeriodSchema = z
  .object({
    id: z.string().min(1),
    startDate: dateSchema,
    endDate: dateSchema.nullable(),
  })
  .refine((p) => p.endDate === null || p.endDate >= p.startDate, {
    message: "O fim do período não pode ser anterior ao início.",
    path: ["endDate"],
  });

export type CyclePeriod = z.infer<typeof cyclePeriodSchema>;

/** Sintoma: oficial (`system`) ou criado pelo usuario (`custom`). */
export const cycleSymptomSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(40),
  origin: z.enum(["system", "custom"]),
  /** Preenchido apenas quando `origin === "custom"`. Ownership do autor. */
  ownerId: z.string().min(1).nullable(),
});

export type CycleSymptom = z.infer<typeof cycleSymptomSchema>;

/** Sintoma marcado em um dia, com a severidade autorrelatada. */
export const dailySymptomSchema = z.object({
  symptomId: z.string().min(1),
  severity: severitySchema,
});

export type DailySymptom = z.infer<typeof dailySymptomSchema>;


export const cycleDailyRecordSchema = z.object({
  id: z.string().min(1),
  date: dateSchema,
  flow: flowSchema,
  symptoms: z.array(dailySymptomSchema),
  note: z.string().max(500).nullable(),
});

export type CycleDailyRecord = z.infer<typeof cycleDailyRecordSchema>;

export const cycleDailyRecordInputSchema = cycleDailyRecordSchema.omit({
  id: true,
});

export type CycleDailyRecordInput = z.infer<typeof cycleDailyRecordInputSchema>;

export const cycleProfileUpdateSchema = z.object({ enabled: z.boolean() });

export const cyclePeriodInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    startDate: dateSchema,
    endDate: dateSchema.nullable(),
  })
  .refine((period) => period.endDate === null || period.endDate >= period.startDate, {
    message: "O fim do período não pode ser anterior ao início.",
    path: ["endDate"],
  });

export const cyclePeriodDeleteSchema = z.object({ id: z.string().uuid() });

export const cycleRecordDeleteSchema = z.object({ date: dateSchema });

export const customCycleSymptomInputSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Informe um nome para o sintoma.")
    .max(40, "O nome pode ter no máximo 40 caracteres."),
});

export interface CycleSnapshot {
  profile: CycleProfile;
  periods: CyclePeriod[];
  records: CycleDailyRecord[];
  symptoms: CycleSymptom[];
}

/**
 * Fases do ciclo.
 *
 * Derivadas, nunca persistidas. A fase mostrada e uma leitura aproximada da
 * posicao no ciclo, nao um estado biologico medido.
 */
export const CYCLE_PHASES = [
  "menstrual",
  "follicular",
  "ovulatory",
  "luteal",
] as const;

export type CyclePhase = (typeof CYCLE_PHASES)[number];

export const PHASE_LABEL: Record<CyclePhase, string> = {
  menstrual: "Menstruação",
  follicular: "Fase folicular",
  ovulatory: "Ovulação",
  luteal: "Fase lútea",
};
