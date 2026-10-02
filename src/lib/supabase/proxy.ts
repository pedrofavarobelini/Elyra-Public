import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  NO_STORE_HEADERS,
  STATIC_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  strictTransportSecurity,
} from "@/lib/security/headers";
import { traceMutation } from "@/lib/observability/mutation-trace";
import { REQUEST_PATH_HEADER } from "@/lib/security/request-path";
import { hardenAuthCookie, isSecureRequest } from "@/lib/supabase/cookie-hardening";
import type { Database } from "@/lib/supabase/database.types";

/** Header interno que carrega o nonce da CSP para o App Router. */
export const CSP_NONCE_HEADER = "x-elyra-nonce";

/**
 * Teto de espera do refresh de sessao no middleware.
 *
 * Vale para **toda** request, entao o numero e um orcamento de navegacao, nao
 * de tolerancia a rede: acima disso, degradar o refresh custa menos do que
 * degradar a pagina inteira.
 */
export const SESSION_REFRESH_TIMEOUT_MS = 3_000;

function createNonce(): string {
  return globalThis.crypto.randomUUID().replaceAll("-", "");
}


function applySecurityHeaders(
  response: NextResponse,
  request: NextRequest,
  policy: string,
): NextResponse {
  for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }

  response.headers.set("Content-Security-Policy", policy);

  const hsts = strictTransportSecurity(new URL(request.url).protocol);
  if (hsts) response.headers.set("Strict-Transport-Security", hsts);

  // Resposta de API carrega dado pessoal e nunca pode ficar em cache
  // compartilhado: um proxy intermediario serviria o perfil de uma pessoa
  // para outra.
  if (request.nextUrl.pathname.startsWith("/api/")) {
    for (const [name, value] of Object.entries(NO_STORE_HEADERS)) {
      response.headers.set(name, value);
    }
  }

  return response;
}

export async function updateSession(request: NextRequest) {
  /*
   * Fronteira de entrada do processo.
   *
   * Toda request atravessa este proxy antes de existir handler, entao e aqui
   * que se prova se a mutacao chegou ao servidor. Silencioso fora de QA e
   * silencioso em QA sem `x-elyra-trace-id` - ver `mutation-trace.ts`.
   */
  const route = request.nextUrl.pathname;
  const traceId = traceMutation("PROXY_RECEIVED", request, route);

  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    realtimeUrl: process.env.LIVEKIT_URL,
    development: process.env.NODE_ENV === "development",
  });

  /*
   * A CSP vai para a REQUEST, nao so para a resposta.
   *
   * O Next descobre o nonce lendo o header `Content-Security-Policy` da
   * request e so entao carimba `nonce=` nos proprios scripts inline — o flight
   * data do RSC entre eles. Sem isso, `script-src` com nonce bloqueia esses
   * scripts, a pagina nao hidrata e nenhum componente de cliente renderiza.
   *
   * Um header proprio nao serve: o Next procura este nome exato.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  requestHeaders.set(CSP_NONCE_HEADER, nonce);
  /*
    `set`, e nao `has`/`append`: substitui o que o navegador tiver mandado com
    esse nome. Sem isso, o cliente escolheria para onde o portao de
    consentimento o devolve depois do aceite.
  */
  requestHeaders.set(REQUEST_PATH_HEADER, request.nextUrl.pathname);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    traceMutation("PROXY_RETURNING", request, route, traceId);
    return applySecurityHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
      request,
      policy,
    );
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });
  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headersToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        response = NextResponse.next({ request: { headers: requestHeaders } });
        /*
          O `options` do `@supabase/ssr` passava direto por aqui, e com ele o
          cookie de sessao chegava ao aparelho com `httpOnly=false` e
          `secure=false`. O endurecimento vive em `cookie-hardening.ts`, com o
          motivo completo e o que foi verificado antes de liga-lo.

          `secure` segue o transporte **desta** request: o mesmo mecanismo que
          decide o HSTS logo abaixo, que ja se prova em runtime - ausente em
          `localhost`, presente atras do tunel.
        */
        const secure = isSecureRequest({
          protocol: new URL(request.url).protocol,
          forwardedProto: request.headers.get("x-forwarded-proto"),
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, hardenAuthCookie(options, secure)),
        );
        Object.entries(headersToSet).forEach(([name, value]) =>
          response.headers.set(name, value),
        );
      },
    },
  });

  /*
   * O refresh de sessao nao pode derrubar a request.
   *
   * `getClaims()` faz I/O de rede contra o Supabase. Sem contencao, um Supabase
   * lento ou indisponivel deixava **toda rota** pendurada ate o timeout do
   * navegador: sem pagina, sem erro, sem acao possivel - e o reload seguinte
   * "resolvia" porque a condicao transitoria ja tinha passado. Foi essa a classe
   * de defeito relatada pelo Human QA em iPhone (`FIRST_LOAD_FAILURE`).
   *
   * Falhar aqui e recuperavel por desenho: sem refresh, o cookie atual segue
   * valendo e quem decide o acesso continua sendo `requireAuthenticatedUser`,
   * que redireciona para `/entrar` quando nao ha sessao. O que nao pode
   * acontecer e a request inteira morrer por causa do refresh.
   *
   * O timeout e curto de proposito: middleware roda em **todas** as requests,
   * entao esperar mais que isso degrada a navegacao inteira em vez de degradar
   * so o refresh.
   */
  try {
    await Promise.race([
      supabase.auth.getClaims(),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("session_refresh_timeout")),
          SESSION_REFRESH_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch {
    // Sem conteudo da pessoa no log: apenas o fato, como manda a politica da V1.
    console.warn("elyra.session_refresh_unavailable");
  }

  traceMutation("PROXY_RETURNING", request, route, traceId);
  return applySecurityHeaders(response, request, policy);
}
