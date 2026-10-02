import { describe, expect, it } from "vitest";

import {
  APPLE_SIGN_IN_CAPABILITY,
  CAPABILITY_STATUS,
  captureCapability,
  passkeyCapability,
  configuredPasskeyRpId,
  passkeyOriginSupported,
} from "@/lib/capabilities";

describe("modelo de capacidade", () => {
  it("separa configuração externa de incompatibilidade do navegador", () => {
    expect(passkeyCapability(false, true).status)
      .toBe(CAPABILITY_STATUS.EXTERNAL_CONFIGURATION_REQUIRED);
    expect(passkeyCapability(true, false).status)
      .toBe(CAPABILITY_STATUS.UNSUPPORTED_BROWSER);
    expect(passkeyCapability(true, true).status).toBe(CAPABILITY_STATUS.SUPPORTED);
  });

  it("explica quando a origem temporária não corresponde ao RP ID", () => {
    expect(passkeyOriginSupported("localhost")).toBe(true);
    expect(passkeyOriginSupported("preview.trycloudflare.com")).toBe(false);
    expect(passkeyCapability(true, true, false)).toMatchObject({
      status: CAPABILITY_STATUS.CAPABILITY_NOT_AVAILABLE,
      reason: expect.stringContaining("ambiente de teste"),
      alternative: expect.stringContaining("senha"),
    });
  });

  it("aceita o domínio de staging quando o RP ID do ambiente é declarado (Stage 29)", () => {

    // desligado em https://app.example.invalid mesmo com o Supabase
    // configurado para esse domínio.
    const staging = configuredPasskeyRpId(" app.example.invalid ");
    expect(staging).toBe("app.example.invalid");
    expect(passkeyOriginSupported("app.example.invalid", staging)).toBe(true);
    expect(passkeyOriginSupported("localhost", staging)).toBe(false);
    expect(passkeyOriginSupported("other.example.invalid", staging)).toBe(false);
    expect(passkeyOriginSupported("app.example.invalid.evil.test", staging)).toBe(false);
  });

  it("cai em localhost quando o RP ID declarado é ausente ou inválido", () => {
    for (const value of [undefined, "", "https://elyra.app", "elyra.app:443", "elyra.app/x", "127.0.0.1", "-bad.app"]) {
      expect(configuredPasskeyRpId(value)).toBe("localhost");
    }
    expect(passkeyOriginSupported("app.example.invalid", configuredPasskeyRpId(undefined))).toBe(false);
  });

  it("separa permissão negada, cancelamento e recurso indisponível", () => {
    expect(captureCapability("camera", "denied").status)
      .toBe(CAPABILITY_STATUS.PERMISSION_DENIED);
    expect(captureCapability("screen", "cancelled").status)
      .toBe(CAPABILITY_STATUS.NOT_CONFIGURED);
    expect(captureCapability("microphone", "error").status)
      .toBe(CAPABILITY_STATUS.CAPABILITY_NOT_AVAILABLE);
    expect(captureCapability("screen", "unsupported").status)
      .toBe(CAPABILITY_STATUS.UNSUPPORTED_BROWSER);
  });

  it("mantém Apple como configuração externa, sem botão falso", () => {
    expect(APPLE_SIGN_IN_CAPABILITY).toMatchObject({
      status: CAPABILITY_STATUS.EXTERNAL_CONFIGURATION_REQUIRED,
      alternative: expect.stringContaining("Google"),
    });
  });
});
