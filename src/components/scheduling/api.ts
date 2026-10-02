"use client";

/**
 * Chamadas da agenda a partir da tela. Falha de rede e falha de regra sao
 * mensagens diferentes (rede: tente de novo; regra: o banco recusou e disse
 * por que). Nenhuma repeticao automatica.
 */
export const SCHEDULING_OFFLINE_MESSAGE =
  "Sem conexão. A agenda só funciona online: nada foi enviado.";

export async function schedulingFetch<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      cache: "no-store",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error(SCHEDULING_OFFLINE_MESSAGE);
  }
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "A agenda não respondeu. Tente de novo.");
  return payload.data as T;
}
