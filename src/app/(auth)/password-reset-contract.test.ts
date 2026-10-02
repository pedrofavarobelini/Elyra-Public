import { AuthApiError, AuthWeakPasswordError } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PASSWORD_RESET_LINK_INVALID_MESSAGE,
  PASSWORD_RESET_SUCCESS_MESSAGE,
  type ResetActionState,
} from "@/lib/contracts/auth";

/**
 * O contrato publico da redefinicao de senha.
 *
 * ## O que sustenta a seguranca aqui
 *
 * A action **nao recebe token**. Ela depende da sessao de recuperacao que o
 * Supabase estabelece quando o link do e-mail e valido. Link expirado, ja usado
 * ou forjado tem o mesmo sintoma — nao ha sessao — e a mesma resposta, porque o
 * proximo passo tambem e o mesmo: pedir outro link.
 *
 * Se os tres fossem distinguiveis, quem tem um link saberia o que aconteceu com
 * ele; e um teste que aceitasse mensagens diferentes deixaria essa porta aberta.
 */

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  consumeRateLimit: vi.fn(),
  scopesUsados: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: h.getUser,
      updateUser: h.updateUser,
      signOut: h.signOut,
    },
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
/*
  O limitador nao e desligado: ele e **observado**.

  Substitui-lo por um `() => ({ allowed: true })` mudo faria o teste passar sem
  saber qual balde a action consome — e o ponto do 23-E e exatamente que a
  redefinicao tenha balde proprio. O espiao registra o escopo e ainda permite
  simular o limite excedido.
*/
vi.mock("@/lib/security/rate-limit", async (original) => ({
  ...(await original<object>()),
  consumeRateLimit: (scope: string, identity: string) => {
    h.scopesUsados.push(scope);
    return h.consumeRateLimit(scope, identity);
  },
}));

const { resetPasswordAction } = await import("./actions");

const SENHA = "SenhaNova123";

function form(password = SENHA, confirmation = password): FormData {
  const data = new FormData();
  data.set("password", password);
  data.set("confirmation", confirmation);
  return data;
}

function executar(data: FormData = form()): Promise<ResetActionState> {
  return resetPasswordAction({ status: "idle" }, data);
}

/** Sessao de recuperacao valida. */
function comSessao() {
  h.getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
}

beforeEach(() => {
  h.getUser.mockReset();
  h.updateUser.mockReset();
  h.updateUser.mockResolvedValue({ data: {}, error: null });
  h.signOut.mockReset();
  h.signOut.mockResolvedValue({ error: null });
  h.consumeRateLimit.mockReset();
  h.consumeRateLimit.mockReturnValue({ allowed: true });
  h.scopesUsados = [];
  comSessao();
});

describe("balde proprio de redefinicao", () => {
  it("consome `passwordReset`, e nao o balde da recuperacao", async () => {
    /*
      Custos diferentes exigem contadores diferentes. Pedir recuperacao dispara
      e-mail para a caixa de **outra pessoa**; redefinir tenta trocar uma
      credencial. Se dividissem o balde, o teto que protege a caixa de terceiro
      trancaria quem legitimamente erra a nova senha duas vezes.
    */
    await executar();

    expect(h.scopesUsados).toContain("passwordReset");
    expect(h.scopesUsados).not.toContain("passwordRecovery");
    expect(h.scopesUsados).not.toContain("auth");
  });

  it("limite excedido nao chega ao Supabase", async () => {
    // O limite existe para conter tentativa, entao ele precisa agir **antes** de
    // qualquer ida ao provedor de identidade.
    h.consumeRateLimit.mockReturnValue({ allowed: false });
    const state = await executar();

    expect(h.getUser).not.toHaveBeenCalled();
    expect(h.updateUser).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
  });

  it("o limite age antes mesmo de validar a senha digitada", async () => {
    /*
      Ordem importa: validar primeiro faria o endpoint responder "senha fraca"
      para quem esta em flood, confirmando que ha alguem ouvindo e gastando
      trabalho de validacao a cada tentativa.
    */
    h.consumeRateLimit.mockReturnValue({ allowed: false });
    const state = await executar(form("curta1"));

    expect(state.status).toBe("error");
    expect(state.status === "error" && state.message).not.toContain("caracteres");
  });
});

describe("link invalido, expirado ou ja usado", () => {
  it("sem sessao de recuperacao, nao tenta alterar senha nenhuma", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const state = await executar();

    expect(h.updateUser).not.toHaveBeenCalled();
    expect(state).toEqual({
      status: "error",
      message: PASSWORD_RESET_LINK_INVALID_MESSAGE,
    });
  });

  it("erro desconhecido do provedor cai na mesma frase, sem detalhe interno", async () => {
    h.updateUser.mockResolvedValue({
      data: {},
      error: new AuthApiError(
        "jwt expired: token issued at 2026-09-11T10:00:00Z for user u-1",
        401,
        "bad_jwt",
      ),
    });
    const state = await executar();
    const serialized = JSON.stringify(state);

    expect(state).toEqual({
      status: "error",
      message: PASSWORD_RESET_LINK_INVALID_MESSAGE,
    });
    expect(serialized).not.toContain("jwt");
    expect(serialized).not.toContain("u-1");
    expect(serialized).not.toContain("bad_jwt");
  });

  it("sessao ausente e token recusado respondem identico", async () => {
    // A prova de que os estados nao sao distinguiveis por quem esta na tela.
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const semSessao = await executar();

    comSessao();
    h.updateUser.mockResolvedValue({
      data: {},
      error: new AuthApiError("Token has expired", 401, "otp_expired"),
    });
    const tokenExpirado = await executar();

    expect(JSON.stringify(semSessao)).toBe(JSON.stringify(tokenExpirado));
  });
});

describe("o que a pessoa digitou", () => {
  it("senhas diferentes param antes do provedor", async () => {
    const state = await executar(form(SENHA, "OutraSenha123"));
    expect(h.updateUser).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
    expect(state.status === "error" && state.message).toContain("não coincidem");
  });

  it("senha fraca e recusada pelo contrato, sem ida ao servidor", async () => {
    const state = await executar(form("curta1"));
    expect(h.updateUser).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
  });

  it("senha fraca recusada pelo provedor mantem a mensagem dele", async () => {
    /*
      Especifica de proposito: e sobre o que a pessoa acabou de digitar, nao
      sobre o estado da conta. Trocar por "link invalido" aqui deixaria alguem
      com um link valido tentando de novo sem saber o que corrigir.
    */
    h.updateUser.mockResolvedValue({
      data: {},
      error: new AuthWeakPasswordError("A senha precisa de um número.", 422, [
        "characters",
      ]),
    });
    const state = await executar();
    expect(state.status === "error" && state.message).toContain("número");
  });

  it("senha igual a anterior tambem fala sobre a senha", async () => {
    const erro = new AuthApiError(
      "New password should be different from the old password.",
      422,
      "same_password",
    );
    h.updateUser.mockResolvedValue({ data: {}, error: erro });
    const state = await executar();
    expect(state.status === "error" && state.message).toBe(erro.message);
  });
});

describe("sucesso", () => {
  it("redefine e encerra a sessao de recuperacao", async () => {
    /*
      O logout nao e detalhe: a sessao veio de um link de e-mail que ja cumpriu
      a funcao. Entrar com a senha nova prova que ela funciona, em vez de deixar
      a pessoa autenticada por um token que qualquer um com acesso a caixa de
      entrada poderia ter usado.
    */
    const state = await executar();

    expect(h.updateUser).toHaveBeenCalledWith({ password: SENHA });
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(state).toEqual({
      status: "done",
      message: PASSWORD_RESET_SUCCESS_MESSAGE,
    });
  });

  it("nenhum desfecho devolve a senha ao cliente", async () => {
    const desfechos = [
      () => h.updateUser.mockResolvedValue({ data: {}, error: null }),
      () =>
        h.updateUser.mockResolvedValue({
          data: {},
          error: new AuthApiError("x", 401, "bad_jwt"),
        }),
      () => h.getUser.mockResolvedValue({ data: { user: null }, error: null }),
    ];

    for (const preparar of desfechos) {
      comSessao();
      preparar();
      const state = await executar();
      expect(JSON.stringify(state)).not.toContain(SENHA);
    }
  });
});
