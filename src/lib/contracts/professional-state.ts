import type { VerificationStatus } from "@/lib/contracts/professional-verification";



export const PROFESSIONAL_STATES = [
  "NO_PROFILE",
  "ONBOARDING",
  "UNDER_AUTOMATED_REVIEW",
  "PENDING_CORRECTION",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
  "EXPIRED_REVIEW",
] as const;

export type ProfessionalState = (typeof PROFESSIONAL_STATES)[number];

export const PROFESSIONAL_AREA_PATH = "/area-profissional";
export const PROFESSIONAL_ONBOARDING_PATH = "/area-profissional/cadastro";
export const PROFESSIONAL_DASHBOARD_PATH = "/pro/dashboard";

export function professionalStateFrom(input: {
  effectiveStatus: VerificationStatus | null;
  hasOnboardingDraft: boolean;
}): ProfessionalState {
  switch (input.effectiveStatus) {
    case null:
      return input.hasOnboardingDraft ? "ONBOARDING" : "NO_PROFILE";
    case "pending":
    case "under_review":
      return "UNDER_AUTOMATED_REVIEW";
    case "needs_correction":
      return "PENDING_CORRECTION";
    case "verified":
      return "VERIFIED";
    case "rejected":
      return "REJECTED";
    case "suspended":
      return "SUSPENDED";
    case "expired_review":
      return "EXPIRED_REVIEW";
    default:
      // Estado desconhecido nunca vira acesso.
      return "UNDER_AUTOMATED_REVIEW";
  }
}

export function isVerifiedProfessional(state: ProfessionalState) {
  return state === "VERIFIED";
}

/** Tem alguma relacao com a area profissional (para lembrar o ultimo contexto). */
export function hasProfessionalFootprint(state: ProfessionalState) {
  return state !== "NO_PROFILE";
}

export interface ProfessionalStatePolicy {
  /** Rotas liberadas alem da area pessoal. */
  routes: readonly string[];
  cta: { label: string; href: string } | null;
  /** Aparece na descoberta (so com perfil publico listado, alem disso). */
  discovery: boolean;
  /** Pode criar convite / aceitar vinculo / ler dado compartilhado. */
  relationships: boolean;
  agenda: boolean;
  sessions: boolean;
  dashboard: boolean;
  publicProfile: boolean;
  /** O que a pessoa faz para sair do estado. */
  regularization: string;
}

const NONE: Pick<ProfessionalStatePolicy, "discovery" | "relationships" | "agenda" | "sessions" | "dashboard" | "publicProfile"> = {
  discovery: false,
  relationships: false,
  agenda: false,
  sessions: false,
  dashboard: false,
  publicProfile: false,
};

const AREA_ROUTES = [PROFESSIONAL_AREA_PATH, PROFESSIONAL_ONBOARDING_PATH] as const;

export const PROFESSIONAL_STATE_POLICY: Record<ProfessionalState, ProfessionalStatePolicy> = {
  NO_PROFILE: {
    routes: AREA_ROUTES,
    cta: { label: "Entrar como profissional", href: PROFESSIONAL_ONBOARDING_PATH },
    ...NONE,
    regularization: "Começar o cadastro profissional.",
  },
  ONBOARDING: {
    routes: AREA_ROUTES,
    cta: { label: "Continuar cadastro profissional", href: PROFESSIONAL_ONBOARDING_PATH },
    ...NONE,
    regularization: "Concluir e enviar o cadastro.",
  },
  UNDER_AUTOMATED_REVIEW: {
    routes: AREA_ROUTES,
    cta: { label: "Acompanhar verificação profissional", href: PROFESSIONAL_AREA_PATH },
    ...NONE,
    regularization: "Aguardar a conferência. Nenhuma ação sua agora.",
  },
  PENDING_CORRECTION: {
    routes: AREA_ROUTES,
    cta: { label: "Corrigir cadastro profissional", href: `${PROFESSIONAL_ONBOARDING_PATH}?etapa=revisao` },
    ...NONE,
    regularization: "Corrigir o que foi apontado e reenviar.",
  },
  VERIFIED: {
    routes: [...AREA_ROUTES, "/pro"],
    cta: { label: "Ir para área profissional", href: PROFESSIONAL_DASHBOARD_PATH },
    discovery: true,
    relationships: true,
    agenda: true,
    sessions: true,
    dashboard: true,
    publicProfile: true,
    regularization: "Nenhuma. Renovar a conferência antes da validade.",
  },
  REJECTED: {
    routes: AREA_ROUTES,
    cta: { label: "Revisar situação profissional", href: PROFESSIONAL_AREA_PATH },
    ...NONE,
    regularization: "Revisar região e número do registro e reenviar com os dados corretos.",
  },
  SUSPENDED: {
    routes: AREA_ROUTES,
    cta: { label: "Regularizar acesso profissional", href: PROFESSIONAL_AREA_PATH },
    ...NONE,
    regularization: "Aguardar a análise da equipe de revisão; o registro fica bloqueado para edição.",
  },
  EXPIRED_REVIEW: {
    routes: AREA_ROUTES,
    cta: { label: "Regularizar acesso profissional", href: PROFESSIONAL_AREA_PATH },
    ...NONE,
    regularization: "Confirmar os dados e aguardar nova conferência.",
  },
};

/** Onde "Entrar como profissional" (ou o seletor) leva, por estado. */
export function professionalHomeFor(state: ProfessionalState): string {
  if (state === "VERIFIED") return PROFESSIONAL_DASHBOARD_PATH;
  if (state === "NO_PROFILE" || state === "ONBOARDING") return PROFESSIONAL_ONBOARDING_PATH;
  if (state === "PENDING_CORRECTION") return `${PROFESSIONAL_ONBOARDING_PATH}?etapa=revisao`;
  return PROFESSIONAL_AREA_PATH;
}

/** Rota do portal (`/pro`, `/pro/...`)? So VERIFIED entra. */
export function isProfessionalPortalPath(path: string) {
  return path === "/pro" || path.startsWith("/pro/") || path.startsWith("/pro?");
}

export const PROFESSIONAL_STATE_LABEL: Record<ProfessionalState, string> = {
  NO_PROFILE: "Sem cadastro profissional",
  ONBOARDING: "Cadastro em andamento",
  UNDER_AUTOMATED_REVIEW: "Verificação em andamento",
  PENDING_CORRECTION: "Correção necessária",
  VERIFIED: "Registro verificado",
  REJECTED: "Registro não confirmado",
  SUSPENDED: "Acesso profissional suspenso",
  EXPIRED_REVIEW: "Conferência vencida",
};

export const PROFESSIONAL_STATE_DESCRIPTION: Record<ProfessionalState, string> = {
  NO_PROFILE:
    "Se você atua como psicóloga ou psicólogo, cadastre seu registro. Sua conta continua a mesma: o mesmo login, a mesma senha e a mesma segurança.",
  ONBOARDING: "Seu cadastro está salvo. Continue de onde parou quando quiser.",
  UNDER_AUTOMATED_REVIEW:
    "Recebemos seu cadastro. A conferência do registro na fonte oficial do conselho está em andamento.",
  PENDING_CORRECTION: "Precisamos que você corrija uma informação antes de continuar a conferência.",
  VERIFIED:
    "O registro foi consultado na fonte oficial e estava ativo. Isso não é avaliação da qualidade profissional.",
  REJECTED: "O registro informado não foi confirmado na fonte oficial.",
  SUSPENDED: "A verificação está suspensa. Nenhum dado compartilhado fica acessível enquanto isso.",
  EXPIRED_REVIEW:
    "A validade da conferência terminou. Até nova conferência, a área profissional fica fechada.",
};
