import "server-only";

/**
 * SUP-3 (ADR-0033) — pre-visualizacao editorial.
 *
 * Conteudo em REVIEW ainda nao foi revisado por uma pessoa: nunca aparece em
 * producao. So aparece, com faixa "em revisao, nao publicado", quando TODAS
 * as condicoes valem (mesmo desenho das fixtures de verificacao):
 * - `ELYRA_SUPPORT_CONTENT_PREVIEW=review` explicito;
 * - fora de producao, ou `ELYRA_RUNTIME_ENV=qa`;
 * - Supabase local (127.0.0.1/localhost).
 */
type Env = Record<string, string | undefined>;

function isLocal(url: string | undefined) {
  if (!url) return false;
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function supportContentPreviewEnabled(env: Env = process.env): boolean {
  return (
    env.ELYRA_SUPPORT_CONTENT_PREVIEW?.trim() === "review" &&
    (env.NODE_ENV !== "production" || env.ELYRA_RUNTIME_ENV === "qa") &&
    isLocal(env.NEXT_PUBLIC_SUPABASE_URL)
  );
}
