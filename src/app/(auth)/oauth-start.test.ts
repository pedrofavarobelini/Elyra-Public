import { AuthApiError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  OAUTH_UNAVAILABLE_MESSAGE,
  type AuthActionState,
} from "@/lib/contracts/auth";

/**
 * O inicio do login com Google.
 *
 * ## O que esta action e, e o que ela nao e
 *
 * Ela **nao** fala com o Google. Ela pede ao Supabase a URL de autorizacao e
 * redireciona para la. A distincao importa porque nenhuma credencial precisa
 * existir no navegador — nem o `client_id` — e porque a instalacao sem provedor
 * configurado falha aqui, de forma previsivel, em vez de mandar a pessoa para
 * uma tela de erro do Google.
 *
 * ## O destino ja e validado na partida
 *
 * O callback valida de novo, e e la que mora a defesa real: aquele endereco e
 * publico. Validar aqui tambem evita montar uma URL de autorizacao carregando um
 * destino que sera descartado depois — e o teste registra que a validacao nao
 * depende de um unico ponto.
 */

const h = vi.hoisted(() => ({
  signInWithOAuth: vi.fn(),
  rateLimited: false,
  redirected: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { signInWithOAuth: h.signInWithOAuth },
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-forwarded-for": "203.0.113.7",
      origin: "https://elyra.example",
    }),
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

const { signInWithGoogleAction } = await import("./actions");

const URL_DO_PROVEDOR =
  "https://accounts.google.com/o/oauth2/v2/auth?client_id=123&redirect_uri=x";

function form(next?: string): FormData {
  const data = new FormData();
  if (next !== undefined) data.set("next", next);
  return data;
}

async function executar(data: FormData = form()): Promise<AuthActionState> {
  try {
    return await signInWithGoogleAction({ status: "idle" }, data);
  } catch (error) {
    if ((error as Error).message === "NEXT_REDIRECT") return { status: "idle" };
    throw error;
  }
}

/** As opcoes com que o Supabase foi chamado na ultima execucao. */
function opcoes(): { redirectTo: string; skipBrowserRedirect: boolean } {
  return h.signInWithOAuth.mock.calls.at(-1)?.[0]?.options;
}

let avisos: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.signInWithOAuth.mockReset();
  h.signInWithOAuth.mockResolvedValue({
    data: { url: URL_DO_PROVEDOR, provider: "google" },
    error: null,
  });
  h.rateLimited = false;
  h.redirected = null;
  avisos = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  avisos.mockRestore();
});

describe("caminho normal", () => {
  it("redireciona para a URL de autorizacao que o Supabase devolveu", async () => {
    await executar();
    expect(h.redirected).toBe(URL_DO_PROVEDOR);
  });

  it("pede o retorno em /auth/callback na origem da requisicao", async () => {
    await executar();
    expect(opcoes().redirectTo).toBe(
      "https://elyra.example/auth/callback?next=%2Fdashboard",
    );
  });

  it("nao deixa o Supabase redirecionar sozinho", async () => {
    /*
      `skipBrowserRedirect` existe porque nao ha cliente de navegador neste
      projeto: quem fala com o Supabase e o servidor. Sem isso, a biblioteca
      tentaria navegar num contexto onde `window` nao existe.
    */
    await executar();
    expect(opcoes().skipBrowserRedirect).toBe(true);
  });

  it("preserva um destino interno legitimo", async () => {
    await executar(form("/sessoes/nova"));
    expect(opcoes().redirectTo).toContain("next=%2Fsessoes%2Fnova");
  });
});

describe("destino externo nao vira parametro", () => {
  it.each([
    ["absoluto", "https://elyra-falso.example/roubar"],
    ["protocolo-relativo", "//elyra-falso.example/roubar"],
    ["barra invertida", "/\\elyra-falso.example"],
  ])("%s e descartado antes da URL de autorizacao", async (_caso, destino) => {
    await executar(form(destino));
    const redirectTo = opcoes().redirectTo;
    expect(redirectTo).toContain("next=%2Fdashboard");
    expect(redirectTo).not.toContain("elyra-falso");
  });
});

describe("intencao de contexto (Stage 29 / AUTH-CONTEXT)", () => {
  it("entrar como profissional atravessa o Google so pelo nosso callback", async () => {
    const data = form("/dashboard");
    data.set("context", "professional");
    await executar(data);
    const callback = new URL(opcoes().redirectTo);
    expect(callback.pathname).toBe("/auth/callback");
    expect(callback.searchParams.get("context")).toBe("professional");
  });

  it.each(["admin", "Professional", "https://elyra-falso.example", "professional&next=//x"])(
    "valor fora da allowlist nao vai para a URL: %s",
    async (context) => {
      const data = form();
      data.set("context", context);
      await executar(data);
      const callback = new URL(opcoes().redirectTo);
      expect(callback.searchParams.has("context")).toBe(false);
      expect(opcoes().redirectTo).not.toContain("elyra-falso");
    },
  );
});

describe("provedor indisponivel", () => {
  it("erro do Supabase vira mensagem util, e nao tela de erro do Google", async () => {
    h.signInWithOAuth.mockResolvedValue({
      data: null,
      error: new AuthApiError(
        "Unsupported provider: provider is not enabled",
        400,
        "validation_failed",
      ),
    });
    const state = await executar();

    expect(h.redirected).toBeNull();
    expect(state).toEqual({
      status: "error",
      message: OAUTH_UNAVAILABLE_MESSAGE,
      offerSignIn: false,
    });
  });

  it("resposta sem URL tambem para o fluxo, em vez de redirecionar para lugar nenhum", async () => {
    h.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: null });
    const state = await executar();
    expect(h.redirected).toBeNull();
    expect(state.status).toBe("error");
  });

  it("nao vaza o motivo interno para a tela", async () => {
    h.signInWithOAuth.mockResolvedValue({
      data: null,
      error: new AuthApiError(
        "Unsupported provider: missing OAuth secret for google",
        400,
        "validation_failed",
      ),
    });
    const state = await executar();
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("provider");
    expect(serialized).not.toContain("validation_failed");
  });

  it("a mensagem oferece o caminho que funciona", async () => {
    // Configuracao ausente nao e culpa de quem clicou; a frase precisa dizer o
    // que fazer agora, e nao descrever o estado do servidor.
    expect(OAUTH_UNAVAILABLE_MESSAGE).toContain("e-mail e senha");
  });
});

describe("limite de tentativas", () => {
  it("limite excedido nao chega ao provedor", async () => {
    h.rateLimited = true;
    const state = await executar();
    expect(h.signInWithOAuth).not.toHaveBeenCalled();
    expect(h.redirected).toBeNull();
    expect(state.status).toBe("error");
  });
});
