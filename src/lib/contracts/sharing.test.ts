import { describe, expect, it } from "vitest";

import {
  RELATIONSHIP_STATUS_LABEL,
  SHARING_SCOPES,
  describeDataWindow,
  grantIsCurrent,
  professionalConnectionActionSchema,
  professionalProfileInputSchema,
  sharingGrantValidityInputSchema,
  sharingDataWindowInputSchema,
  sharingPermissionInputSchema,
} from "@/lib/contracts/sharing";

const connectionId = "11111111-1111-4111-8111-111111111111";
const journalEntryId = "22222222-2222-4222-8222-222222222222";

describe("sharing Stage 10", () => {

  it("congela dez scopes sem colapsar multimodal", () => {
    expect(SHARING_SCOPES).toEqual([
      "emotional",
      "sleep",
      "goals",
      "journal_entry",
      "cycle",
      "reports",
      "multimodal_result",
      "multimodal_transcript",
      "multimodal_ai_interpretation",
      "multimodal_media",
    ]);
  });

  it("o calculo e a interpretacao sao scopes distintos", () => {
    expect(SHARING_SCOPES).toContain("multimodal_result");
    expect(SHARING_SCOPES).toContain("multimodal_ai_interpretation");
    expect(
      new Set(SHARING_SCOPES).size,
    ).toBe(SHARING_SCOPES.length);
  });

  it("exige uma entry para diario e a proibe nos demais scopes", () => {
    expect(
      sharingPermissionInputSchema.safeParse({
        connectionId,
        scope: "journal_entry",
        enabled: true,
      }).success,
    ).toBe(false);
    expect(
      sharingPermissionInputSchema.safeParse({
        connectionId,
        scope: "sleep",
        enabled: true,
        journalEntryId,
      }).success,
    ).toBe(false);
    expect(
      sharingPermissionInputSchema.safeParse({
        connectionId,
        scope: "journal_entry",
        enabled: true,
        journalEntryId,
      }).success,
    ).toBe(true);
  });

  it("recusa scope aberto, expiry passada e campos extras", () => {
    for (const input of [
      { connectionId, scope: "sessions", enabled: true },
      { connectionId, scope: "sleep", enabled: true, expiresAt: "2020-01-01T00:00:00.000Z" },
      { connectionId, scope: "sleep", enabled: true, verified: true },
    ]) {
      expect(sharingPermissionInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("perfil nao aceita campo de verificacao", () => {
    expect(
      professionalProfileInputSchema.safeParse({
        registrationNumber: "QA-123",
        specialty: "Acompanhamento",
        verificationStatus: "verified",
      }).success,
    ).toBe(false);
  });
});

/**
 * A janela de tempo do **dado**, que e coisa diferente de `expiresAt`.
 *
 * `expiresAt` responde "ate quando esta pessoa pode olhar". A janela responde
 * "quais dias ela pode olhar". A V1 so tinha a primeira, e por isso conceder o
 * emocional para falar dos ultimos tres meses entregava tambem os tres anos
 * anteriores.
 */
describe("janela de tempo do dado - Era 3", () => {
  it("aceita janela fechada dos dois lados", () => {
    expect(
      sharingDataWindowInputSchema.safeParse({
        connectionId,
        scope: "emotional",
        dataFrom: "2026-06-01",
        dataTo: "2026-09-01",
      }).success,
    ).toBe(true);
  });

  it("aceita janela aberta de um lado so", () => {
    expect(
      sharingDataWindowInputSchema.safeParse({
        connectionId,
        scope: "sleep",
        dataFrom: "2026-06-01",
        dataTo: null,
      }).success,
    ).toBe(true);
  });

  it("recusa fim anterior ao inicio", () => {
    const resultado = sharingDataWindowInputSchema.safeParse({
      connectionId,
      scope: "emotional",
      dataFrom: "2026-09-01",
      dataTo: "2026-06-01",
    });
    expect(resultado.success).toBe(false);
  });

  it("mantem a regra do diario: escopo por entrada exige a entrada", () => {
    expect(
      sharingDataWindowInputSchema.safeParse({
        connectionId,
        scope: "journal_entry",
        dataFrom: null,
        dataTo: null,
      }).success,
    ).toBe(false);

    expect(
      sharingDataWindowInputSchema.safeParse({
        connectionId,
        scope: "journal_entry",
        journalEntryId,
        dataFrom: null,
        dataTo: null,
      }).success,
    ).toBe(true);
  });
});

describe("describeDataWindow", () => {
  it("diz o que esta sendo concedido, e nao o que esta restrito", () => {
    // "Todo o historico" precisa ser uma frase, nao a ausencia de frase: sem ela
    // a pessoa nao sabe se o campo vazio protege ou libera.
    expect(describeDataWindow(null, null)).toBe("Todo o histórico.");
  });

  it("descreve os dois lados quando existem", () => {
    expect(describeDataWindow("2026-06-01", "2026-09-01")).toBe(
      "Registros de 01/06/2026 a 01/09/2026.",
    );
  });

  it("descreve um lado so quando so um existe", () => {
    expect(describeDataWindow("2026-06-01", null)).toBe(
      "Registros a partir de 01/06/2026.",
    );
    expect(describeDataWindow(null, "2026-09-01")).toBe(
      "Registros até 01/09/2026.",
    );
  });
});

describe("Stage 29 / PRO-3 - grant e relationship", () => {
  const NOW = Date.parse("2026-09-24T12:00:00Z");
  const base = { status: "granted", revoked_at: null, expires_at: null, valid_from: null };

  it("grant vigente espelha a regra do banco", () => {
    expect(grantIsCurrent(base, NOW)).toBe(true);
    expect(grantIsCurrent({ ...base, status: "revoked" }, NOW)).toBe(false);
    expect(grantIsCurrent({ ...base, revoked_at: "2026-09-24T11:00:00Z" }, NOW)).toBe(false);
    expect(grantIsCurrent({ ...base, expires_at: "2026-09-24T12:00:00Z" }, NOW)).toBe(false);
    expect(grantIsCurrent({ ...base, valid_from: "2026-09-25T00:00:00Z" }, NOW)).toBe(false);
    expect(grantIsCurrent({ ...base, valid_from: "2026-09-24T11:59:59Z" }, NOW)).toBe(true);
  });

  it("vigencia exige fim depois do inicio e diario por entrada", () => {
    const connectionId = "29300000-0000-4000-8000-0000000000c1";
    expect(
      sharingGrantValidityInputSchema.safeParse({
        connectionId,
        scope: "emotional",
        validFrom: "2026-09-25T00:00:00Z",
        validUntil: "2026-09-24T00:00:00Z",
      }).success,
    ).toBe(false);
    expect(
      sharingGrantValidityInputSchema.safeParse({
        connectionId,
        scope: "journal_entry",
        validFrom: null,
        validUntil: null,
      }).success,
    ).toBe(false);
    expect(
      sharingGrantValidityInputSchema.safeParse({
        connectionId,
        scope: "emotional",
        validFrom: null,
        validUntil: "2026-10-24T00:00:00Z",
      }).success,
    ).toBe(true);
  });

  it("acoes de relationship sao fechadas", () => {
    const connectionId = "29300000-0000-4000-8000-0000000000c1";
    for (const action of ["accept", "decline", "revoke", "pause", "resume"]) {
      expect(professionalConnectionActionSchema.safeParse({ connectionId, action }).success).toBe(true);
    }
    expect(professionalConnectionActionSchema.safeParse({ connectionId, action: "grant" }).success).toBe(false);
    expect((RELATIONSHIP_STATUS_LABEL as Record<string, string>).accepted).toBeUndefined();
  });
});
