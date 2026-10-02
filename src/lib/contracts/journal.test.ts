import { describe, expect, it } from "vitest";

import {
  customJournalTagInputSchema,
  daysUntilPurge,
  journalSaveInputSchema,
} from "./journal";

describe("journalSaveInputSchema", () => {
  it("aceita rascunho com apenas titulo ou apenas conteudo", () => {
    expect(
      journalSaveInputSchema.safeParse({
        id: "30000000-0000-4000-8000-000000000001",
        title: "Ideia",
        content: "",
        tagIds: [],
        status: "draft",
      }).success,
    ).toBe(true);
    expect(
      journalSaveInputSchema.safeParse({
        title: "",
        content: "Texto",
        tagIds: [],
        status: "saved",
      }).success,
    ).toBe(true);
  });

  it("rejeita identificador que nao seja UUID", () => {
    expect(
      journalSaveInputSchema.safeParse({
        id: "j-1",
        title: "Ideia",
        content: "Texto",
        tagIds: [],
      }).success,
    ).toBe(false);
  });
});

describe("customJournalTagInputSchema", () => {
  it("normaliza espacos e limita o rotulo", () => {
    const parsed = customJournalTagInputSchema.parse({ label: "  Corrida  " });
    expect(parsed.label).toBe("Corrida");
    expect(customJournalTagInputSchema.safeParse({ label: "" }).success).toBe(false);
  });
});

describe("daysUntilPurge", () => {
  it("usa retencao civil de 30 dias sem valores negativos", () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    expect(daysUntilPurge("2026-08-20T12:00:00.000Z", now)).toBe(25);
    expect(daysUntilPurge("2026-07-01T12:00:00.000Z", now)).toBe(0);
    expect(daysUntilPurge(null, now)).toBeNull();
  });
});
