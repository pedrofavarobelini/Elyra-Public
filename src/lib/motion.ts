/**
 * Fonte unica de "reduzir movimento" (MOTION-1, MOTION-GAP-01 / L-412).
 *
 * Movimento fica reduzido quando QUALQUER uma das duas diz reduce:
 * - o sistema (`prefers-reduced-motion: reduce`);
 * - a preferencia interna da Elyra (`html[data-elyra-motion="reduce"]`,
 *   Personalizacao), que o CSS ja respeitava e o JS nao.
 *
 * Sem conflito: a preferencia interna so pode REDUZIR. "system" segue o
 * sistema; nao existe opcao que force animacao contra o sistema.
 *
 * Fora do navegador (servidor, teste sem DOM) responde `true`: o estado seguro
 * e sem animacao.
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
export const MOTION_ATTRIBUTE = "data-elyra-motion";

function root(): HTMLElement | null {
  return typeof document === "undefined" ? null : document.documentElement;
}

export function isReducedMotion(): boolean {
  const html = root();
  if (!html || typeof window === "undefined") return true;
  if (html.getAttribute(MOTION_ATTRIBUTE) === "reduce") return true;
  return typeof window.matchMedia === "function" && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** Avisa quando qualquer uma das duas fontes muda. */
export function subscribeReducedMotion(onChange: () => void): () => void {
  const html = root();
  if (!html || typeof window === "undefined") return () => undefined;
  const media = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED_MOTION_QUERY) : null;
  media?.addEventListener("change", onChange);
  const observer = typeof MutationObserver === "function" ? new MutationObserver(onChange) : null;
  observer?.observe(html, { attributes: true, attributeFilter: [MOTION_ATTRIBUTE] });
  return () => {
    media?.removeEventListener("change", onChange);
    observer?.disconnect();
  };
}
