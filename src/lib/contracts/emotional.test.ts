import { describe, expect, it } from "vitest";

import {
  customFactorInputSchema,
  emotionalCheckinCreateSchema,
  emotionalCheckinInputSchema,
  sleepRecordInputSchema,
} from "@/lib/contracts/emotional";

const valid = {
  mood: 7,
  perceivedAnxiety: null,
  energy: null,
  primaryFeeling: null,
  factorIds: [],
  note: null,
};

describe("emotional contracts", () => {
  it.each([-1, 11, 1.5])("recusa score invalido: %s", (mood) => {
    expect(emotionalCheckinInputSchema.safeParse({ ...valid, mood }).success).toBe(false);
  });

  it("preserva NULL e exige ao menos um valor emocional", () => {
    expect(emotionalCheckinInputSchema.parse(valid)).toEqual(valid);
    expect(
      emotionalCheckinInputSchema.safeParse({ ...valid, mood: null }).success,
    ).toBe(false);
  });

  it("mantem sentimento independente do humor", () => {
    const parsed = emotionalCheckinInputSchema.parse({
      ...valid,
      mood: 10,
      primaryFeeling: "ansioso",
    });
    expect(parsed.primaryFeeling).toBe("ansioso");
  });

  it("recusa campo inesperado e aceita occurredAt opcional na entrada server", () => {
    expect(
      emotionalCheckinCreateSchema.safeParse({ ...valid, ownerId: crypto.randomUUID() })
        .success,
    ).toBe(false);
    expect(
      emotionalCheckinCreateSchema.safeParse({
        ...valid,
        occurredAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });

  it("normaliza label custom e recusa vazio", () => {
    expect(customFactorInputSchema.parse({ label: "  Terapia  " }).label).toBe(
      "Terapia",
    );
    expect(customFactorInputSchema.safeParse({ label: "   " }).success).toBe(false);
  });

  it("sono e separado e nao aceita registro vazio", () => {
    expect(
      sleepRecordInputSchema.safeParse({
        night: "2026-08-25",
        durationMinutes: null,
        quality: null,
      }).success,
    ).toBe(false);
    expect(
      sleepRecordInputSchema.parse({
        night: "2026-08-25",
        durationMinutes: null,
        quality: 0,
      }).quality,
    ).toBe(0);
  });
});
