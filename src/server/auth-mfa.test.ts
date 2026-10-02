import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hasVerifiedTotp, mfaStatus } from "@/server/auth-mfa";



function clientWith(aal: unknown, factors: unknown = { data: { totp: [] }, error: null }) {
  return {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => aal),
        listFactors: vi.fn(async () => factors),
      },
    },
  } as never;
}

describe("portao do segundo fator", () => {
  it("conta sem fator: nao exige nada", async () => {
    const client = clientWith({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null });
    await expect(mfaStatus(client)).resolves.toBe("not_required");
  });

  it("conta com fator e sessao apenas com senha: pendente", async () => {
    const client = clientWith({ data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null });
    await expect(mfaStatus(client)).resolves.toBe("pending");
  });

  it("codigo confirmado na sessao: satisfeito", async () => {
    const client = clientWith({ data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null });
    await expect(mfaStatus(client)).resolves.toBe("satisfied");
  });

  it("falha de leitura nao dispensa o segundo fator", async () => {
    const client = clientWith({ data: null, error: { message: "indisponivel" } });
    await expect(mfaStatus(client)).rejects.toThrow("mfa_verification_unavailable");
  });

  it.each([
    null,
    { currentLevel: null, nextLevel: null },
    { currentLevel: "aal1", nextLevel: null },
  ])("resposta incompleta nao autoriza acesso: %j", async (data) => {
    await expect(
      mfaStatus(clientWith({ data, error: null })),
    ).rejects.toThrow("mfa_verification_unavailable");
  });

  it("excecao do SDK e recusada sem divulgar sua mensagem", async () => {
    const client = { auth: { mfa: { getAuthenticatorAssuranceLevel: vi.fn().mockRejectedValue(new Error("detalhe privado do provedor")) } } } as never;
    await expect(mfaStatus(client)).rejects.toThrow(/^mfa_verification_unavailable$/);
  });

  it("lista de fatores: so `verified` conta", async () => {
    await expect(
      hasVerifiedTotp(
        clientWith({ data: null, error: null }, { data: { totp: [{ status: "unverified" }] }, error: null }),
      ),
    ).resolves.toBe(false);
    await expect(
      hasVerifiedTotp(
        clientWith({ data: null, error: null }, { data: { totp: [{ status: "verified" }] }, error: null }),
      ),
    ).resolves.toBe(true);
  });

  it("falha ao listar fatores nao pode aparecer como MFA desativado", async () => {
    await expect(
      hasVerifiedTotp(
        clientWith({ data: null, error: null }, { data: null, error: { message: "indisponivel" } }),
      ),
    ).rejects.toThrow("mfa_factors_unavailable");
  });
});

describe("cliente sem a superficie de MFA", () => {
  it("ausencia do recurso nao pode autorizar acesso", async () => {
    const semMfa = { auth: {} } as never;
    await expect(mfaStatus(semMfa)).rejects.toThrow("mfa_verification_unavailable");
    await expect(hasVerifiedTotp(semMfa)).rejects.toThrow("mfa_factors_unavailable");
  });
});
