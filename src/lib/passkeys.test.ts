// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  browserSupportsPasskeys,
  createPasskey,
  PasskeyClientError,
  requestPasskey,
} from "@/lib/passkeys";

class FakePublicKeyCredential {
  id = "credential-id";
  rawId = new Uint8Array([1, 2, 3]).buffer;
  type = "public-key" as const;
  authenticatorAttachment: AuthenticatorAttachment = "platform";
  response: AuthenticatorAttestationResponse | AuthenticatorAssertionResponse;

  constructor(response: AuthenticatorAttestationResponse | AuthenticatorAssertionResponse) {
    this.response = response;
  }

  getClientExtensionResults() {
    return {};
  }
}

function stubCredentialApi(input: { create?: unknown; get?: unknown }) {
  vi.stubGlobal("PublicKeyCredential", FakePublicKeyCredential);
  vi.stubGlobal("navigator", {
    credentials: {
      create: vi.fn(async () => input.create),
      get: vi.fn(async () => input.get),
    },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("passkeys browser boundary", () => {
  it("recusa navegador sem WebAuthn", async () => {
    vi.stubGlobal("PublicKeyCredential", undefined);
    expect(browserSupportsPasskeys()).toBe(false);
    await expect(requestPasskey({ challenge: "AQID" })).rejects.toMatchObject({
      code: "unsupported",
    });
  });

  it("serializa registro sem expor nenhum cliente ou token", async () => {
    const response = {
      attestationObject: new Uint8Array([4, 5]).buffer,
      clientDataJSON: new Uint8Array([6, 7]).buffer,
      getTransports: () => ["internal"],
    } as unknown as AuthenticatorAttestationResponse;
    stubCredentialApi({ create: new FakePublicKeyCredential(response) });

    const result = await createPasskey({
      challenge: "AQID",
      rp: { name: "Elyra", id: "localhost" },
      user: { id: "AQID", name: "qa@example.test", displayName: "QA" },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
    });

    expect(result).toMatchObject({
      id: "credential-id",
      rawId: "AQID",
      type: "public-key",
      authenticatorAttachment: "platform",
      response: { attestationObject: "BAU", clientDataJSON: "Bgc", transports: ["internal"] },
    });
  });

  it("serializa autenticacao e preserva userHandle ausente", async () => {
    const response = {
      authenticatorData: new Uint8Array([4]).buffer,
      clientDataJSON: new Uint8Array([5]).buffer,
      signature: new Uint8Array([6]).buffer,
      userHandle: null,
    } as unknown as AuthenticatorAssertionResponse;
    stubCredentialApi({ get: new FakePublicKeyCredential(response) });

    const result = await requestPasskey({ challenge: "AQID", allowCredentials: [] });
    expect(result.response).toEqual({ authenticatorData: "BA", clientDataJSON: "BQ", signature: "Bg" });
  });

  it("classifica cancelamento sem transformar em falha de servidor", async () => {
    stubCredentialApi({});
    vi.mocked(navigator.credentials.get).mockRejectedValueOnce(
      new DOMException("cancelled", "NotAllowedError"),
    );
    await expect(requestPasskey({ challenge: "AQID" })).rejects.toEqual(
      new PasskeyClientError("cancelled"),
    );
  });

  it("distingue origem WebAuthn invalida de autenticador indisponivel", async () => {
    stubCredentialApi({});
    vi.mocked(navigator.credentials.create).mockRejectedValueOnce(
      new DOMException("rp mismatch", "SecurityError"),
    );
    await expect(createPasskey({
      challenge: "AQID",
      rp: { name: "Elyra", id: "localhost" },
      user: { id: "AQID", name: "qa@example.test", displayName: "QA" },
      pubKeyCredParams: [{ alg: -7, type: "public-key" }],
    })).rejects.toMatchObject({ code: "invalid_origin" });
  });
});
