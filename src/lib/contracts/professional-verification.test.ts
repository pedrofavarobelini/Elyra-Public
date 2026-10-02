import { describe, expect, it } from "vitest";

import {
  effectiveVerificationStatus,
  professionalCredentialInputSchema,
  verificationReviewInputSchema,
} from "./professional-verification";

const NOW = Date.parse("2026-09-24T12:00:00Z");

describe("estado efetivo de verificacao", () => {
  it("verified dentro da validade continua verified", () => {
    expect(effectiveVerificationStatus("verified", "2027-01-01T00:00:00Z", NOW)).toBe("verified");
  });

  it("verified vencido vale como expired_review, como no banco", () => {
    expect(effectiveVerificationStatus("verified", "2026-09-24T11:59:59Z", NOW)).toBe(
      "expired_review",
    );
  });

  it("verified sem validade nunca vale como verified", () => {
    expect(effectiveVerificationStatus("verified", null, NOW)).toBe("expired_review");
    expect(effectiveVerificationStatus("verified", "data-invalida", NOW)).toBe("expired_review");
  });

  it("estado desconhecido ou legado cai no mais restritivo", () => {
    expect(effectiveVerificationStatus("unverified", null, NOW)).toBe("pending");
    expect(effectiveVerificationStatus(undefined, null, NOW)).toBe("pending");
  });

  it("estados nao verificados passam como sao", () => {
    for (const status of ["pending", "under_review", "rejected", "suspended", "expired_review"]) {
      expect(effectiveVerificationStatus(status, null, NOW)).toBe(status);
    }
  });
});

describe("contratos de entrada", () => {
  it("credencial exige regiao de dois digitos", () => {
    const base = { registrationNumber: "06/123456", specialty: "Psicologia" };
    expect(professionalCredentialInputSchema.safeParse({ ...base, councilRegion: "06" }).success).toBe(true);
    expect(professionalCredentialInputSchema.safeParse({ ...base, councilRegion: "6" }).success).toBe(false);
    expect(professionalCredentialInputSchema.safeParse({ ...base, councilRegion: "00" }).success).toBe(false);
  });

  it("credencial nao aceita campo extra (sem status pelo cliente)", () => {
    expect(
      professionalCredentialInputSchema.safeParse({
        councilRegion: "06",
        registrationNumber: "06/123456",
        specialty: "Psicologia",
        verificationStatus: "verified",
      }).success,
    ).toBe(false);
  });

  it("aprovacao exige digest e validade", () => {
    const base = {
      professionalUserId: "29100000-0000-4000-8000-000000000002",
      toStatus: "verified" as const,
      reasonCode: "registry_active_confirmed" as const,
      source: "cfp_cadastro_nacional_manual" as const,
    };
    expect(verificationReviewInputSchema.safeParse(base).success).toBe(false);
    expect(
      verificationReviewInputSchema.safeParse({ ...base, evidenceDigest: "a".repeat(64), validDays: 365 })
        .success,
    ).toBe(true);
    expect(
      verificationReviewInputSchema.safeParse({ ...base, evidenceDigest: "nao-hex", validDays: 365 })
        .success,
    ).toBe(false);
  });
});
