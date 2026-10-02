import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

import type { Database } from "@/lib/supabase/database.types";
import { hardenAuthCookie, isSecureRequest } from "@/lib/supabase/cookie-hardening";
import { getSupabaseServerEnv } from "@/lib/supabase/env";


export const SUPABASE_REQUEST_TIMEOUT_MS = 8_000;

/**
 * Espera curta entre a conexao que caiu e a unica repeticao.
 *
 * Curta de proposito: o objetivo e dar tempo de abrir uma conexao nova, nao
 * esperar um servico voltar. Valor maior transformaria queda de conexao em
 * latencia visivel em toda navegacao.
 */
const CONNECTION_RETRY_DELAY_MS = 120;

/**
 * A partir de quanto uma chamada ao Supabase deixa rastro por ser lenta.
 *
 * Existe para responder uma pergunta que o timeout sozinho nao responde: o
 * prazo de 8 s foi atingido porque a requisicao **estolou**, ou porque a
 * latencia normal ja vinha subindo e encostou no teto?
 *
 * As duas produzem o mesmo erro e pedem correcoes opostas - uma e defeito de
 * infraestrutura, a outra e orcamento mal dimensionado. Sem a distribuicao no
 * meio, so se ve o estouro.
 *
 * O limiar fica bem acima da operacao mais lenta ja medida (409 ms) para que
 * execucao saudavel nao gere ruido: em regime normal este log nao aparece.
 */
const SLOW_REQUEST_LOG_MS = 2_000;

/**
 * A falha e da **conexao**, e nao uma resposta do servidor?
 *
 * Reposta HTTP - inclusive 500 - nao entra aqui: o servidor respondeu, e
 * repetir uma escrita que talvez tenha sido aplicada e como se duplica dado.
 * Só entra o caso em que o `fetch` **nao completou**: conexao recusada,
 * derrubada ou resetada.
 */
function isConnectionFailure(error: unknown): boolean {
  if (error instanceof DOMException) return false; // timeout/abort deliberado
  if (!(error instanceof Error)) return false;
  const causa = (error as { cause?: { code?: string } }).cause;
  return (
    error.name === "TypeError" ||
    causa?.code === "ECONNRESET" ||
    causa?.code === "ECONNREFUSED" ||
    causa?.code === "EPIPE" ||
    causa?.code === "UND_ERR_SOCKET"
  );
}


const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const repetivel = IDEMPOTENT_METHODS.has(method);

  const tentar = async () => {
    const timeout = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    const inicio = performance.now();
    try {
      return await fetch(input, { ...init, signal });
    } finally {
      const decorrido = Math.round(performance.now() - inicio);
      if (decorrido >= SLOW_REQUEST_LOG_MS) {
        // Apenas o caminho: `search` carrega filtros com id e valor de pessoa.
        let caminho = "<desconhecido>";
        try {
          caminho = new URL(String(input instanceof Request ? input.url : input))
            .pathname;
        } catch {
          // URL relativa ou malformada nao deve derrubar a requisicao.
        }
        console.warn("elyra.supabase_slow_request", {
          method,
          caminho,
          ms: decorrido,
          estourou: decorrido >= SUPABASE_REQUEST_TIMEOUT_MS,
        });
      }
    }
  };

  return tentar().catch(async (error: unknown) => {
    if (!repetivel || !isConnectionFailure(error)) throw error;
    // Sem conteudo da pessoa no log: apenas o fato e o metodo.
    console.warn("elyra.supabase_connection_retry", method);
    await new Promise((r) => setTimeout(r, CONNECTION_RETRY_DELAY_MS));
    return tentar();
  });
}

/**
 * Protocolo da origem da requisicao, quando o navegador a informa.
 *
 * Usado so como segunda pista, depois de `x-forwarded-proto`. Uma origem
 * malformada devolve `null` em vez de lancar: descobrir o transporte e uma
 * otimizacao de seguranca, e nao pode derrubar a criacao do cliente.
 */
function protocolFromOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    return new URL(origin).protocol;
  } catch {
    return null;
  }
}

export async function createClient() {
  const cookieStore = await cookies();
  const env = getSupabaseServerEnv();

  /*
    O endurecimento precisa acontecer **aqui tambem**, e nao so no proxy.

    Quem grava o cookie no login e este caminho: a Server Action de `/entrar`
    chama `signInWithPassword`, e o `setAll` que responde e o de baixo. Endurecer
    apenas o middleware deixaria justamente a sessao recem-criada sem protecao -
    e a diferenca so apareceria num navegador de verdade, depois de um login de
    verdade.

    Sem objeto de request por perto, o transporte vem de `x-forwarded-proto`, que
    e o que o tunel escreve ao terminar o TLS.
  */
  const requestHeaders = await headers();
  const secure = isSecureRequest({
    forwardedProto: requestHeaders.get("x-forwarded-proto"),
    /*
      Segunda pista, para quando nao ha proxy escrevendo o header: a Server
      Action chega por POST e o navegador manda `origin`. Sem nenhuma das duas,
      a resposta e `false` - falhar para o lado que NAO marca `Secure` mantem o
      desenvolvimento em `http://localhost` funcionando, enquanto o contrario
      derrubaria o login local com um sintoma que parece bug de sessao.
    */
    protocol: protocolFromOrigin(requestHeaders.get("origin")),
  });

  return createServerClient<Database>(env.url, env.publishableKey, {
    global: { fetch: fetchWithTimeout },
    auth: {
      // ADR-0017: habilita apenas a API server-side. A cerimonia WebAuthn roda
      // num helper de navegador sem cliente Supabase nem acesso ao cookie.
      experimental: { passkey: true },
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, hardenAuthCookie(options, secure)),
          );
        } catch {
          // Server Components nao podem escrever cookies. O Proxy faz o refresh.
        }
      },
    },
  });
}
