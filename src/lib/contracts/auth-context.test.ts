import { describe, expect, it } from "vitest";

import {
  decodeLastContext,
  encodeLastContext,
  loginPathFor,
  mfaPathFor,
  parseAuthContext,
  professionalHome,
  resolvePostAuthPath,
} from "./auth-context";

const USER = "6f1c2a4e-1b2c-4d3e-8f90-1234567890ab";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("parseAuthContext", () => {
  it("aceita so a allowlist exata", () => {
    expect(parseAuthContext("personal")).toBe("personal");
    expect(parseAuthContext("professional")).toBe("professional");
    for (const raw of ["Professional", " professional", "pro", "admin", "", null, undefined, 1, "https://evil.example"]) {
      expect(parseAuthContext(raw)).toBeNull();
    }
  });
});

describe("resolvePostAuthPath", () => {
  it("intencao profissional (F1): so VERIFIED vai ao cockpit; os demais, pelo estado", () => {
    expect(resolvePostAuthPath({ intent: "professional", lastContext: null, capability: "VERIFIED" })).toBe("/pro/dashboard");
    for (const capability of ["NO_PROFILE", "ONBOARDING"] as const) {
      expect(resolvePostAuthPath({ intent: "professional", lastContext: null, capability })).toBe("/area-profissional/cadastro");
    }
    expect(resolvePostAuthPath({ intent: "professional", lastContext: null, capability: "PENDING_CORRECTION" })).toBe(
      "/area-profissional/cadastro?etapa=revisao",
    );
    for (const capability of ["UNDER_AUTOMATED_REVIEW", "REJECTED", "SUSPENDED", "EXPIRED_REVIEW"] as const) {
      expect(resolvePostAuthPath({ intent: "professional", lastContext: null, capability })).toBe("/area-profissional");
    }
  });

  it("intencao pessoal ganha do ultimo contexto profissional", () => {
    expect(resolvePostAuthPath({ intent: "personal", lastContext: "professional", capability: "VERIFIED" })).toBe("/dashboard");
  });

  it("sem intencao, o ultimo contexto so vale com capacidade profissional", () => {
    expect(resolvePostAuthPath({ intent: null, lastContext: "professional", capability: "VERIFIED" })).toBe("/pro/dashboard");
    expect(resolvePostAuthPath({ intent: null, lastContext: "professional", capability: "UNDER_AUTOMATED_REVIEW" })).toBe("/area-profissional");
    expect(resolvePostAuthPath({ intent: null, lastContext: "professional", capability: "NO_PROFILE" })).toBe("/dashboard");
    expect(resolvePostAuthPath({ intent: null, lastContext: null, capability: "VERIFIED" })).toBe("/dashboard");
  });

  it("deep link seguro ganha de tudo; destino externo ou de Auth e ignorado", () => {
    expect(resolvePostAuthPath({ next: "/pro/vinculos", intent: "personal", lastContext: null, capability: "NO_PROFILE" })).toBe("/pro/vinculos");
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/api/me/export",
      "/auth/callback",
      "/entrar?context=professional",
      "/cadastro",
    ]) {
      expect(resolvePostAuthPath({ next, intent: "professional", lastContext: null, capability: "VERIFIED" })).toBe("/pro/dashboard");
    }
  });
});

describe("cookie de ultimo contexto", () => {
  it("e amarrado a conta", () => {
    const raw = encodeLastContext(USER, "professional");
    expect(decodeLastContext(raw, USER)).toBe("professional");
    expect(decodeLastContext(raw, OTHER)).toBeNull();
  });

  it("valor adulterado vira ausencia de preferencia", () => {
    for (const raw of [`${USER}.admin`, `${USER}`, "professional", `x.${"a".repeat(80)}`, "", null, `${USER}.professional.extra`]) {
      expect(decodeLastContext(raw, USER)).toBeNull();
    }
  });
});

describe("caminhos de entrada", () => {
  it("so rota profissional carrega intencao e destino para o login", () => {
    expect(loginPathFor("/pro/vinculos")).toBe("/entrar?context=professional&next=%2Fpro%2Fvinculos");
    expect(loginPathFor("/pro")).toBe("/entrar?context=professional&next=%2Fpro");
    expect(loginPathFor("/dashboard")).toBe("/entrar");
    expect(loginPathFor("/profissionais")).toBe("/entrar");
    expect(loginPathFor("//evil.example/pro")).toBe("/entrar");
    expect(loginPathFor(null)).toBe("/entrar");
  });

  it("MFA preserva so destino profissional; o pessoal segue o contrato da Stage 27", () => {
    expect(mfaPathFor("/pro/dashboard", "/entrar/verificacao")).toBe("/entrar/verificacao?next=%2Fpro%2Fdashboard");
    expect(mfaPathFor("/dashboard", "/entrar/verificacao")).toBe("/entrar/verificacao");
    expect(mfaPathFor("/diario", "/entrar/verificacao")).toBe("/entrar/verificacao");
    expect(mfaPathFor("/profissionais", "/entrar/verificacao")).toBe("/entrar/verificacao");
    expect(mfaPathFor("https://evil.example", "/entrar/verificacao")).toBe("/entrar/verificacao");
  });

  it("casa profissional", () => {
    expect(professionalHome("VERIFIED")).toBe("/pro/dashboard");
    expect(professionalHome("NO_PROFILE")).toBe("/area-profissional/cadastro");
  });
});
