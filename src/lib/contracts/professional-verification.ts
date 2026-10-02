import { z } from "zod";



export const VERIFICATION_STATUSES = [
  "pending",
  "under_review",
  "verified",
  "rejected",
  "suspended",
  "expired_review",
  // F1: ambiguidade corrigivel volta ao profissional (PENDING_CORRECTION).
  "needs_correction",
] as const;

export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  pending: "Aguardando revisão",
  under_review: "Em revisão",
  verified: "Registro verificado",
  rejected: "Registro não confirmado",
  suspended: "Verificação suspensa",
  expired_review: "Revisão vencida",
  needs_correction: "Correção necessária",
};

/**
 * O que o estado significa para quem esta lendo. A Elyra nao certifica
 * qualidade profissional: "verificado" afirma apenas que o registro foi
 * consultado na fonte oficial e estava ativo naquela data.
 */
export const VERIFICATION_DESCRIPTION: Record<VerificationStatus, string> = {
  pending:
    "Seu registro ainda não foi conferido. Sem verificação vigente você não acessa dados de ninguém.",
  under_review: "Uma pessoa está conferindo seu registro na fonte oficial do conselho.",
  verified:
    "O registro foi consultado na fonte oficial e estava ativo. Isso não é selo de qualidade profissional.",
  rejected:
    "O registro informado não foi confirmado na fonte oficial. Revise os dados para pedir nova conferência.",
  suspended: "A verificação está suspensa. Nenhum dado compartilhado fica acessível enquanto isso.",
  expired_review:
    "A validade da conferência terminou. Até nova revisão, nenhum dado compartilhado fica acessível.",
  needs_correction:
    "Uma informação do cadastro precisa ser corrigida antes de a conferência continuar.",
};

/** A proxima acao legitima em cada estado - nunca uma acao que nao existe. */
export const VERIFICATION_NEXT_STEP: Record<VerificationStatus, string> = {
  pending: "Aguardar a conferência. Confira se região e número estão corretos.",
  under_review: "Nenhuma ação sua agora. A conferência está em andamento.",
  verified: "Nenhuma ação. Convites e acompanhamentos estão liberados.",
  rejected: "Corrija região ou número e salve para pedir nova conferência.",
  suspended: "Nenhuma edição de registro é possível enquanto a suspensão vale.",
  expired_review: "Aguardar nova conferência, feita pela equipe de revisão.",
  needs_correction: "Corrigir o que foi apontado e reenviar o cadastro.",
};

/** Motivo codificado do historico, em linguagem de quem le. */
export const VERIFICATION_REASON_LABEL: Record<string, string> = {
  legacy_migration: "Migração do cadastro anterior",
  credential_submitted: "Registro cadastrado",
  credential_changed: "Registro alterado",
  review_started: "Conferência iniciada",
  review_due: "Revalidação periódica",
  registry_active_confirmed: "Registro ativo na fonte oficial",
  registry_not_found: "Registro não encontrado na fonte oficial",
  registry_inactive: "Registro inativo na fonte oficial",
  registry_mismatch: "Dados diferentes da fonte oficial",
  source_unavailable: "Fonte oficial indisponível; volta para a fila",
  conduct_report: "Relato em análise",
  validity_elapsed: "Validade da conferência terminou",
  correction_requested: "Correção solicitada",
  correction_submitted: "Correção reenviada",
  automated_precheck_manual_hold: "Checagem automática concluída; conferência humana em andamento",
  registry_format_invalid: "Número de registro em formato inválido",
  identity_unconfirmed: "Identidade não confirmada",
  information_insufficient: "Informações insuficientes",
  name_mismatch: "Nome diferente do registro",
  document_unreadable: "Documento ilegível",
};

/**
 * Espelha `professional_effective_verification_status`: `verified` vencido e
 * `expired_review` na leitura, antes de qualquer job materializar.
 */
export function effectiveVerificationStatus(
  status: string | null | undefined,
  reviewDueAt: string | null | undefined,
  now: number = Date.now(),
): VerificationStatus {
  const parsed = verificationStatusSchema.safeParse(status);
  // Estado desconhecido nunca vira acesso: cai no mais restritivo que a tela
  // sabe explicar.
  if (!parsed.success) return "pending";
  if (parsed.data !== "verified") return parsed.data;
  if (!reviewDueAt) return "expired_review";
  const due = Date.parse(reviewDueAt);
  if (!Number.isFinite(due) || due <= now) return "expired_review";
  return "verified";
}

export const COUNCIL_REGION_PATTERN = /^(0[1-9]|[1-9][0-9])$/;

export const professionalCredentialInputSchema = z
  .object({
    councilRegion: z
      .string()
      .trim()
      .regex(COUNCIL_REGION_PATTERN, "Informe a região do conselho com dois dígitos (ex.: 06)."),
    registrationNumber: z.string().trim().min(3).max(50),
    specialty: z.string().trim().min(2).max(80),
  })
  .strict();

export type ProfessionalCredentialInput = z.infer<typeof professionalCredentialInputSchema>;

export const VERIFICATION_REASON_CODES = [
  "review_started",
  "review_due",
  "registry_active_confirmed",
  "registry_not_found",
  "registry_inactive",
  "registry_mismatch",
  "source_unavailable",
  "conduct_report",
  "correction_requested",
  "name_mismatch",
  "information_insufficient",
  "document_unreadable",
  "registry_format_invalid",
] as const;

export const VERIFICATION_SOURCES = [
  "cfp_cadastro_nacional_manual",
  "crp_regional_manual",
  "elyra_workflow",
] as const;

/**
 * Decisao de reviewer. A matriz de transicao e decidida pelo banco; o schema so
 * recusa pedido malformado. `evidenceDigest` e o sha256 (hex) do fato
 * consultado - nunca o documento.
 */
export const verificationReviewInputSchema = z
  .object({
    professionalUserId: z.string().uuid(),
    toStatus: z.enum(["under_review", "verified", "rejected", "pending", "suspended", "needs_correction"]),
    reasonCode: z.enum(VERIFICATION_REASON_CODES),
    source: z.enum(VERIFICATION_SOURCES),
    evidenceDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "Digest precisa ser sha256 em hexadecimal.")
      .nullable()
      .optional(),
    validDays: z.number().int().min(30).max(365).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.toStatus === "verified" && (!input.evidenceDigest || !input.validDays)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Aprovação exige digest do fato consultado e validade.",
        path: ["evidenceDigest"],
      });
    }
  });

export type VerificationReviewInput = z.infer<typeof verificationReviewInputSchema>;
