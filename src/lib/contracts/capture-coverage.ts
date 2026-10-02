import { z } from "zod";

import { CAPTURE_RESOURCES } from "@/lib/contracts/session";


export const VISUAL_MODALITIES = [
  "visual_face",
  "visual_body",
  "visual_hands",
] as const;
export type VisualModality = (typeof VISUAL_MODALITIES)[number];

/** Tudo sobre o que se pode declarar cobertura. */
export const OBSERVATION_MODALITIES = [
  ...CAPTURE_RESOURCES,
  ...VISUAL_MODALITIES,
] as const;
export type ObservationModality = (typeof OBSERVATION_MODALITIES)[number];

const VISUAL = new Set<string>(VISUAL_MODALITIES);

export function isVisualModality(
  modality: ObservationModality,
): modality is VisualModality {
  return VISUAL.has(modality);
}



export const CAPTURE_OUTCOMES = ["full", "partial", "absent"] as const;
export type CaptureOutcome = (typeof CAPTURE_OUTCOMES)[number];

/**
 * Por que a modalidade nao produziu nada.
 *
 * `not_requested` e diferente de `denied`, e os dois sao diferentes de
 * `unsupported`: a pessoa nao pediu, a pessoa recusou, ou o navegador nao
 * oferece. Fundir os tres apagaria justamente a distincao que `HQ-002` custou
 * uma homologacao humana para estabelecer.
 */
export const CAPTURE_ABSENCE_REASONS = [
  "not_requested",
  "unsupported",
  "denied",
  "cancelled",
  "error",
  /**
   * A analise rodou e a modalidade nunca apareceu.
   *
   * So existe para modalidade visual, e e diferente de todas as anteriores: nao
   * e falta de permissao, nem falta de suporte, nem falha. A observacao
   * aconteceu e o resultado dela foi "nao havia corpo aqui". Fundi-la com
   * `error` afirmaria defeito onde houve medida; fundi-la com `not_requested`
   * afirmaria que ninguem olhou.
   */
  "not_observed",
] as const;
export type CaptureAbsenceReason = (typeof CAPTURE_ABSENCE_REASONS)[number];

/**
 * Por que a modalidade cobriu so parte da sessao.
 *
 * `interrupted` e o navegador ou o sistema encerrando a track - aba trocada,
 * dispositivo desconectado, permissao revogada no meio.
 * `recording_capped` e a Elyra parando a **gravacao** por ter atingido o teto de
 * bytes. Os dois produzem cobertura parcial e tem causas opostas: um e perda, o
 * outro e limite declarado. Fundi-los esconderia qual dos dois aconteceu.
 */
export const CAPTURE_PARTIAL_REASONS = [
  "interrupted",
  "recording_capped",
  /**
   * A analise rodou o tempo todo e a modalidade apareceu so em parte dele.
   *
   * `interrupted` e perda de fonte; `out_of_frame` e a fonte inteira presente
   * com a pessoa fora do enquadramento. Sem os dois nomes, uma sessao em que
   * alguem saiu da frente da camera seria indistinguivel de uma em que o modelo
   * quebrou no meio.
   */
  "out_of_frame",
  /**
   * A analise visual comecou **depois** da sessao.
   *
   * Carregar 21 MB de WASM e modelo leva segundos, e a sessao nao espera por
   * isso. Numa sessao de 60 s cuja analise subiu no segundo 5, os primeiros 5
   * segundos nao foram observados por ninguem - e declarar `full` ali seria
   * afirmar observacao que nao houve.
   *
   * Distinto de `interrupted` (a fonte se perdeu no meio) e de `out_of_frame`
   * (a fonte estava inteira e a pessoa fora dela). Aqui a fonte ainda nao
   * existia.
   */
  "analysis_started_late",
] as const;
export type CapturePartialReason = (typeof CAPTURE_PARTIAL_REASONS)[number];

export const CAPTURE_COVERAGE_REASONS = [
  ...CAPTURE_ABSENCE_REASONS,
  ...CAPTURE_PARTIAL_REASONS,
] as const;
export type CaptureCoverageReason = (typeof CAPTURE_COVERAGE_REASONS)[number];

export const captureCoverageSchema = z
  .object({
    modality: z.enum(OBSERVATION_MODALITIES),
    outcome: z.enum(CAPTURE_OUTCOMES),
    /** `null` somente quando `full`: cobertura completa nao tem por que. */
    reason: z.enum(CAPTURE_COVERAGE_REASONS).nullable(),
    /** Tempo em que a modalidade esteve ativa, em ms. */
    coverageMs: z.number().int().min(0).max(3_600_000),
    /** Duracao da sessao contra a qual a cobertura e lida. */
    sessionDurationMs: z.number().int().min(0).max(3_600_000),
  })
  .strict()
  .superRefine((coverage, ctx) => {
    if (coverage.coverageMs > coverage.sessionDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cobertura maior que a duracao da sessao.",
      });
    }

    if (coverage.outcome === "full") {
      if (coverage.reason !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Cobertura completa nao tem motivo.",
        });
      }
      return;
    }

    if (coverage.reason === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cobertura incompleta exige motivo declarado.",
      });
      return;
    }

    if (coverage.outcome === "absent") {
      if (!ABSENCE.has(coverage.reason as CaptureAbsenceReason)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Motivo incompativel com ausencia de captura.",
        });
      }
      // Ausencia nao carrega tempo. Um `coverageMs` positivo aqui afirmaria que
      // houve captura, que e exatamente o que `absent` nega.
      if (coverage.coverageMs !== 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Modalidade ausente nao pode ter cobertura.",
        });
      }
      return;
    }

    if (!PARTIAL.has(coverage.reason as CapturePartialReason)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Motivo incompativel com cobertura parcial.",
      });
    }
  });

const ABSENCE = new Set<CaptureAbsenceReason>(CAPTURE_ABSENCE_REASONS);
const PARTIAL = new Set<CapturePartialReason>(CAPTURE_PARTIAL_REASONS);

export type CaptureCoverage = z.infer<typeof captureCoverageSchema>;

/**
 * Fracao da sessao coberta, em 0-1.
 *
 * Sessao de duracao zero devolve `0`, e nao `1`: nao houve sessao para cobrir, e
 * arredondar isso para "completa" seria afirmar cobertura que ninguem mediu.
 */
export function coverageRatio(coverage: {
  coverageMs: number;
  sessionDurationMs: number;
}): number {
  if (coverage.sessionDurationMs <= 0) return 0;
  const ratio = coverage.coverageMs / coverage.sessionDurationMs;
  return Math.min(Math.max(ratio, 0), 1);
}

/** Rotulo do desfecho. Descreve a captura, nunca a pessoa. */
export const CAPTURE_OUTCOME_LABEL: Record<CaptureOutcome, string> = {
  full: "Completa",
  partial: "Parcial",
  absent: "Não capturada",
};

export const CAPTURE_REASON_LABEL: Record<CaptureCoverageReason, string> = {
  not_requested: "Não foi autorizada para esta sessão",
  unsupported: "Não suportada neste navegador",
  denied: "Permissão negada",
  cancelled: "Seleção cancelada",
  error: "Falha ao iniciar a captura",
  not_observed: "Não apareceu no enquadramento",
  interrupted: "Encerrada antes do fim da sessão",
  recording_capped: "Gravação atingiu o limite de tamanho",
  out_of_frame: "Fora do enquadramento em parte da sessão",
  analysis_started_late: "Análise começou depois do início da sessão",
};


export const OBSERVATION_MODALITY_LABEL: Record<ObservationModality, string> = {
  screen: "Tela",
  camera: "Câmera",
  microphone: "Microfone",
  visual_face: "Rosto no enquadramento",
  visual_body: "Corpo no enquadramento",
  visual_hands: "Mãos no enquadramento",
};

/**
 * A modalidade produziu tempo suficiente para o sinal ser lido como da sessao?
 *
 * **Nao** decide se o sinal existe - isso e `status`. Decide se ele pode ser
 * apresentado sem ressalva. Cobertura abaixo do minimo continua produzindo o
 * numero; o que muda e que a tela, o relatorio e o Veltrix passam a ser
 * obrigados a dizer sobre que fracao ele fala.
 *
 * O minimo e explicito e versionado junto do extrator, e nao um numero solto no
 * meio de um componente.
 */
export const COVERAGE_UNQUALIFIED_MIN_RATIO = 0.8;

export function coverageNeedsQualification(coverage: CaptureCoverage): boolean {
  if (coverage.outcome === "absent") return false;
  return coverageRatio(coverage) < COVERAGE_UNQUALIFIED_MIN_RATIO;
}

/** Cobertura de uma modalidade que a pessoa nem autorizou. */
export function notRequestedCoverage(
  modality: ObservationModality,
  sessionDurationMs: number,
): CaptureCoverage {
  return captureCoverageSchema.parse({
    modality,
    outcome: "absent",
    reason: "not_requested",
    coverageMs: 0,
    sessionDurationMs,
  });
}
