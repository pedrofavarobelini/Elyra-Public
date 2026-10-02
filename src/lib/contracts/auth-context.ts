import { DEFAULT_POST_AUTH_PATH, safeInternalPath } from "@/lib/security/safe-redirect";
import {
  hasProfessionalFootprint,
  professionalHomeFor,
  PROFESSIONAL_AREA_PATH,
  PROFESSIONAL_DASHBOARD_PATH,
  type ProfessionalState,
} from "@/lib/contracts/professional-state";



export const AUTH_CONTEXTS = ["personal", "professional"] as const;
export type AuthContext = (typeof AUTH_CONTEXTS)[number];

/** Parametro de URL/formulario que carrega a intencao de entrada. */
export const AUTH_CONTEXT_PARAM = "context";

/** Cookie de preferencia de navegacao (nao autoritativo). */
export const LAST_CONTEXT_COOKIE = "elyra_context";
export const LAST_CONTEXT_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export const PROFESSIONAL_HOME = PROFESSIONAL_DASHBOARD_PATH;
/** F1: fora de `/pro`, que so abre para VERIFIED. */
export const PROFESSIONAL_ONBOARDING = PROFESSIONAL_AREA_PATH;

/**
 * Allowlist exata. Qualquer outro valor - maiusculas, espacos, `admin`, URL -
 * e `null`, e `null` significa "sem intencao declarada".
 */
export function parseAuthContext(raw: unknown): AuthContext | null {
  return raw === "personal" || raw === "professional" ? raw : null;
}

/** O que a conta tem do lado profissional, lido do banco no servidor (F1). */
export type ProfessionalCapability = ProfessionalState;

/**
 * Casa profissional de uma conta. So VERIFIED vai ao cockpit; os demais
 * estados vao a Area profissional (estado + proximo passo) ou ao cadastro.
 */
export function professionalHome(capability: ProfessionalCapability) {
  return professionalHomeFor(capability);
}

/**
 * Destino depois de autenticar, com precedencia documentada:
 *
 * 1. `next` seguro que nao seja o padrao (deep link que mandou a pessoa ao
 *    login) - a pessoa pediu aquela tela;
 * 2. intencao explicita desta entrada (`Entrar como profissional` ou
 *    `Entrar na area pessoal`);
 * 3. ultimo contexto **desta conta**, e so se ela ainda tiver perfil
 *    profissional (preferencia sem capacidade nao leva ao portal);
 * 4. area pessoal.
 */
export function resolvePostAuthPath(input: {
  next?: string | null;
  intent: AuthContext | null;
  lastContext: AuthContext | null;
  capability: ProfessionalCapability;
}): string {
  const deepLink = safeInternalPath(input.next, "");
  // Voltar para a propria tela de entrada nao e destino: seria um laco.
  const isAuthScreen = /^\/(entrar|cadastro|recuperar-senha|redefinir-senha)(\/|\?|$)/.test(deepLink);
  if (deepLink && deepLink !== DEFAULT_POST_AUTH_PATH && !isAuthScreen) return deepLink;

  const context: AuthContext =
    input.intent ??
    (input.lastContext === "professional" && hasProfessionalFootprint(input.capability) ? "professional" : "personal");

  return context === "professional" ? professionalHome(input.capability) : DEFAULT_POST_AUTH_PATH;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * O cookie guarda `<userId>.<contexto>`. Amarrado a conta: se outra pessoa
 * entrar no mesmo aparelho, a preferencia da primeira nao a manda ao portal.
 */
export function encodeLastContext(userId: string, context: AuthContext) {
  return `${userId}.${context}`;
}

export function decodeLastContext(raw: string | null | undefined, userId: string): AuthContext | null {
  if (typeof raw !== "string" || raw.length > 64) return null;
  const separator = raw.lastIndexOf(".");
  if (separator < 0) return null;
  const owner = raw.slice(0, separator);
  if (!UUID.test(owner) || owner !== userId) return null;
  return parseAuthContext(raw.slice(separator + 1));
}

/**
 * Pagina de login para quem chegou sem sessao. So rota profissional ganha a
 * intencao e o destino; as demais continuam em `/entrar` puro, como antes.
 */
export function loginPathFor(currentPath: string | null | undefined): string {
  const path = safeInternalPath(currentPath, "");
  if (isProfessionalPath(path)) {
    return `/entrar?${AUTH_CONTEXT_PARAM}=professional&next=${encodeURIComponent(path)}`;
  }
  return "/entrar";
}


export function mfaPathFor(destination: string, mfaPath: string): string {
  const path = safeInternalPath(destination, "");
  if (!isProfessionalPath(path)) return mfaPath;
  return `${mfaPath}?next=${encodeURIComponent(path)}`;
}

function isProfessionalPath(path: string) {
  return path === "/pro" || path.startsWith("/pro/") || path.startsWith("/pro?");
}
