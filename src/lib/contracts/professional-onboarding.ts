import { z } from "zod";

import { publicProfileInputSchema } from "@/lib/contracts/professional-directory";
import { COUNCIL_REGION_PATTERN } from "@/lib/contracts/professional-verification";



export const ONBOARDING_STEPS = [
  "inicio",
  "identidade",
  "registro",
  "formacao",
  "experiencia",
  "certificacoes",
  "atuacao",
  "perfil-publico",
  "revisao",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export const onboardingStepSchema = z.enum(ONBOARDING_STEPS);

export const ONBOARDING_STEP_LABEL: Record<OnboardingStep, string> = {
  inicio: "Início",
  identidade: "Identidade",
  registro: "Registro no conselho",
  formacao: "Formação",
  experiencia: "Experiência",
  certificacoes: "Certificações",
  atuacao: "Atuação",
  "perfil-publico": "Perfil público",
  revisao: "Revisão e envio",
};

/** Etapas sem as quais o envio e recusado. As demais sao opcionais. */
export const REQUIRED_ONBOARDING_STEPS: readonly OnboardingStep[] = ["identidade", "registro"];

export function parseOnboardingStep(raw: unknown): OnboardingStep | null {
  const parsed = onboardingStepSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function nextOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[index + 1] ?? null;
}

export function previousOnboardingStep(step: OnboardingStep): OnboardingStep | null {
  const index = ONBOARDING_STEPS.indexOf(step);
  return index > 0 ? (ONBOARDING_STEPS[index - 1] ?? null) : null;
}

export const identityStepSchema = z
  .object({ confirmed: z.literal(true, { errorMap: () => ({ message: "Confirme para continuar." }) }) })
  .strict();

export const registryStepSchema = z
  .object({
    councilRegion: z
      .string()
      .trim()
      .regex(COUNCIL_REGION_PATTERN, "Informe a região do conselho com dois dígitos (ex.: 06)."),
    registrationNumber: z
      .string()
      .trim()
      .min(3, "Informe o número do registro.")
      .max(50),
    specialty: z.string().trim().min(2, "Informe sua área de atuação.").max(80),
  })
  .strict();

/** Rascunho do perfil publico: mesmo contrato do PRO-5, sempre nao listado. */
export const publicDraftSchema = publicProfileInputSchema.innerType().omit({ listed: true }).partial();
export type PublicDraft = z.infer<typeof publicDraftSchema>;

export const onboardingStepInputSchema = z.discriminatedUnion("step", [
  z.object({ step: z.literal("inicio") }).strict(),
  z.object({ step: z.literal("identidade"), data: identityStepSchema }).strict(),
  z.object({ step: z.literal("registro"), data: registryStepSchema }).strict(),
  z.object({ step: z.literal("formacao") }).strict(),
  z.object({ step: z.literal("experiencia") }).strict(),
  z.object({ step: z.literal("certificacoes") }).strict(),
  z.object({ step: z.literal("atuacao"), data: publicDraftSchema }).strict(),
  z.object({ step: z.literal("perfil-publico"), data: publicDraftSchema }).strict(),
]);
export type OnboardingStepInput = z.infer<typeof onboardingStepInputSchema>;

export const CREDENTIAL_KINDS = ["education", "experience", "certification"] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const CREDENTIAL_KIND_FOR_STEP: Partial<Record<OnboardingStep, CredentialKind>> = {
  formacao: "education",
  experiencia: "experience",
  certificacoes: "certification",
};

export const CREDENTIAL_COPY: Record<
  CredentialKind,
  { title: string; institution: string; empty: string; add: string }
> = {
  education: {
    title: "Curso",
    institution: "Instituição",
    empty: "Nenhuma formação adicionada.",
    add: "Adicionar formação",
  },
  experience: {
    title: "Função",
    institution: "Organização",
    empty: "Nenhuma experiência adicionada.",
    add: "Adicionar experiência",
  },
  certification: {
    title: "Certificação",
    institution: "Emissor",
    empty: "Nenhuma certificação adicionada.",
    add: "Adicionar certificação",
  },
};

const currentYear = () => new Date().getFullYear();

export const credentialInputSchema = z
  .object({
    kind: z.enum(CREDENTIAL_KINDS),
    title: z.string().trim().min(2, "Use pelo menos 2 caracteres.").max(120),
    institution: z.string().trim().min(2, "Use pelo menos 2 caracteres.").max(120),
    startYear: z.number().int().min(1950).max(2100).nullable(),
    endYear: z.number().int().min(1950).max(2100).nullable(),
    expiresOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.startYear !== null && input.endYear !== null && input.endYear < input.startYear) {
      ctx.addIssue({ code: "custom", path: ["endYear"], message: "O fim não pode ser antes do início." });
    }
    if (input.startYear !== null && input.startYear > currentYear()) {
      ctx.addIssue({ code: "custom", path: ["startYear"], message: "O início não pode estar no futuro." });
    }
    if (input.kind !== "certification" && input.expiresOn !== null) {
      ctx.addIssue({ code: "custom", path: ["expiresOn"], message: "Validade só se aplica a certificações." });
    }
  });
export type CredentialInput = z.infer<typeof credentialInputSchema>;

export const TRUST_STATE_LABEL = {
  declared: "Declarado pelo profissional",
  verified: "Verificado pela Elyra",
} as const;

/** Decisao do reviewer sobre uma credencial (F5). Digest = sha256 do que foi conferido. */
export const credentialReviewInputSchema = z
  .object({
    credentialId: z.string().uuid(),
    verified: z.boolean(),
    source: z.enum(["issuer_manual", "document_manual"]).nullable().optional(),
    evidenceDigest: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "Digest precisa ser sha256 em hexadecimal.")
      .nullable()
      .optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.verified && (!input.source || !input.evidenceDigest)) {
      ctx.addIssue({ code: "custom", path: ["evidenceDigest"], message: "Conferência exige fonte e digest." });
    }
  });
