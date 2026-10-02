import "server-only";

/**
 * Porta de entrada segura para XML enviado (Diploma Digital), ANTES de
 * qualquer parser. Recusa, sem interpretar:
 * - DOCTYPE / ENTITY / DTD externa (XXE, "billion laughs");
 * - instrucao de processamento que nao seja o prologo `<?xml ...?>`;
 * - arquivo acima do limite, profundidade ou numero de elementos excessivos;
 * - bytes que nao sao UTF-8 valido.
 *
 * Resultado e so um veredito de entrada. XML aceito aqui NAO e diploma valido:
 * estrutura (XSD) e assinatura (ICP-Brasil) sao verificacoes separadas.
 */
export const XML_LIMITS = { maxBytes: 2 * 1024 * 1024, maxDepth: 64, maxElements: 20_000 } as const;

export type XmlGuardResult =
  | { ok: true; elements: number; depth: number }
  | { ok: false; reason: "too_large" | "not_utf8" | "doctype_forbidden" | "entity_forbidden" | "processing_instruction" | "too_deep" | "too_many_elements" | "malformed" };

export function guardXml(bytes: Uint8Array, limits = XML_LIMITS): XmlGuardResult {
  if (bytes.byteLength > limits.maxBytes) return { ok: false, reason: "too_large" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "not_utf8" };
  }
  if (/<!DOCTYPE/i.test(text)) return { ok: false, reason: "doctype_forbidden" };
  if (/<!ENTITY/i.test(text)) return { ok: false, reason: "entity_forbidden" };
  const withoutProlog = text.replace(/^﻿?\s*<\?xml[^?]*\?>/, "");
  if (/<\?/.test(withoutProlog)) return { ok: false, reason: "processing_instruction" };

  // Varredura de tags sem parser: profundidade e contagem. Comentarios e CDATA
  // sao removidos antes para nao confundirem a contagem.
  const body = withoutProlog.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  let depth = 0;
  let maxDepth = 0;
  let elements = 0;
  for (const match of body.matchAll(/<(\/?)([A-Za-z_][\w.:-]*)[^>]*?(\/?)>/g)) {
    const [, closing, , selfClosing] = match;
    if (closing) {
      depth -= 1;
      if (depth < 0) return { ok: false, reason: "malformed" };
      continue;
    }
    elements += 1;
    if (elements > limits.maxElements) return { ok: false, reason: "too_many_elements" };
    if (!selfClosing) {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
      if (depth > limits.maxDepth) return { ok: false, reason: "too_deep" };
    }
  }
  if (depth !== 0 || elements === 0) return { ok: false, reason: "malformed" };
  return { ok: true, elements, depth: maxDepth };
}
