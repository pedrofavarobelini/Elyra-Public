import type { CookieOptions } from "@supabase/ssr";

/**
 * Endurecimento dos cookies de sessao do Supabase.
 *
 * ## O que foi observado no staging fisico
 *
 * O cookie de sessao chegava ao Android assim:
 *
 * ```
 * sb-<ref>-auth-token   httpOnly=false  secure=false  sameSite=Lax  path=/
 * ```
 *
 * Identico em `localhost` HTTP e em HTTPS. A Elyra nao escolhia isso: ela
 * repassava, sem override, o `options` que o `@supabase/ssr` entrega em
 * `setAll`.
 *
 * ## Por que `httpOnly` e compativel aqui, e nem sempre e
 *
 * O `@supabase/ssr` deixa o cookie legivel por JavaScript porque, na
 * arquitetura padrao, existe um **cliente de navegador** que precisa ler a
 * sessao. Ligar `httpOnly` nesse desenho quebraria o login.
 *
 * Nesta base isso nao existe, e foi verificado antes de mudar qualquer coisa:
 *
 *  - `createBrowserClient` nao aparece em `src/`;
 *  - `document.cookie` nao aparece em `src/`;
 *  - todo `supabase.auth.*` vive em Server Action, rota de API, middleware ou
 *    `src/server/`;
 *  - a URL do Supabase esta em chunks de servidor, e em **zero** arquivos do
 *    bundle de cliente e **zero** vezes no HTML entregue.
 *
 * Quem le o cookie e sempre o servidor, e servidor le `httpOnly` normalmente.
 * Entao o token deixa de ser alcancavel por script na pagina sem que ninguem
 * perca acesso a ele.
 *
 * `ARCHITECTURE_ALLOWS != LIBRARY_DEFAULT`.
 *
 * ## Por que `secure` e condicional, e nao sempre `true`
 *
 * `Secure` faz o navegador recusar o cookie em HTTP. Ligado incondicionalmente,
 * o desenvolvimento em `http://localhost` para de autenticar — a sessao some a
 * cada request, e o sintoma parece bug de login.
 *
 * Entao ele segue o transporte: HTTPS liga, HTTP nao. A homologacao atras do
 * tunel e HTTPS e recebe `Secure`; `localhost` continua funcionando.
 */

/**
 * A requisicao chegou por HTTPS?
 *
 * `forwardedProto` vem de `x-forwarded-proto`, que e o que um tunel ou
 * balanceador coloca quando termina o TLS antes da aplicacao — sem ele, um
 * servidor atras de proxy acharia que todo trafego e HTTP e nunca marcaria
 * `Secure`.
 *
 * O primeiro valor da lista e o do cliente original: `x-forwarded-proto` pode
 * vir como `https, http` quando ha mais de um salto, e ler a lista inteira
 * compararia com uma string que nunca casa.
 */
export function isSecureRequest(input: {
  protocol?: string | null;
  forwardedProto?: string | null;
}): boolean {
  const forwarded = input.forwardedProto?.split(",")[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === "https";
  return input.protocol?.toLowerCase() === "https:";
}

/**
 * Aplica o endurecimento preservando tudo o mais.
 *
 * O espalhamento vem **antes** dos overrides de proposito: `maxAge`, `path`,
 * `sameSite`, `domain` e o que o `@supabase/ssr` mandar continuam valendo. Só
 * duas propriedades sao decididas aqui, e elas sao as duas que a auditoria
 * apontou.
 *
 * `path` e `sameSite` ganham default apenas quando a biblioteca nao mandou
 * nada: um cookie de sessao sem `path` fica preso ao diretorio da requisicao
 * que o criou, e `/entrar` criaria uma sessao que `/dashboard` nao enxerga.
 */
export function hardenAuthCookie(
  options: CookieOptions | undefined,
  secure: boolean,
): CookieOptions {
  return {
    ...options,
    httpOnly: true,
    secure,
    sameSite: options?.sameSite ?? "lax",
    path: options?.path ?? "/",
  };
}
