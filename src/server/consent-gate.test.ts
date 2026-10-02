import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/app-lock", () => ({
  getAppLockSummary: vi.fn(async () => ({
    state: "DISABLED",
    lockId: null,
    failedAttempts: 0,
    cooldownUntil: null,
    unlockedUntil: null,
  })),
}));

import {
  FIRST_ACCESS_PATH,
  TERMS_CONSENT_REQUIRED_CODE,
} from "@/lib/contracts/consent";

/**
 * O portao de consentimento: `AUTHENTICATED != TERMS_ACCEPTED`.
 *
 * ## O buraco que estes testes fecham
 *
 * Um usuario criado por OAuth nunca passa pelo formulario de cadastro. Antes
 * deste portao ele chegava autenticado a `/dashboard`, `/sessoes`, `/diario` e a
 * area profissional sem ter aceitado termo nenhum — a tela de consentimento do
 * Google fala pelo Google, e nao pela Elyra.
 *
 * ## O que cada camada precisa provar
 *
 * Paginas redirecionam; APIs respondem `403` com codigo tipado. `401` seria
 * errado nas APIs: a pessoa **esta** autenticada, e mandar o cliente autenticar
 * de novo nao resolve o que falta.
 */

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  getAuthenticatorAssuranceLevel: vi.fn(),
  hasActiveTermsConsent: vi.fn(),
  pathHeader: null as string | null,
  redirected: null as string | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: h.getUser, mfa: { getAuthenticatorAssuranceLevel: h.getAuthenticatorAssuranceLevel } } }),
}));
vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers(h.pathHeader ? { "x-elyra-path": h.pathHeader } : {}),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    h.redirected = to;
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/server/services/consent-service", () => ({
  hasActiveTermsConsent: h.hasActiveTermsConsent,
}));

const { requireConsentedUser, getConsentedApiUser } = await import("./auth");

/** Executa o portao de pagina capturando o redirect. */
async function abrirPagina(): Promise<
  { redirecionou: true; destino: string } | { redirecionou: false }
> {
  try {
    await requireConsentedUser();
    return { redirecionou: false };
  } catch (error) {
    if ((error as Error).message !== "NEXT_REDIRECT") throw error;
    return { redirecionou: true, destino: h.redirected ?? "" };
  }
}

function comSessao() {
  h.getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
}

beforeEach(() => {
  h.getUser.mockReset();
  h.getAuthenticatorAssuranceLevel.mockReset().mockResolvedValue({
    data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null,
  });
  h.hasActiveTermsConsent.mockReset();
  h.pathHeader = null;
  h.redirected = null;
  comSessao();
});

describe("portao das paginas", () => {
  it("sem aceite, a pagina nao abre — vai para o primeiro acesso", async () => {
    h.hasActiveTermsConsent.mockResolvedValue(false);
    const resultado = await abrirPagina();

    expect(resultado.redirecionou).toBe(true);
    expect(resultado.redirecionou && resultado.destino).toContain(
      FIRST_ACCESS_PATH,
    );
  });

  it("com aceite, a pagina abre normalmente", async () => {
    h.hasActiveTermsConsent.mockResolvedValue(true);
    const resultado = await abrirPagina();
    expect(resultado.redirecionou).toBe(false);
  });

  it("o destino original e preservado", async () => {
    // Quem tentou /sessoes volta para /sessoes depois de aceitar, e nao para o
    // dashboard: o portao interrompe a jornada, nao a substitui.
    h.hasActiveTermsConsent.mockResolvedValue(false);
    h.pathHeader = "/sessoes";
    const resultado = await abrirPagina();

    expect(resultado.redirecionou && resultado.destino).toBe(
      `${FIRST_ACCESS_PATH}?next=${encodeURIComponent("/sessoes")}`,
    );
  });

  it("sem o header, cai no destino padrao em vez de montar URL quebrada", async () => {
    h.hasActiveTermsConsent.mockResolvedValue(false);
    h.pathHeader = null;
    const resultado = await abrirPagina();

    expect(resultado.redirecionou && resultado.destino).toBe(
      `${FIRST_ACCESS_PATH}?next=${encodeURIComponent("/dashboard")}`,
    );
  });
});

describe("destino forjado no header nao escapa do site", () => {
  /*
    Metade da defesa. A outra metade e o proxy sobrescrever o header a cada
    requisicao — provada no teste do proxy. Aqui se prova que **mesmo se** um
    valor estranho chegasse, ele nao viraria destino.
  */
  it.each([
    ["absoluto", "https://elyra-falso.example/roubar"],
    ["protocolo-relativo", "//elyra-falso.example"],
    ["barra invertida", "/\\elyra-falso.example"],
    ["javascript:", "javascript:alert(1)"],
  ])("%s vira o destino padrao", async (_caso, forjado) => {
    h.hasActiveTermsConsent.mockResolvedValue(false);
    h.pathHeader = forjado;
    const resultado = await abrirPagina();

    const destino = resultado.redirecionou ? resultado.destino : "";
    expect(destino).not.toContain("elyra-falso");
    expect(destino).not.toContain("javascript");
    expect(destino).toBe(
      `${FIRST_ACCESS_PATH}?next=${encodeURIComponent("/dashboard")}`,
    );
  });
});

describe("portao das APIs", () => {
  it("falha de MFA interrompe pagina e API antes de consultar consentimento", async () => {
    h.getAuthenticatorAssuranceLevel.mockResolvedValue({ data: null, error: { message: "indisponivel" } });
    h.hasActiveTermsConsent.mockResolvedValue(true);
    await expect(requireConsentedUser()).rejects.toThrow("mfa_verification_unavailable");
    await expect(getConsentedApiUser()).rejects.toThrow("mfa_verification_unavailable");
    expect(h.hasActiveTermsConsent).not.toHaveBeenCalled();
  });

  it("sem aceite responde 403 com codigo tipado, e nao 401", async () => {
    h.hasActiveTermsConsent.mockResolvedValue(false);
    const { auth, denial } = await getConsentedApiUser();

    expect(auth).toBeNull();
    expect(denial?.status).toBe(403);
    const corpo = await denial?.json();
    expect(corpo.code).toBe(TERMS_CONSENT_REQUIRED_CODE);
  });

  it("sem sessao continua sendo 401 — sao coisas diferentes", async () => {
    // 403 diz "voce esta autenticado e ainda nao pode"; 401 diz "autentique-se".
    // Colapsar os dois mandaria a pessoa fazer login para resolver algo que
    // login nenhum resolve.
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const { auth, denial } = await getConsentedApiUser();

    expect(auth).toBeNull();
    expect(denial?.status).toBe(401);
  });

  it("com aceite devolve o usuario e nenhuma recusa", async () => {
    h.hasActiveTermsConsent.mockResolvedValue(true);
    const { auth, denial } = await getConsentedApiUser();

    expect(denial).toBeNull();
    expect(auth?.user.id).toBe("u-1");
  });

  it("a recusa nao vaza detalhe interno", async () => {
    h.hasActiveTermsConsent.mockResolvedValue(false);
    const { denial } = await getConsentedApiUser();
    const corpo = JSON.stringify(await denial?.json());

    expect(corpo).not.toContain("u-1");
    expect(corpo).not.toContain("consent_events");
  });
});
