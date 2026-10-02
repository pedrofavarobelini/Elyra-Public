import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O aceite de primeiro acesso.
 *
 * ## Duas coisas opostas para provar
 *
 * 1. **Enquanto os documentos nao existirem, nada e gravado.** Registrar um
 *    `consent_event` afirmando aceite de Termos e Politica que o produto nao tem
 *    nao seria um registro fraco — seria falso, e o log e append-only justamente
 *    para poder ser levado a serio.
 * 2. **Quando existirem, o aceite funciona e nao duplica.** O caminho de
 *    gravacao precisa estar provado antes de ser ligado, e nao depois: ligar uma
 *    feature e descobrir ali que ela duplica consentimento seria descobrir tarde.
 *
 * O segundo grupo mocka `TERMS_DOCUMENTS_AVAILABLE` como fixture declarada. Isso
 * nao antecipa a decisao de produto: apenas exercita o codigo que hoje esta
 * atras dela.
 */

const h = vi.hoisted(() => ({
  documentosDisponiveis: false,
  getUser: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
  getConsentHistory: vi.fn(),
  appendConsentGrant: vi.fn(),
  appendAudit: vi.fn(),
  redirected: null as string | null,
}));

vi.mock("@/lib/contracts/consent", async (original) => ({
  ...(await original<object>()),
  get TERMS_DOCUMENTS_AVAILABLE() {
    return h.documentosDisponiveis;
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: h.getUser,
      mfa: {
        getAuthenticatorAssuranceLevel: h.getAuthenticatorAssuranceLevel,
      },
    },
  }),
}));
vi.mock("@/server/app-lock", () => ({
  getAppLockSummary: async () => ({
    state: "DISABLED",
    enabled: false,
    failedAttempts: 0,
    cooldownUntil: null,
  }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.redirected = to;
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/server/services/consent-service", () => ({
  getConsentHistory: h.getConsentHistory,
  hasActiveTermsConsent: async () => true,
}));
vi.mock("@/server/repositories/identity-repository", () => ({
  appendConsentGrant: h.appendConsentGrant,
  appendAudit: h.appendAudit,
}));

const { acceptTermsAction } = await import("./actions");

function form(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  data.set("acceptedTerms", "on");
  data.set("next", "/sessoes");
  for (const [key, value] of Object.entries(overrides)) data.set(key, value);
  return data;
}

/** Executa a acao capturando o redirect, que e o desfecho de sucesso. */
async function aceitar(data: FormData = form()) {
  try {
    const state = await acceptTermsAction({ status: "idle" }, data);
    return { redirecionou: false as const, state };
  } catch (error) {
    if ((error as Error).message !== "NEXT_REDIRECT") throw error;
    return { redirecionou: true as const, destino: h.redirected ?? "" };
  }
}

/** Historia sem nenhuma concessao de termos. */
const SEM_ACEITE = { purposes: [], elsewhere: [] };
/** Historia com concessao vigente — a fixture do caso idempotente. */
const COM_ACEITE = {
  purposes: [{ purpose: "terms_privacy", active: true }],
  elsewhere: [],
};

beforeEach(() => {
  h.documentosDisponiveis = false;
  h.getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  h.getAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({
    data: { currentLevel: "aal1", nextLevel: "aal1" },
    error: null,
  });
  h.getConsentHistory.mockReset();
  h.getConsentHistory.mockResolvedValue(SEM_ACEITE);
  h.appendConsentGrant.mockReset();
  h.appendConsentGrant.mockResolvedValue({ id: "consent-1" });
  h.appendAudit.mockReset();
  h.redirected = null;
});

describe("sem documentos, o aceite e recusado no servidor", () => {
  it("nao grava consentimento nenhum", async () => {
    const resultado = await aceitar();

    expect(h.appendConsentGrant).not.toHaveBeenCalled();
    expect(resultado.redirecionou).toBe(false);
  });

  it("a recusa e explicita, e nao um silencio", async () => {
    const resultado = await aceitar();
    expect(resultado.redirecionou === false && resultado.state.status).toBe(
      "error",
    );
  });

  it("a recusa nao depende do botao da tela", async () => {
    /*
      O ponto de seguranca: desabilitar o botao e HTML, e HTML se contorna com
      uma requisicao. Aqui a acao e chamada direto, como um cliente hostil
      faria, e a resposta continua sendo recusa.
    */
    const resultado = await aceitar(form({ acceptedTerms: "on" }));
    expect(h.appendConsentGrant).not.toHaveBeenCalled();
    expect(resultado.redirecionou).toBe(false);
  });
});

describe("com documentos, o aceite grava uma vez", () => {
  beforeEach(() => {
    h.documentosDisponiveis = true;
  });

  it("o primeiro aceite cria exatamente um evento", async () => {
    const resultado = await aceitar();

    expect(h.appendConsentGrant).toHaveBeenCalledTimes(1);
    expect(h.appendConsentGrant.mock.calls[0]?.[1]).toEqual({
      userId: "u-1",
      purpose: "terms_privacy",
      documentVersion: "v1",
    });
    expect(resultado.redirecionou).toBe(true);
  });

  it("quem ja aceitou nao gera um segundo evento", async () => {
    // Recarregar, clicar duas vezes, voltar por outra aba: todos passam por
    // aqui. Nao ha `unique` no banco de proposito — ele quebraria o ciclo
    // conceder -> revogar -> conceder que o 23-B provou.
    h.getConsentHistory.mockResolvedValue(COM_ACEITE);
    const resultado = await aceitar();

    expect(h.appendConsentGrant).not.toHaveBeenCalled();
    expect(resultado.redirecionou).toBe(true);
  });

  it("sem marcar a caixa, nada e gravado", async () => {
    const data = form();
    data.delete("acceptedTerms");
    const resultado = await aceitar(data);

    expect(h.appendConsentGrant).not.toHaveBeenCalled();
    expect(resultado.redirecionou === false && resultado.state.status).toBe(
      "error",
    );
  });

  it("o destino interno e preservado", async () => {
    const resultado = await aceitar();
    expect(resultado.redirecionou && resultado.destino).toBe("/sessoes");
  });

  it("destino externo nao sobrevive ao aceite", async () => {
    // O campo oculto e enviado pelo cliente, e quem envia escolhe o que manda.
    const resultado = await aceitar(
      form({ next: "https://elyra-falso.example/roubar" }),
    );

    expect(resultado.redirecionou && resultado.destino).toBe("/dashboard");
  });

  it("falha ao gravar nao finge que deu certo", async () => {
    h.appendConsentGrant.mockRejectedValue(new Error("indisponivel"));
    const resultado = await aceitar();

    expect(resultado.redirecionou).toBe(false);
    expect(resultado.redirecionou === false && resultado.state.status).toBe(
      "error",
    );
  });
});
