import { redirect } from "next/navigation";

import { safeInternalPath } from "@/lib/security/safe-redirect";

/**
 * Redireciona para um destino interno **depois** de valida-lo.
 *
 * ## Por que o cast mora aqui
 *
 * `typedRoutes` so aceita rota estatica conhecida, e um destino calculado —
 * `next` vindo de query, um caminho com `?next=` embutido — nunca sera uma
 * delas. A regra do `typedRoutes` e boa e nao vai ser desligada; o que ela nao
 * sabe e que este caminho ja passou por `safeInternalPath`.
 *
 * Entao o cast existe **uma vez**, colado no unico validador que o justifica.
 * A alternativa que estava em curso — um cast em `server/auth.ts`, outro em cada
 * Server Action que redireciona — espalharia por varios arquivos uma excecao que
 * depende de uma garantia feita em um so. Quando a excecao viaja e a garantia
 * nao, alguem eventualmente casta um valor que ninguem validou.
 *
 * Entrada externa, malformada ou ausente nao lanca: vira o `fallback`, porque
 * derrubar uma navegacao que ja deu certo por causa de um parametro que a pessoa
 * nem escolheu seria trocar um problema por outro.
 */
export function redirectToInternalPath(
  raw: string | null | undefined,
  fallback?: string,
): never {
  const destino = safeInternalPath(raw, fallback);
  redirect(destino as unknown as Parameters<typeof redirect>[0]);
}
