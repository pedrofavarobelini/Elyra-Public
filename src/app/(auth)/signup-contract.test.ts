import { AuthApiError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SIGNUP_PENDING_CONFIRMATION_MESSAGE,
  SIGNUP_UNAVAILABLE_MESSAGE,
  type AuthActionState,
} from "@/lib/contracts/auth";

/**
 * O contrato publico do cadastro.
 *
 * ## O defeito que estes testes travam
 *
 * A homologacao humana reportou "o fluxo apresentou problema" ao criar conta.
 * O log do GoTrue mostrou `user_repeated_signup`: a conta ja existia, criada
 * pela propria pessoa 11 h antes. O cadastro funcionava; a mensagem e que
 * escondia a unica informacao que resolveria — tente entrar em vez de criar.
 *
 * Tres estados distintos caiam na mesma frase:
 *
 * ```ts
 * if (error || !data.user || !data.session) {
 *   return { error: "Não foi possível criar a conta.", values };
 * }
 * ```
 *
 * ## A regra que nao pode ser afrouxada para melhorar a mensagem
 *
 * `/cadastro` nao pode virar ferramenta de enumeracao. A resposta que sai do
 * servidor nao diz, nem em texto nem em codigo, se um e-mail tem conta.
 */

const h = vi.hoisted(() => ({
  signUp: vi.fn(),
  signOut: vi.fn(),
  recordPendingConsent: vi.fn(),
  rateLimited: false,
  redirected: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signUp: h.signUp, signOut: h.signOut },
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.redirected = to;
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/lib/security/rate-limit", async (original) => ({
  ...(await original<object>()),
  consumeRateLimit: () => ({ allowed: !h.rateLimited }),
}));

vi.mock("@/server/repositories/identity-repository", () => ({
  appendConsentGrant: async () => ({ id: "consent-1" }),
  appendAudit: async () => undefined,
  recordPendingConsent: h.recordPendingConsent,
  materializePendingConsents: async () => 0,
}));

const { signupAction } = await import("./actions");

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("displayName", "Pessoa Teste");
  data.set("email", "alguem@elyra.invalid");
  data.set("password", "SenhaBoa123");
  data.set("acceptedTerms", "on");
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

async function executar(data: FormData): Promise<AuthActionState> {
  try {
    return await signupAction({ status: "idle" }, data);
  } catch (error) {
    if ((error as Error).message === "NEXT_REDIRECT") {
      return { status: "idle" };
    }
    throw error;
  }
}

/** Tudo que a resposta publica nao pode conter, em nenhuma forma. */
const VAZAMENTOS = [
  "user_already_exists",
  "email_exists",
  "already registered",
  "já está cadastrado",
  "ja esta cadastrado",
  "já existe",
  "ja existe",
  "account exists",
  "usuário já",
  "conta encontrada",
];

function semVazamento(state: AuthActionState) {
  const serialized = JSON.stringify(state).toLowerCase();
  for (const termo of VAZAMENTOS) {
    expect(serialized, `vazou "${termo}"`).not.toContain(termo.toLowerCase());
  }
}

beforeEach(() => {
  h.signUp.mockReset();
  h.signOut.mockReset();
  h.recordPendingConsent.mockReset();
  h.recordPendingConsent.mockResolvedValue(true);
  h.rateLimited = false;
  h.redirected = null;
});

describe("cadastro repetido", () => {
  /*
    O erro e construido com a classe real do `@supabase/supabase-js`, e o codigo
    e o observado em runtime nesta instalacao: GoTrue devolve
    `user_already_exists` com status 422. Nao e um literal inventado a partir da
    documentacao.
  */
  const contaExistente = new AuthApiError(
    "User already registered",
    422,
    "user_already_exists",
  );

  it("nao redireciona para o dashboard", async () => {
    h.signUp.mockResolvedValue({ data: { user: null, session: null }, error: contaExistente });
    const state = await executar(form());
    expect(h.redirected).toBeNull();
    expect(state.status).toBe("error");
  });

  it("nao revela que a conta existe, nem em texto nem em codigo", async () => {
    h.signUp.mockResolvedValue({ data: { user: null, session: null }, error: contaExistente });
    const state = await executar(form());
    semVazamento(state);
    expect(state).toMatchObject({ status: "error", message: SIGNUP_UNAVAILABLE_MESSAGE });
  });

  it("oferece o caminho de entrar", async () => {
    h.signUp.mockResolvedValue({ data: { user: null, session: null }, error: contaExistente });
    const state = await executar(form());
    expect(state.status === "error" && state.offerSignIn).toBe(true);
    expect(state.status === "error" && state.message).toContain("entre");
  });

  it("responde igual a um erro desconhecido — e e isso que impede a enumeracao", async () => {
    /*
      O ponto central. Se a resposta para "conta existente" fosse distinguivel
      da resposta para qualquer outra falha, inspecionar o retorno da Server
      Action responderia "este e-mail tem conta?" — que e enumeracao com outro
      nome.
    */
    h.signUp.mockResolvedValue({ data: { user: null, session: null }, error: contaExistente });
    const existente = await executar(form());

    h.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError("Service temporarily unavailable", 503, "unexpected_failure"),
    });
    const desconhecido = await executar(form());

    expect(JSON.stringify(existente)).toBe(JSON.stringify(desconhecido));
  });
});

describe("erro generico do Supabase", () => {
  it("nao devolve mensagem interna, stack nem detalhe sensivel", async () => {
    h.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError(
        "database connection failed at pg://user:senha@10.0.0.4:5432/postgres",
        500,
        "unexpected_failure",
      ),
    });
    const state = await executar(form());
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("pg://");
    expect(serialized).not.toContain("10.0.0.4");
    expect(serialized).not.toContain("database connection failed");
    expect(serialized).not.toContain("unexpected_failure");
    expect(state).toMatchObject({ status: "error", message: SIGNUP_UNAVAILABLE_MESSAGE });
  });

  it("senha fraca continua com mensagem propria — e sobre o que a pessoa digitou", async () => {
    /*
      Especifica de proposito. Ela nao diz nada sobre quem ja tem conta, e
      esconde-la trocaria um defeito de privacidade por um de usabilidade:
      a pessoa ficaria sem saber o que corrigir.
    */
    h.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthWeakPasswordError("A senha precisa de um número.", 422, ["characters"]),
    });
    const state = await executar(form());
    expect(state).toMatchObject({ status: "error" });
    expect(state.status === "error" && state.message).toContain("número");
    /*
      E aqui nao se convida a entrar: o problema e a senha. Isso nao abre
      enumeracao - quem sonda um e-mail usa senha forte e nunca ve este ramo.
    */
    expect(state.status === "error" && state.offerSignIn).toBe(false);
    semVazamento(state);
  });
});

describe("sucesso normal", () => {
  it("user + session mantem o redirect para o dashboard", async () => {
    h.signUp.mockResolvedValue({
      data: { user: { id: "u-1" }, session: { access_token: "x" } },
      error: null,
    });
    await executar(form());
    expect(h.redirected).toBe("/dashboard");
  });
});

describe("confirmacao futura", () => {
  it("user sem session vira `pending_confirmation`, e nao erro", async () => {
    /*
      Hoje nao roda: `MAILER_AUTOCONFIRM=true`. Existe porque ligar a
      confirmacao faria toda conta criada com sucesso ser anunciada como falha,
      com o usuario ja existindo no banco — e o defeito so apareceria depois da
      mudanca de configuracao, em producao.
    */
    h.signUp.mockResolvedValue({
      data: { user: { id: "u-2" }, session: null },
      error: null,
    });
    const state = await executar(form());
    expect(state).toEqual({
      status: "pending_confirmation",
      message: SIGNUP_PENDING_CONFIRMATION_MESSAGE,
    });
    expect(h.redirected).toBeNull();
  });

  it("nesse estado nao grava consentimento nem devolve o formulario", async () => {
    // Sem sessao, a escrita cairia na RLS. O consentimento pertence ao
    // primeiro acesso autenticado.
    h.signUp.mockResolvedValue({
      data: { user: { id: "u-3" }, session: null },
      error: null,
    });
    const state = await executar(form());
    expect(state).not.toHaveProperty("values");
    expect(state).not.toHaveProperty("offerSignIn");
  });

  it("mas registra a INTENCAO, para que o aceite nao se perca", async () => {
    /*
      A lacuna que ligar `enable_confirmations` abriria: conta criada e nenhuma
      prova de consentimento. O aceite nao pode virar evento agora — sem sessao
      a RLS recusa —, entao vira intencao, guardada pelo banco atras de guardas
      que o cliente nao alcanca.
    */
    h.signUp.mockResolvedValue({
      data: { user: { id: "u-4" }, session: null },
      error: null,
    });
    await executar(form());

    expect(h.recordPendingConsent).toHaveBeenCalledTimes(1);
    expect(h.recordPendingConsent.mock.calls[0]?.[1]).toEqual({
      userId: "u-4",
      purpose: "terms_privacy",
      documentVersion: "v1",
    });
  });

  it("falhar ao registrar a intencao nao derruba o cadastro", async () => {
    // A conta existe e a pessoa precisa poder confirmar o e-mail. A tela nao
    // mente: ela diz apenas que a conta foi criada.
    h.signUp.mockResolvedValue({
      data: { user: { id: "u-5" }, session: null },
      error: null,
    });
    h.recordPendingConsent.mockRejectedValue(new Error("indisponivel"));

    const state = await executar(form());
    expect(state).toMatchObject({ status: "pending_confirmation" });
  });
});

describe("sem aceite, nada e registrado", () => {
  it("o contrato barra antes de criar conta ou intencao", async () => {
    /*
      Nenhum caminho pode produzir pendencia ou evento sem aceite explicito. A
      barreira e o proprio schema — `z.literal(true)` —, entao ela age antes de
      qualquer ida ao servidor.
    */
    const data = form();
    data.delete("acceptedTerms");
    const state = await executar(data);

    expect(h.signUp).not.toHaveBeenCalled();
    expect(h.recordPendingConsent).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
  });
});

describe("a senha nunca volta ao cliente", () => {
  it("nenhum desfecho carrega a senha digitada", async () => {
    const senha = "SenhaSuperSecreta123";
    for (const resultado of [
      { data: { user: null, session: null }, error: new AuthApiError("x", 422, "user_already_exists") },
      { data: { user: { id: "u" }, session: null }, error: null },
    ]) {
      h.signUp.mockResolvedValue(resultado);
      const state = await executar(form({ password: senha }));
      expect(JSON.stringify(state)).not.toContain(senha);
    }
  });
});
