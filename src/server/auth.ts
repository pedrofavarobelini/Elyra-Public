import "server-only";

import { AuthError } from "@supabase/supabase-js";
import { headers } from "next/headers";

import {
  FIRST_ACCESS_PATH,
  TERMS_CONSENT_REQUIRED_CODE,
  TERMS_CONSENT_REQUIRED_MESSAGE,
} from "@/lib/contracts/consent";
import { redirectToInternalPath } from "@/lib/security/internal-redirect";
import { REQUEST_PATH_HEADER } from "@/lib/security/request-path";
import { safeInternalPath } from "@/lib/security/safe-redirect";
import { loginPathFor, mfaPathFor } from "@/lib/contracts/auth-context";
import { createClient } from "@/lib/supabase/server";
import {
  MFA_REQUIRED_CODE,
  MFA_REQUIRED_MESSAGE,
  MFA_VERIFICATION_PATH,
  mfaStatus,
} from "@/server/auth-mfa";
import { APP_LOCK_STATE, type AppLockSummary } from "@/lib/app-lock/contracts";
import { getAppLockSummary } from "@/server/app-lock";
import { hasActiveTermsConsent } from "@/server/services/consent-service";

/**
 * Erro de transporte ao falar com o Supabase Auth.
 *
 * Existe para manter separados dois estados que o `getUser()` devolve do mesmo
 * jeito - `{ user: null, error }` - e que significam coisas opostas:
 *
 * - **nao ha sessao**: a pessoa nao esta autenticada. O destino correto e
 *   `/entrar`.
 * - **nao foi possivel verificar a sessao**: a rede ou o Supabase falhou. A
 *   pessoa continua autenticada, o cookie dela continua valido, e manda-la para
 *   `/entrar` afirma na tela algo que nao aconteceu - que a sessao acabou.
 *
 * Confundir os dois foi parte do defeito `FIRST_LOAD_FAILURE` relatado pelo
 * Human QA em iPhone: uma instabilidade de rede no primeiro carregamento
 * expulsava para o login em vez de dizer que a conexao falhou.
 */
export class AuthTransportError extends Error {
  constructor(readonly reason: string) {
    super("auth_transport_unavailable");
    this.name = "AuthTransportError";
  }
}


function registrarFalhaDeTransporte(reason: string) {
  console.warn("elyra.auth_transport_unavailable", reason);
}

/**
 * Distingue falha de transporte de ausencia de sessao.
 *
 * O `supabase-js` marca como **retryable** justamente o que nao e decisao de
 * autorizacao: falha de fetch, timeout, indisponibilidade. Erro de credencial
 * ou token invalido nao e retryable e continua significando "sem sessao".
 */
export function isTransportFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  /*
   * A classificacao e por `name`, nao por `instanceof`.
   *
   * `instanceof` compara identidade de construtor, e um erro que atravessa
   * realms - jsdom nos testes, runtime de middleware em producao - carrega o
   * construtor do realm onde nasceu. O `name` sobrevive a travessia; o
   * prototipo nao.
   */
  const { name, status } = error as { name?: string; status?: unknown };

  // Rede indisponivel, fetch abortado, prazo estourado.
  if (
    name === "AuthRetryableFetchError" ||
    name === "TimeoutError" ||
    name === "AbortError" ||
    name === "TypeError"
  ) {
    return true;
  }

  /*
   * 5xx do Supabase Auth e transporte: o servidor caiu no meio, e a pessoa
   * continua autenticada.
   *
   * `status` ausente **nao** entra aqui, e a exclusao e deliberada. A versao
   * anterior tratava "sem status" como transporte, o que e abrangente demais:
   * varias subclasses de `AuthError` chegam sem status por motivos que nao tem
   * nada a ver com rede, e classifica-las como falha transitoria transforma
   * erro de autorizacao em `AuthTransportError` - que sobe como excecao e vira
   * 500 na rota. O sinal explicito de rede ja e coberto acima, por `name`.
   */
  if (error instanceof AuthError || name === "AuthApiError") {
    return typeof status === "number" && status >= 500;
  }

  return false;
}

/**
 * Espera curta entre a tentativa que falhou por transporte e a unica repeticao.
 *
 * Existe para dar tempo de a conexao ser refeita, e nao para "esperar passar":
 * qualquer valor maior transformaria uma falha de rede em latencia visivel em
 * toda navegacao.
 */
const TRANSPORT_RETRY_DELAY_MS = 120;


async function getUserComRetry(supabase: Awaited<ReturnType<typeof createClient>>) {
  for (let tentativa = 0; tentativa < 2; tentativa += 1) {
    try {
      const result = await supabase.auth.getUser();
      const { error } = result;
      if (!error || !isTransportFailure(error)) return result;

      if (tentativa === 0) {
        registrarFalhaDeTransporte(`retry:${error.name}:${error.status ?? "-"}`);
        await new Promise((r) => setTimeout(r, TRANSPORT_RETRY_DELAY_MS));
        continue;
      }
      return result;
    } catch (error) {
      if (!isTransportFailure(error)) throw error;
      if (tentativa === 0) {
        const nome = (error as { name?: string })?.name ?? "throw";
        registrarFalhaDeTransporte(`retry:${nome}`);
        await new Promise((r) => setTimeout(r, TRANSPORT_RETRY_DELAY_MS));
        continue;
      }
      throw error;
    }
  }
  // Inalcancavel: o laco retorna ou lanca nas duas tentativas.
  throw new AuthTransportError("exhausted");
}

export async function getAuthenticatedUser() {
  const supabase = await createClient();

  let result;
  try {
    result = await getUserComRetry(supabase);
  } catch (error) {
    // O SDK pode lancar em vez de devolver quando o fetch e abortado.
    if (isTransportFailure(error)) {
      const reason = (error as { name?: string })?.name ?? "throw";
      registrarFalhaDeTransporte(reason);
      throw new AuthTransportError(reason);
    }
    return null;
  }

  const {
    data: { user },
    error,
  } = result;

  if (error && isTransportFailure(error)) {
    const reason = `${error.name}:${error.status ?? "-"}`;
    registrarFalhaDeTransporte(reason);
    throw new AuthTransportError(reason);
  }
  if (error || !user) return null;
  return { supabase, user } as const;
}

export async function requireAuthenticatedUser(options: { allowLocked?: boolean } = {}) {
  const auth = await getAuthenticatedUser();

  // entrada profissional e com o destino; o resto continua em `/entrar`.
  if (!auth) redirectToInternalPath(loginPathFor(await currentInternalPath()));

  if ((await mfaStatus(auth.supabase)) === "pending") {
    redirectToInternalPath(mfaPathFor(await currentInternalPath(), MFA_VERIFICATION_PATH));
  }
  const appLock = await getAppLockSummary(auth.supabase, auth.user.id);
  if (!options.allowLocked && appLock.state !== APP_LOCK_STATE.DISABLED && appLock.state !== APP_LOCK_STATE.UNLOCKED) {
    const next = await currentInternalPath();
    redirectToInternalPath(`/bloqueio?next=${encodeURIComponent(next)}`);
  }
  return { ...auth, appLock } as const;
}

export type AuthenticatedContext = NonNullable<
  Awaited<ReturnType<typeof getAuthenticatedUser>>
>;

export type UnlockedAuthenticatedContext = AuthenticatedContext & {
  appLock: AppLockSummary;
};

/**
 * Destino do portao de consentimento.
 *
 * O cast do `typedRoutes` nao vive aqui: ele mora em `redirectToInternalPath`,
 * colado ao validador que o justifica. Espalhar a excecao por cada arquivo que
 * redireciona separaria o cast da garantia que o torna seguro.
 */
function redirectToFirstAccess(next: string): never {
  redirectToInternalPath(`${FIRST_ACCESS_PATH}?next=${encodeURIComponent(next)}`);
}

/**
 * O caminho da requisicao atual, como o proxy o escreveu.
 *
 * Vem do header interno que o middleware **sobrescreve** a cada request, e
 * passa por `safeInternalPath` mesmo assim: se o header faltar — rota que nao
 * atravessou o proxy, teste, runtime futuro —, o destino cai no padrao em vez
 * de virar `undefined` numa URL.
 */
async function currentInternalPath(): Promise<string> {
  const requestHeaders = await headers();
  return safeInternalPath(requestHeaders.get(REQUEST_PATH_HEADER));
}


export async function requireConsentedUser() {
  const auth = await requireAuthenticatedUser();
  if (await hasActiveTermsConsent(auth.supabase)) return auth;
  redirectToFirstAccess(await currentInternalPath());
}

/**
 * O portao das rotas de API.
 *
 * Devolve `denial` pronto em vez de lancar, para que cada rota continue com o
 * mesmo formato de duas linhas que ja usa. **Nao** altera
 * `getAuthenticatedUser`: fluxos que precisam funcionar antes do aceite — o
 * proprio consentimento, exclusao de conta — continuam usando o funil simples.
 *
 * `403`, e nao `401`: a pessoa **esta** autenticada. Responder 401 mandaria o
 * cliente tentar autenticar de novo para resolver algo que login nenhum
 * resolve.
 */
export async function getConsentedApiUser(): Promise<
  { auth: UnlockedAuthenticatedContext; denial: null } | { auth: null; denial: Response }
> {
  const unlocked = await getAuthenticatedApiUser();
  if (unlocked.denial) return unlocked;
  const { auth } = unlocked;

  if (await hasActiveTermsConsent(auth.supabase)) return { auth, denial: null };

  return {
    auth: null,
    denial: Response.json(
      {
        error: TERMS_CONSENT_REQUIRED_MESSAGE,
        code: TERMS_CONSENT_REQUIRED_CODE,
      },
      { status: 403 },
    ),
  };
}

/** Sessão, AAL e App Lock para APIs que funcionam antes do consentimento. */
export async function getAuthenticatedApiUser(): Promise<
  { auth: UnlockedAuthenticatedContext; denial: null } | { auth: null; denial: Response }
> {
  const auth = await getAuthenticatedUser();
  if (!auth) {
    return {
      auth: null,
      denial: Response.json({ error: "Não autenticado." }, { status: 401 }),
    };
  }

  if ((await mfaStatus(auth.supabase)) === "pending") {
    return {
      auth: null,
      denial: Response.json(
        { error: MFA_REQUIRED_MESSAGE, code: MFA_REQUIRED_CODE },
        { status: 403 },
      ),
    };
  }

  const appLock = await getAppLockSummary(auth.supabase, auth.user.id);
  if (appLock.state !== APP_LOCK_STATE.DISABLED && appLock.state !== APP_LOCK_STATE.UNLOCKED) {
    return {
      auth: null,
      denial: Response.json(
        {
          error: "Desbloqueie a Elyra para continuar.",
          code: "APP_LOCK_REQUIRED",
        },
        { status: 423 },
      ),
    };
  }

  return { auth: { ...auth, appLock }, denial: null };
}
