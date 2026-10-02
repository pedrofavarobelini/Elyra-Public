

export const API_CONSENT_CLASSES = [
  "PUBLIC",
  "PRE_CONSENT_ALLOWED",
  "REQUIRES_TERMS",
  "INTERNAL_SECRET",
] as const;

export type ApiConsentClass = (typeof API_CONSENT_CLASSES)[number];

/**
 * Rotas que funcionam sem aceite vigente.
 *
 * Duas, e cada uma tem motivo proprio:
 *
 * - **`/api/me/consents`**: ler o proprio historico de consentimento. Exigir
 *   consentimento para consultar consentimento e circular.
 * - **`/api/me/account`**: exclusao da propria conta. Quem nao aceita os termos
 *   precisa poder ir embora; um portao que impedisse a saida transformaria
 *   recusa em armadilha.
 *
 * Exportacao de dados **nao** entra: ela e cara, e quem ainda nao aceitou nao
 * acumulou dado para exportar. Se um dia existir revogacao de `terms_privacy`,
 * essa decisao precisa ser revista junto — anotado de proposito.
 */
export const PRE_CONSENT_ALLOWED_ROUTES = [
  "api/me/consents",
  "api/me/account",
] as const;

/** Rotas sem sessao sob `/api`. Vazio hoje, e a ausencia e a afirmacao. */
export const PUBLIC_API_ROUTES: readonly string[] = [];

/**
 * Rotas de sistema, chamadas por agendador com segredo (ADR-0023).
 * Nenhuma le sessao de pessoa; nenhuma devolve dado de titular.
 */
export const INTERNAL_SECRET_ROUTES = ["api/internal/notifications/dispatch"] as const;

/**
 * Todo o resto exige aceite. Declarado por extenso, e nao por exclusao:
 * uma lista que se define como "o que sobra" nao reprova nada quando falta um
 * item.
 */
export const REQUIRES_TERMS_ROUTES = [
  "api/cycle/data",
  "api/cycle/periods",
  "api/cycle/profile",
  "api/cycle/records",
  "api/cycle/symptoms",
  "api/emotional/checkins",
  "api/emotional/factors",
  "api/emotional/sleep",
  "api/goals",
  "api/goals/progress",
  "api/journal/entries",
  "api/journal/purge",
  "api/journal/tags",
  "api/learning/consent",
  "api/learning/exports",
  "api/me/export",
  "api/me/preferences",
  "api/me/profile",
  "api/me/profile/photo",
  "api/personal/history",
  "api/multimodal/assets",
  "api/multimodal/assets/[id]",
  "api/multimodal/assets/[id]/signed-url",
  "api/multimodal/sessions",
  "api/multimodal/sessions/[id]",
  "api/multimodal/sessions/[id]/analysis",
  "api/notifications",
  "api/notifications/[id]",
  "api/notifications/preferences",
  "api/professional-sessions",
  "api/professional-sessions/[id]",
  "api/professional-sessions/[id]/consents",
  "api/professional-sessions/[id]/media",
  "api/professional-sessions/[id]/transcript",
  "api/professional/access-log",
  "api/professional/connection-requests",
  "api/professional/connections",
  "api/professional/invites",
  "api/professional/invites/redeem",
  "api/professional/notes",
  "api/professional/patients/[id]",
  "api/professional/permissions",
  "api/professional/permissions/validity",
  "api/professional/profile",
  "api/professional/public-profile",
  "api/professional/onboarding",
  "api/professional/credentials",
  "api/professional/review",
  "api/professional/review/credentials",
  "api/professional/verification",
  "api/help-requests",
  "api/help-requests/[id]",
  "api/reports/insights",
  "api/reports/snapshots",
  "api/scheduling/appointments",
  "api/scheduling/appointments/[id]",
  "api/scheduling/availability",
  "api/scheduling/availability/week",
  "api/scheduling/availability/exceptions",
  "api/scheduling/availability/exceptions/[id]",
  "api/scheduling/slots",
  // SUP-2: busca da Rede de Apoio (dado institucional, mas conta com termos aceitos).
  "api/support/facilities/search",
] as const;

/** Toda rota declarada, com a classe dela. */
export function classifyApiRoute(route: string): ApiConsentClass | null {
  if (PUBLIC_API_ROUTES.includes(route)) return "PUBLIC";
  if ((INTERNAL_SECRET_ROUTES as readonly string[]).includes(route)) return "INTERNAL_SECRET";
  if ((PRE_CONSENT_ALLOWED_ROUTES as readonly string[]).includes(route)) {
    return "PRE_CONSENT_ALLOWED";
  }
  if ((REQUIRES_TERMS_ROUTES as readonly string[]).includes(route)) {
    return "REQUIRES_TERMS";
  }
  return null;
}

export const DECLARED_API_ROUTES: readonly string[] = [
  ...PUBLIC_API_ROUTES,
  ...INTERNAL_SECRET_ROUTES,
  ...PRE_CONSENT_ALLOWED_ROUTES,
  ...REQUIRES_TERMS_ROUTES,
];
