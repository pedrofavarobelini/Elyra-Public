import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  startAuthentication: vi.fn(),
  verifyAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  verifyRegistration: vi.fn(),
  list: vi.fn(),
  deletePasskey: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  mfaStatus: vi.fn(),
}));

const client = {
  auth: {
    passkey: {
      startAuthentication: h.startAuthentication,
      verifyAuthentication: h.verifyAuthentication,
      startRegistration: h.startRegistration,
      verifyRegistration: h.verifyRegistration,
      list: h.list,
      delete: h.deletePasskey,
    },
    getUser: h.getUser,
    signOut: h.signOut,
  },
};

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => client }));
vi.mock("@/server/auth", () => ({
  getAuthenticatedUser: h.getAuthenticatedUser,
  requireAuthenticatedUser: h.getAuthenticatedUser,
}));
vi.mock("@/server/auth-mfa", () => ({ mfaStatus: h.mfaStatus, MFA_VERIFICATION_PATH: "/entrar/verificacao" }));

import {
  deletePasskeyAction,
  finishPasskeyRegistrationAction,
  finishPasskeySignInAction,
  getPasskeysState,
  startPasskeyRegistrationAction,
  startPasskeySignInAction,
} from "@/app/passkey-actions";
import { resetRateLimits } from "@/lib/security/rate-limit";

const credential = {
  id: "AQID",
  rawId: "AQID",
  type: "public-key" as const,
  clientExtensionResults: {},
  authenticatorAttachment: "platform" as const,
  response: {
    authenticatorData: "AQID",
    clientDataJSON: "AQID",
    signature: "AQID",
  },
};

const registration = {
  ...credential,
  response: {
    attestationObject: "AQID",
    authenticatorData: "AQID",
    clientDataJSON: "AQID",
    publicKey: "AQID",
    publicKeyAlgorithm: -7,
    transports: ["internal"],
  },
};

beforeEach(() => {
  resetRateLimits();
  vi.clearAllMocks();
  h.getAuthenticatedUser.mockResolvedValue({ client, user: { id: "user-1" }, supabase: client });
  h.mfaStatus.mockResolvedValue("not_required");
  h.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  h.signOut.mockResolvedValue({ error: null });
});

describe("passkey server actions", () => {
  it("inicia login sem pedir e-mail", async () => {
    h.startAuthentication.mockResolvedValue({
      data: { challenge_id: "11111111-1111-4111-8111-111111111111", options: { challenge: "AQID" } },
      error: null,
    });
    await expect(startPasskeySignInAction()).resolves.toMatchObject({ status: "ready", options: { challenge: "AQID" } });
  });

  it("orienta fallback quando uma credencial removida chega à verificação", async () => {
    h.verifyAuthentication.mockResolvedValue({
      data: null,
      error: { code: "webauthn_verification_failed" },
    });
    await expect(finishPasskeySignInAction({
      challengeId: "11111111-1111-4111-8111-111111111111",
      credential,
    })).resolves.toMatchObject({
      status: "error",
      code: "webauthn_verification_failed",
      message: expect.stringContaining("outra forma de entrar"),
    });
  });

  it("cria cookie de sessao pelo verify do mesmo cliente e respeita MFA", async () => {
    h.verifyAuthentication.mockResolvedValue({ data: { session: { access_token: "redacted", user: { id: "user-1" } }, user: { id: "user-1" } }, error: null });
    h.mfaStatus.mockResolvedValue("pending");
    await expect(finishPasskeySignInAction({
      challengeId: "11111111-1111-4111-8111-111111111111",
      credential,
    })).resolves.toEqual({ status: "done", next: "/entrar/verificacao" });
    expect(h.verifyAuthentication).toHaveBeenCalledTimes(1);
  });

  it("falha fechada se o verify e a sessão materializada divergem", async () => {
    h.verifyAuthentication.mockResolvedValue({
      data: { session: { user: { id: "user-1" } }, user: { id: "user-1" } },
      error: null,
    });
    h.getUser.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });

    await expect(finishPasskeySignInAction({
      challengeId: "11111111-1111-4111-8111-111111111111",
      credential,
    })).resolves.toMatchObject({ status: "error", code: "passkey_identity_mismatch" });
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("recusa resposta de autenticador fora do contrato", async () => {
    const result = await finishPasskeySignInAction({
      challengeId: "not-a-uuid",
      credential,
    });
    expect(result).toMatchObject({ status: "error", code: "invalid_response" });
    expect(h.verifyAuthentication).not.toHaveBeenCalled();
  });

  it("exige AAL antes de cadastrar nova credencial", async () => {
    h.mfaStatus.mockResolvedValue("pending");
    await expect(startPasskeyRegistrationAction()).resolves.toMatchObject({
      status: "error",
      code: "mfa_required",
    });
    expect(h.startRegistration).not.toHaveBeenCalled();
  });

  it("registra credencial estritamente validada", async () => {
    h.verifyRegistration.mockResolvedValue({
      data: { id: "22222222-2222-4222-8222-222222222222", created_at: "2026-09-19T12:00:00Z" },
      error: null,
    });
    await expect(finishPasskeyRegistrationAction({
      challengeId: "11111111-1111-4111-8111-111111111111",
      credential: registration,
    })).resolves.toMatchObject({ status: "done", passkey: { id: "22222222-2222-4222-8222-222222222222" } });
  });

  it("não conclui cadastro se a sessão mudou durante a cerimônia", async () => {
    h.verifyRegistration.mockResolvedValue({
      data: { id: "22222222-2222-4222-8222-222222222222", created_at: "2026-09-19T12:00:00Z" },
      error: null,
    });
    h.getUser.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });

    await expect(finishPasskeyRegistrationAction({
      challengeId: "11111111-1111-4111-8111-111111111111",
      credential: registration,
    })).resolves.toMatchObject({ status: "error", code: "passkey_identity_mismatch" });
    expect(h.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("lista multiplas credenciais e remove somente o id solicitado", async () => {
    h.list.mockResolvedValue({
      data: [
        { id: "11111111-1111-4111-8111-111111111111", created_at: "2026-09-19T12:00:00Z" },
        { id: "22222222-2222-4222-8222-222222222222", created_at: "2026-09-19T12:01:00Z" },
      ],
      error: null,
    });
    await expect(getPasskeysState(client as never)).resolves.toMatchObject({ available: true, passkeys: [{}, {}] });
    h.deletePasskey.mockResolvedValue({ data: null, error: null });
    await expect(deletePasskeyAction("22222222-2222-4222-8222-222222222222")).resolves.toEqual({ status: "done" });
    expect(h.deletePasskey).toHaveBeenCalledWith({ passkeyId: "22222222-2222-4222-8222-222222222222" });
  });
});
