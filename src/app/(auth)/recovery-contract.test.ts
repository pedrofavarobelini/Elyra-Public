import { AuthApiError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RECOVERY_REQUESTED_MESSAGE,
  type RecoveryActionState,
} from "@/lib/contracts/auth";

/**
 * O contrato publico de "esqueci minha senha".
 *
 * ## A regra que estes testes travam
 *
 * A resposta e **a mesma** tendo a conta ou nao. Um formulario de recuperacao
 * que distingue os dois casos e um enumerador melhor que o de cadastro: nao
 * exige senha, nao exige nome, nao exige nada — basta digitar um e-mail e ler a
 * resposta.
 *
 * A comparacao e feita byte a byte sobre o estado serializado, e nao campo a
 * campo escolhido a dedo: um campo novo que vazasse a diferenca passaria
 * despercebido por uma assercao que so olha `message`.
 */

const h = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  consumeRateLimit: vi.fn(),
  scopesUsados: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { resetPasswordForEmail: h.resetPasswordForEmail },
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-forwarded-for": "203.0.113.7",
      origin: "https://elyra.example",
    }),
}));
vi.mock("@/lib/security/rate-limit", async (original) => ({
  ...(await original<object>()),
  consumeRateLimit: (scope: string, identity: string) => {
    h.scopesUsados.push(scope);
    return h.consumeRateLimit(scope, identity);
  },
}));

const { requestPasswordRecoveryAction } = await import("./actions");

function form(email: string): FormData {
  const data = new FormData();
  data.set("email", email);
  return data;
}

function executar(email: string): Promise<RecoveryActionState> {
  return requestPasswordRecoveryAction({ status: "idle" }, form(email));
}

let avisos: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.resetPasswordForEmail.mockReset();
  h.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  h.consumeRateLimit.mockReset();
  h.consumeRateLimit.mockReturnValue({ allowed: true });
  h.scopesUsados = [];
  avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  avisos.mockRestore();
});

describe("a resposta nao revela se a conta existe", () => {
  it("conta existente e conta inexistente respondem identico", async () => {
    // O provedor nao distingue os dois na chamada bem-sucedida; o que se prova
    // aqui e que a **action** tambem nao inventa a distincao.
    const existente = await executar("tem-conta@elyra.invalid");

    h.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: new AuthApiError("User not found", 400, "user_not_found"),
    });
    const inexistente = await executar("nao-tem@elyra.invalid");

    expect(JSON.stringify(existente)).toBe(JSON.stringify(inexistente));
  });

  it("falha de infraestrutura responde igual a sucesso", async () => {
    /*
      O caso que mais tenta a mao: sem provedor de e-mail configurado, a
      tentacao e dizer "nao foi possivel enviar". Dito para um endereco e
      "enviamos" para outro, isso entrega a existencia da conta pela porta dos
      fundos — e e exatamente o estado desta instalacao hoje, sem SMTP local.
    */
    const bom = await executar("alguem@elyra.invalid");

    h.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: new AuthApiError(
        "smtp: connection refused at 10.0.0.4:587",
        500,
        "unexpected_failure",
      ),
    });
    const ruim = await executar("alguem@elyra.invalid");

    expect(JSON.stringify(bom)).toBe(JSON.stringify(ruim));
  });

  it("a frase e condicional, e nao promete entrega", async () => {
    const state = await executar("alguem@elyra.invalid");
    expect(state).toEqual({ status: "sent", message: RECOVERY_REQUESTED_MESSAGE });
    expect(RECOVERY_REQUESTED_MESSAGE).toContain("Se houver uma conta");
  });

  it("nenhum detalhe do provedor chega a tela", async () => {
    h.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: new AuthApiError(
        "smtp: connection refused at 10.0.0.4:587",
        500,
        "unexpected_failure",
      ),
    });
    const state = await executar("alguem@elyra.invalid");
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("smtp");
    expect(serialized).not.toContain("10.0.0.4");
    expect(serialized).not.toContain("unexpected_failure");
  });

  it("o log da falha nao carrega o e-mail digitado", async () => {
    // Log de recuperacao com endereco vira um registro de quem tentou
    // recuperar o que — dado pessoal em arquivo de texto, sem necessidade.
    h.resetPasswordForEmail.mockResolvedValue({
      data: {},
      error: new AuthApiError("x", 500, "unexpected_failure"),
    });
    await executar("pessoa-real@elyra.invalid");

    expect(avisos).toHaveBeenCalled();
    const logado = avisos.mock.calls.flat().join(" ");
    expect(logado).not.toContain("pessoa-real@elyra.invalid");
  });
});

describe("validacao e limite", () => {
  it("e-mail malformado nao chega ao provedor e preserva o que foi digitado", async () => {
    const state = await executar("nao-e-email");
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
    expect(state.status === "error" && state.values?.email).toBe("nao-e-email");
  });

  it("usa o balde de recuperacao, e nao o de login", async () => {
    /*
      Baldes separados existem porque os riscos sao diferentes: login protege a
      conta contra forca bruta; recuperacao protege a **caixa de entrada de
      terceiro** contra ser usada como alvo. Compartilhar o contador faria um
      limite errado para os dois.
    */
    await executar("alguem@elyra.invalid");
    expect(h.scopesUsados).toContain("passwordRecovery");
    expect(h.scopesUsados).not.toContain("auth");
  });

  it("limite excedido nao dispara e-mail nenhum", async () => {
    h.consumeRateLimit.mockReturnValue({ allowed: false });
    const state = await executar("alguem@elyra.invalid");
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
  });
});

describe("o link enviado", () => {
  it("passa pelo callback, e nao direto pela tela de nova senha", async () => {
    /*
      Provado contra a instalacao real, e nao deduzido: `@supabase/ssr` usa
      PKCE, entao o `verify` do GoTrue devolve `?code=` — um codigo, nao uma
      sessao. Apontar direto para `/redefinir-senha` fazia **todo** reset real
      terminar em "link invalido", porque Server Component nao grava cookie e a
      troca morria em silencio. O callback grava, e ja e testado.
    */
    await executar("alguem@elyra.invalid");
    expect(h.resetPasswordForEmail).toHaveBeenCalledWith(
      "alguem@elyra.invalid",
      {
        redirectTo:
          "https://elyra.example/auth/callback?next=%2Fredefinir-senha&flow=recovery",
      },
    );
  });
});
