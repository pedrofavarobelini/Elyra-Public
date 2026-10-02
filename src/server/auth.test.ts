import { AuthError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Falha de transporte nao e ausencia de sessao.
 *
 * O `getUser()` do Supabase devolve `{ user: null, error }` nos dois casos, e
 * tratar os dois igual foi parte do defeito `FIRST_LOAD_FAILURE` relatado pelo
 * Human QA em iPhone: uma instabilidade de rede no primeiro carregamento
 * expulsava a pessoa para `/entrar`, afirmando na tela que a sessao tinha
 * acabado quando o cookie dela continuava valido.
 *
 * Estes testes fixam a fronteira: erro **retryable** (rede, timeout, 5xx)
 * levanta `AuthTransportError` e vai parar no error boundary; erro de
 * credencial continua significando "sem sessao".
 *
 * A cobertura exercita o erro **devolvido** em `{ data, error }`, que e como o
 * `supabase-js` reporta falha de rede no caminho real - ele resolve com erro em
 * vez de lancar. O `catch` de `getAuthenticatedUser` existe para o caso raro de
 * `fetch` abortado lancar direto, e usa exatamente a mesma classificacao.
 */

const getUser = vi.fn();
const getAuthenticatorAssuranceLevel = vi.fn();
const getAppLockSummary = vi.fn(async () => ({
  state: "DISABLED",
  lockId: null as string | null,
  failedAttempts: 0,
  cooldownUntil: null as string | null,
  unlockedUntil: null as string | null,
}));

vi.mock("@/server/app-lock", () => ({ getAppLockSummary }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser, mfa: { getAuthenticatorAssuranceLevel } } }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-elyra-path": "/diario" }),
}));

const { getAuthenticatedApiUser, getAuthenticatedUser, requireAuthenticatedUser, AuthTransportError } =
  await import("@/server/auth");

function authError(name: string, status?: number) {
  const error = new AuthError("falhou", status);
  error.name = name;
  return error;
}

const USER = { id: "u-1", email: "pessoa@elyra.invalid" };

/** Captura o erro lancado, para asserir o tipo sem depender de `.rejects`. */
async function capture(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return null;
}

describe("getAuthenticatedUser", () => {
  beforeEach(() => {
    getUser.mockReset();
    getAuthenticatorAssuranceLevel.mockReset();
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal1" },
      error: null,
    });
  });

  it("devolve a pessoa quando ha sessao valida", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    const auth = await getAuthenticatedUser();
    expect(auth?.user).toEqual(USER);
  });

  it("devolve null quando simplesmente nao ha sessao", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getAuthenticatedUser()).toBeNull();
  });

  it("trata credencial invalida como ausencia de sessao, nao como falha", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: authError("AuthApiError", 401),
    });
    expect(await getAuthenticatedUser()).toBeNull();
  });

  it("levanta AuthTransportError quando o fetch do SDK falha", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: authError("AuthRetryableFetchError"),
    });
    await expect(getAuthenticatedUser()).rejects.toBeInstanceOf(
      AuthTransportError,
    );
  });

  it("levanta AuthTransportError quando o Supabase responde 5xx", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: authError("AuthApiError", 503),
    });
    await expect(getAuthenticatedUser()).rejects.toBeInstanceOf(
      AuthTransportError,
    );
  });

  it("levanta AuthTransportError quando a chamada estoura o prazo", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: authError("TimeoutError"),
    });
    expect(await capture(getAuthenticatedUser)).toBeInstanceOf(
      AuthTransportError,
    );
  });

  it("levanta AuthTransportError quando a rede esta indisponivel", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: authError("TypeError"),
    });
    expect(await capture(getAuthenticatedUser)).toBeInstanceOf(
      AuthTransportError,
    );
  });

  it("erro do Auth SEM status nao e tratado como transporte", async () => {
    /*
     * A versao anterior classificava "sem status" como falha de transporte.
     * Isso e abrangente demais: varias subclasses de `AuthError` chegam sem
     * status por motivos que nao tem nada a ver com rede, e classifica-las
     * assim transforma erro de autorizacao em excecao - que vira 500 na rota.
     * O sinal explicito de rede ja e coberto por `name`.
     */
    getUser.mockResolvedValue({
      data: { user: null },
      error: authError("AuthApiError"),
    });
    expect(await capture(getAuthenticatedUser)).toBeNull();
  });

});


describe("repeticao unica em falha de transporte", () => {
  beforeEach(() => getUser.mockReset());

  it("recupera quando a segunda tentativa da certo", async () => {
    getUser
      .mockResolvedValueOnce({
        data: { user: null },
        error: authError("AuthRetryableFetchError", 0),
      })
      .mockResolvedValueOnce({ data: { user: USER }, error: null });

    const auth = await getAuthenticatedUser();

    expect(auth?.user).toEqual(USER);
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it("repete no maximo uma vez - nao e retry em laco", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: authError("AuthRetryableFetchError", 0),
    });

    expect(await capture(getAuthenticatedUser)).toBeInstanceOf(
      AuthTransportError,
    );
    // Indisponibilidade real continua falhando, e falha rapido.
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it("nao repete quando o erro nao e de transporte", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: authError("AuthApiError", 401),
    });

    expect(await getAuthenticatedUser()).toBeNull();
    // Credencial invalida nao melhora com repeticao.
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it("nao repete quando ha sessao valida", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    await getAuthenticatedUser();
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});

describe("requireAuthenticatedUser", () => {
  beforeEach(() => {
    getUser.mockReset();
    getAuthenticatorAssuranceLevel.mockReset();
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal1" },
      error: null,
    });
    getAppLockSummary.mockClear();
    getAppLockSummary.mockResolvedValue({
      state: "DISABLED",
      lockId: null,
      failedAttempts: 0,
      cooldownUntil: null,
      unlockedUntil: null,
    });
  });

  it("redireciona para /entrar quando nao ha sessao", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireAuthenticatedUser()).rejects.toThrow("REDIRECT:/entrar");
  });

  it("NAO redireciona quando a falha e de transporte - propaga para o boundary", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: authError("AuthRetryableFetchError"),
    });
    // O que importa aqui e nao ser um redirect: expulsar por falha de rede
    // afirmaria na tela que a sessao acabou.
    await expect(requireAuthenticatedUser()).rejects.toBeInstanceOf(
      AuthTransportError,
    );
  });

  it("bloqueia rota direta e preserva o destino interno", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    getAppLockSummary.mockResolvedValue({
      state: "LOCKED",
      lockId: "lock-1",
      failedAttempts: 0,
      cooldownUntil: null,
      unlockedUntil: null,
    });

    await expect(requireAuthenticatedUser()).rejects.toThrow(
      "REDIRECT:/bloqueio?next=%2Fdiario",
    );
  });

  it("permite somente a tela de desbloqueio consultar o estado bloqueado", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    getAppLockSummary.mockResolvedValue({
      state: "LOCKED",
      lockId: "lock-1",
      failedAttempts: 0,
      cooldownUntil: null,
      unlockedUntil: null,
    });

    const auth = await requireAuthenticatedUser({ allowLocked: true });
    expect(auth.user).toEqual(USER);
    expect(auth.appLock.state).toBe("LOCKED");
  });

  it("recusa API com 423 enquanto o App Lock esta fechado", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    getAppLockSummary.mockResolvedValue({
      state: "LOCKED",
      lockId: "lock-1",
      failedAttempts: 0,
      cooldownUntil: null,
      unlockedUntil: null,
    });

    const result = await getAuthenticatedApiUser();
    expect(result.auth).toBeNull();
    expect(result.denial?.status).toBe(423);
    await expect(result.denial?.json()).resolves.toMatchObject({ code: "APP_LOCK_REQUIRED" });
  });

  it("App Lock desbloqueado nao satisfaz MFA pendente", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal1", nextLevel: "aal2" },
      error: null,
    });
    getAppLockSummary.mockResolvedValue({
      state: "UNLOCKED",
      lockId: "lock-1",
      failedAttempts: 0,
      cooldownUntil: null,
      unlockedUntil: new Date(Date.now() + 60_000).toISOString(),
    });

    const result = await getAuthenticatedApiUser();

    expect(result.auth).toBeNull();
    expect(result.denial?.status).toBe(403);
    await expect(result.denial?.json()).resolves.toMatchObject({ code: "MFA_REQUIRED" });
    expect(getAppLockSummary).not.toHaveBeenCalled();
  });

  it("sessao AAL2 ainda exige desbloqueio do App Lock", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal2", nextLevel: "aal2" },
      error: null,
    });
    getAppLockSummary.mockResolvedValue({
      state: "LOCKED",
      lockId: "lock-1",
      failedAttempts: 0,
      cooldownUntil: null,
      unlockedUntil: null,
    });

    const result = await getAuthenticatedApiUser();

    expect(result.auth).toBeNull();
    expect(result.denial?.status).toBe(423);
    await expect(result.denial?.json()).resolves.toMatchObject({ code: "APP_LOCK_REQUIRED" });
  });

  it("AAL invalido falha fechado antes de consultar App Lock", async () => {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    getAuthenticatorAssuranceLevel.mockResolvedValue({
      data: { currentLevel: "aal3", nextLevel: "aal2" },
      error: null,
    });

    await expect(getAuthenticatedApiUser()).rejects.toThrow("mfa_verification_unavailable");
    expect(getAppLockSummary).not.toHaveBeenCalled();
  });
});
