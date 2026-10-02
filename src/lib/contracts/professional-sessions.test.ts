import { describe, expect, it } from "vitest";

import {
  SESSION_CONSENTS,
  SESSION_CONSENT_COPY,
  dependentsOf,
  professionalSessionDetailSchema,
  sessionActionSchema,
  sessionConsentUpdateSchema,
} from "./professional-sessions";

describe("contrato das sessoes profissionais (PRO-7)", () => {
  it("cinco consentimentos independentes, com dependencia declarada", () => {
    expect(SESSION_CONSENTS).toHaveLength(5);
    expect(dependentsOf("allow_audio")).toEqual(["allow_transcription", "allow_professional_transcript_access"]);
    expect(dependentsOf("allow_video")).toEqual([]);
    expect(dependentsOf("allow_ai_derivation")).toEqual([]);
  });

  it("vocabulario fechado: acao e consentimento fora da lista sao recusados", () => {
    expect(() => sessionActionSchema.parse({ action: "record" })).toThrow();
    expect(() => sessionActionSchema.parse({ action: "enter", token: "x" })).toThrow();
    expect(() => sessionConsentUpdateSchema.parse({ consent: "allow_everything", value: true })).toThrow();
  });

  it("o detalhe nunca carrega token, digest nem texto de transcricao", () => {
    const keys = Object.keys(professionalSessionDetailSchema.shape);
    expect(keys.some((key) => /token|digest|content|transcriptText/i.test(key))).toBe(false);
  });

  it("copy nao clinica, nas duas vozes, e IA explicitamente nao libera nada ao profissional", () => {
    const all = JSON.stringify(SESSION_CONSENT_COPY);
    expect(all).not.toMatch(/diagn|tratamento|terapia|clínic|clinic|paciente/i);
    expect(SESSION_CONSENT_COPY.allow_ai_derivation.proOn).toContain("não libera nada para você");
    for (const consent of SESSION_CONSENTS) {
      expect(SESSION_CONSENT_COPY[consent].proOff).not.toMatch(/\bseu\b|\bsua\b/);
    }
  });
});
