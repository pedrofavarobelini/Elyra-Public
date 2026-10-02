// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/security/rate-limit";

/**
 * O retorno do OAuth.
 *
 * ## Ambiente `node`, e nao `jsdom`
 *
 * Um route handler roda no servidor. Sob `jsdom` os globais web sao os do
 * shim do ambiente, e `NextResponse` passaria a ser exercitada contra algo que
 * nao e o runtime real — o teste continuaria verde enquanto testava outra coisa.
 *
 * ## O que este arquivo protege
 *
 * Este endereco e **publico**: qualquer pessoa monta um link para ele. A
 * validacao feita na action que inicia o fluxo protege o link que nos criamos;
 * ela nao protege o link que um atacante cria. Um open redirect aqui
 * transformaria a Elyra em trampolim de phishing — a vitima autentica de
 * verdade no dominio certo e termina numa copia.
 */

const h = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  materializePendingConsents: vi.fn(),
  postAuthDestination: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession: h.exchangeCodeForSession },
  }),
}));

/*
  Sem este mock, a materializacao estourava contra um cliente falso, o
  `try/catch` do handler engolia, e os testes passavam sem provar nada sobre
  ela. Mock ausente vira cobertura imaginaria.
*/
vi.mock("@/server/repositories/identity-repository", () => ({
  materializePendingConsents: h.materializePendingConsents,
}));


vi.mock("@/server/auth-context", () => ({
  postAuthDestination: h.postAuthDestination,
}));

const { GET } = await import("./route");

const ORIGEM = "https://elyra.example";

function chamar(query: string): Promise<Response> {
  return GET(new NextRequest(`${ORIGEM}/auth/callback${query}`));
}

/** O caminho para onde a resposta manda o navegador, ja sem a origem. */
function destino(response: Response): string {
  const location = response.headers.get("location");
  if (!location) throw new Error("resposta sem Location");
  const url = new URL(location, ORIGEM);
  expect(url.origin).toBe(ORIGEM);
  return `${url.pathname}${url.search}`;
}

let avisos: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetRateLimits();
  h.exchangeCodeForSession.mockReset();
  h.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  h.materializePendingConsents.mockReset();
  h.materializePendingConsents.mockResolvedValue(0);
  h.postAuthDestination.mockReset();
  avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  avisos.mockRestore();
});

describe("troca bem-sucedida", () => {
  it("preserva a origem do cookie quando Next normaliza o IP local", async () => {
    const request = new NextRequest("http://127.0.0.1:3100/auth/callback?code=fixture", {
      headers: { "x-forwarded-host": "atacante.example" },
    });
    expect(new URL(request.url).hostname).toBe("localhost");
    const response = await GET(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("/dashboard");
    expect(new URL(response.headers.get("location")!, "http://127.0.0.1:3100").origin)
      .toBe("http://127.0.0.1:3100");
  });

  it("troca o code por sessao e leva ao destino padrao", async () => {
    const response = await chamar("?code=abc123");

    expect(h.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(destino(response)).toBe("/dashboard");
  });

  it("respeita um destino interno legitimo", async () => {
    const response = await chamar("?code=abc123&next=%2Fsessoes%2Fnova");
    expect(destino(response)).toBe("/sessoes/nova");
  });
});

describe("open redirect", () => {
  it.each([
    ["absoluto", "https%3A%2F%2Felyra-falso.example%2Froubar"],
    ["protocolo-relativo", "%2F%2Felyra-falso.example%2Froubar"],
    ["barra invertida", "%2F%5Celyra-falso.example"],
    ["javascript:", "javascript%3Aalert(1)"],
  ])("%s nao sobrevive ao callback", async (_caso, next) => {
    const response = await chamar(`?code=abc123&next=${next}`);
    const location = response.headers.get("location") ?? "";

    expect(new URL(location, ORIGEM).origin).toBe(ORIGEM);
    expect(location).not.toContain("elyra-falso");
    expect(location).not.toContain("javascript");
    expect(destino(response)).toBe("/dashboard");
  });

  it("o proprio callback nao pode ser o destino", async () => {
    // Senao o retorno volta para si mesmo — sem `code` na segunda volta, o que
    // termina em erro depois de um login que tinha dado certo.
    const response = await chamar("?code=abc123&next=%2Fauth%2Fcallback");
    expect(destino(response)).toBe("/dashboard");
  });
});

describe("desfechos que nao sao sucesso", () => {
  it("recusa no consentimento e tratada como escolha, e nao como falha", async () => {
    const response = await chamar("?error=access_denied");

    expect(h.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(destino(response)).toBe("/entrar?oauth=cancelado");
  });

  it("outro erro do provedor vira o rotulo generico", async () => {
    const response = await chamar("?error=server_error");
    expect(destino(response)).toBe("/entrar?oauth=falhou");
  });

  it("sem code e sem error, nao inventa sessao", async () => {
    const response = await chamar("");
    expect(h.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(destino(response)).toBe("/entrar?oauth=falhou");
  });

  it("troca recusada volta para o login, e nao para uma tela em branco", async () => {
    h.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: "invalid grant: code already used", code: "bad_code" },
    });
    const response = await chamar("?code=usado");
    expect(destino(response)).toBe("/entrar?oauth=falhou");
  });
});

describe("fluxo de recuperacao de senha", () => {
  /*
    O mesmo callback serve o reset porque a troca de `code` por sessao e a
    mesma, e porque so aqui da para gravar cookie. O que muda e para onde a
    falha manda a pessoa.
  */
  it("troca o code e entrega a tela de nova senha com sessao", async () => {
    const response = await chamar(
      "?code=abc123&next=%2Fredefinir-senha&flow=recovery",
    );
    expect(h.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(destino(response)).toBe("/redefinir-senha");
  });

  it("link vencido volta para pedir outro, e nao para o login", async () => {
    h.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: "invalid flow state", code: "flow_state_expired" },
    });
    const response = await chamar(
      "?code=vencido&next=%2Fredefinir-senha&flow=recovery",
    );
    expect(destino(response)).toBe("/recuperar-senha?erro=link_invalido");
  });

  it("sem code, o fluxo de recuperacao nao cai na copy do Google", async () => {
    // "Voce cancelou a entrada com o Google" para um link de e-mail vencido
    // seria uma frase sobre algo que a pessoa nunca fez.
    const response = await chamar("?flow=recovery");
    const location = response.headers.get("location") ?? "";
    expect(location).not.toContain("oauth=");
    expect(destino(response)).toBe("/recuperar-senha?erro=link_invalido");
  });

  it("o codigo nunca sobrevive na URL entregue a tela", async () => {
    const response = await chamar(
      "?code=segredo&next=%2Fredefinir-senha&flow=recovery",
    );
    expect(response.headers.get("location")).not.toContain("segredo");
  });
});

describe("consentimento pendente no nascimento da sessao", () => {
  it("a sessao recem-criada materializa o que estava pendente", async () => {
    // Este e o "primeiro acesso autenticado" que segue a confirmacao de e-mail.
    await chamar("?code=abc123");
    expect(h.materializePendingConsents).toHaveBeenCalledTimes(1);
  });

  it("nao materializa quando a troca falhou", async () => {
    h.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: "invalid grant", code: "bad_code" },
    });
    await chamar("?code=ruim");
    expect(h.materializePendingConsents).not.toHaveBeenCalled();
  });

  it("falha na materializacao nao barra quem confirmou o proprio e-mail", async () => {
    h.materializePendingConsents.mockRejectedValue(new Error("indisponivel"));
    const response = await chamar("?code=abc123&next=%2Fdashboard");
    expect(destino(response)).toBe("/dashboard");
  });
});

describe("o que nao entra na URL nem no log", () => {
  it("a descricao do provedor nao viaja na querystring", async () => {
    /*
      Texto de erro em querystring vaza para historico do navegador, log de
      proxy e cabecalho `Referer`. O que volta e um rotulo fechado que a tela
      sabe traduzir; o motivo fica no servidor.
    */
    const response = await chamar(
      "?error=server_error&error_description=Invalid+client+secret+for+google",
    );
    const location = response.headers.get("location") ?? "";

    expect(location).not.toContain("secret");
    expect(location).not.toContain("Invalid");
    expect(location).toContain("oauth=falhou");
  });

  it("a falha de troca nao registra code nem detalhe do provedor", async () => {
    h.exchangeCodeForSession.mockResolvedValue({
      data: {},
      error: { message: "invalid grant for client 123", code: "bad_code" },
    });
    await chamar("?code=segredo-do-code");

    expect(avisos).toHaveBeenCalled();
    const logado = avisos.mock.calls.flat().join(" ");
    expect(logado).not.toContain("segredo-do-code");
    expect(logado).not.toContain("invalid grant");
  });
});


describe("contexto da entrada (Stage 29 / AUTH-CONTEXT)", () => {
  const USER = { id: "6f1c2a4e-1b2c-4d3e-8f90-1234567890ab" };

  it("Google com intencao profissional leva ao destino calculado para a conta", async () => {
    h.exchangeCodeForSession.mockResolvedValue({ data: { user: USER, session: { user: USER } }, error: null });
    h.postAuthDestination.mockResolvedValue("/pro/dashboard");
    const response = await chamar("?code=abc123&next=%2Fdashboard&context=professional");
    expect(destino(response)).toBe("/pro/dashboard");
    expect(h.postAuthDestination).toHaveBeenCalledWith(expect.anything(), USER.id, {
      intent: "professional",
      next: "/dashboard",
    });
  });

  it("contexto fora da allowlist vira ausencia de intencao", async () => {
    h.exchangeCodeForSession.mockResolvedValue({ data: { user: USER }, error: null });
    h.postAuthDestination.mockResolvedValue("/dashboard");
    for (const context of ["admin", "Professional", "https%3A%2F%2Fevil.example", "javascript%3Aalert(1)"]) {
      await chamar(`?code=abc123&context=${context}`);
      expect(h.postAuthDestination).toHaveBeenLastCalledWith(expect.anything(), USER.id, { intent: null, next: null });
    }
  });

  it("recuperacao ignora a intencao e segue o proprio fluxo", async () => {
    h.exchangeCodeForSession.mockResolvedValue({ data: { user: USER }, error: null });
    const response = await chamar("?code=abc123&flow=recovery&next=%2Fredefinir-senha&context=professional");
    expect(destino(response)).toBe("/redefinir-senha");
    expect(h.postAuthDestination).not.toHaveBeenCalled();
  });
});
