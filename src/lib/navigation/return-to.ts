import { safeInternalPath } from "@/lib/security/safe-redirect";

/**
 * "Voltar" que volta para onde a pessoa estava (L-398).
 *
 * Antes, Privacidade e Convite voltavam sempre para `/configuracoes`, mesmo
 * quando a pessoa tinha vindo do perfil de um profissional. Agora a origem viaja
 * em `?returnTo=` e e aceita so se:
 *
 * 1. passar em `safeInternalPath` (mesma origem; recusa `https://`, `//host`,
 *    `/\\host`, `javascript:`, caractere de controle, rota nao navegavel);
 * 2. comecar por um prefixo desta lista (area pessoal). Caminho codificado
 *    (`/%2F%2Fevil.com`) nao casa com nenhum prefixo e cai no padrao.
 *
 * Sem `returnTo` valido: o hub que o produto ja define para a tela.
 */
export const RETURN_TO_PARAM = "returnTo";

const RETURN_TARGETS: ReadonlyArray<{ prefix: string; label: string }> = [
  { prefix: "/profissionais/", label: "Voltar ao perfil do profissional" },
  { prefix: "/profissionais", label: "Voltar para Encontrar profissionais" },
  { prefix: "/agenda", label: "Voltar para Sessão com profissional" },
  { prefix: "/pedidos", label: "Voltar para Recados" },
  { prefix: "/notificacoes", label: "Voltar para Notificações" },
  { prefix: "/perfil", label: "Voltar para o Perfil" },
  { prefix: "/configuracoes", label: "Voltar para o hub de ajustes" },
  { prefix: "/convite", label: "Voltar para o convite" },
  { prefix: "/dashboard", label: "Voltar para o Dashboard" },
];

export interface ReturnTarget {
  href: string;
  label: string;
}

/** Destino seguro de retorno, ou `null` quando o valor nao serve. */
export function parseReturnTo(raw: string | string[] | null | undefined): ReturnTarget | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== "string" || value.length > 300) return null;
  const safe = safeInternalPath(value, "");
  if (safe === "") return null;
  const target = RETURN_TARGETS.find(({ prefix }) =>
    prefix.endsWith("/") ? safe.startsWith(prefix) && safe.length > prefix.length : safe === prefix || safe.startsWith(`${prefix}?`) || safe.startsWith(`${prefix}#`) || safe.startsWith(`${prefix}/`),
  );
  return target ? { href: safe, label: target.label } : null;
}

export function resolveReturnTo(raw: string | string[] | null | undefined, fallback: ReturnTarget): ReturnTarget {
  return parseReturnTo(raw) ?? fallback;
}

/** Monta `path?returnTo=origem` (com `#ancora` no fim, se houver). */
export function withReturnTo(path: string, origin: string): string {
  const [base, hash] = path.split("#", 2);
  const separator = base!.includes("?") ? "&" : "?";
  return `${base}${separator}${RETURN_TO_PARAM}=${encodeURIComponent(origin)}${hash ? `#${hash}` : ""}`;
}
