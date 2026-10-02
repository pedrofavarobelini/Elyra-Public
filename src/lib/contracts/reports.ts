import { z } from "zod";

export const REPORT_SCHEMA_VERSION = "report_snapshot/v1" as const;
export const ANALYTICS_VERSION = "elyra-analytics/v1" as const;

export const REPORT_RANGE_DAYS = [28, 56, 90] as const;


export const COMPARISON_WINDOW_DAYS = [7, 28, 90] as const;

const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Data de referência inválida.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Data de referência inválida.");

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}


export const liveReportRequestSchema = z.object({
  days: z.union([
    z.literal(7),
    z.literal(28),
    z.literal(56),
    z.literal(90),
  ]),
  referenceDate: civilDateSchema,
  timeZone: z
    .string()
    .min(1, "Informe o fuso horário.")
    .max(64, "Fuso horário inválido.")
    .refine(isIanaTimeZone, "Fuso horário inválido."),
});

export type LiveReportRequest = z.infer<typeof liveReportRequestSchema>;

/**
 * Snapshot: deliberadamente **mais estreito** que a leitura ao vivo.
 *
 * Recusar aqui e o que impede uma janela de 7 dias de ser persistida e, mais
 * tarde, submetida ao Veltrix por um caminho que nao previu isso.
 */
export const reportRequestSchema = z.object({
  days: z.union([z.literal(28), z.literal(56), z.literal(90)]),
  referenceDate: civilDateSchema,
  timeZone: z
    .string()
    .min(1, "Informe o fuso horário.")
    .max(64, "Fuso horário inválido.")
    .refine(isIanaTimeZone, "Fuso horário inválido."),
});

export type ReportRequest = z.infer<typeof reportRequestSchema>;

/**
 * Teto de um periodo personalizado, em dias.
 *
 * Nao e limite de produto, e limite de custo: a leitura carrega os registros do
 * intervalo para a memoria antes de agregar. 731 dias sao dois anos completos
 * mais o dia de borda - alcanca a pergunta longitudinal mais longa que o produto
 * se propoe a responder, e ainda cabe numa requisicao.
 */
export const MAX_CUSTOM_RANGE_DAYS = 731;


export const customRangeRequestSchema = z
  .object({
    from: civilDateSchema,
    to: civilDateSchema,
    timeZone: z
      .string()
      .min(1, "Informe o fuso horário.")
      .max(64, "Fuso horário inválido.")
      .refine(isIanaTimeZone, "Fuso horário inválido."),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.to < input.from) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A data final não pode ser anterior à inicial.",
        path: ["to"],
      });
      return;
    }
    const dias =
      Math.round(
        (Date.parse(`${input.to}T00:00:00.000Z`) -
          Date.parse(`${input.from}T00:00:00.000Z`)) /
          86_400_000,
      ) + 1;
    if (dias > MAX_CUSTOM_RANGE_DAYS) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `O período pode cobrir no máximo ${MAX_CUSTOM_RANGE_DAYS} dias.`,
        path: ["to"],
      });
    }
  });

export type CustomRangeRequest = z.infer<typeof customRangeRequestSchema>;

/** Comparacao entre dois periodos escolhidos pela pessoa. */
export const periodComparisonRequestSchema = z
  .object({
    current: customRangeRequestSchema,
    baseline: customRangeRequestSchema,
  })
  .strict();

export type PeriodComparisonRequest = z.infer<typeof periodComparisonRequestSchema>;
