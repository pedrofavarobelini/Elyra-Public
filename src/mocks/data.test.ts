import { describe, expect, it } from "vitest";

import {
  at,
  MOCK_CHECKINS,
  MOCK_JOURNAL,
  MOCK_SLEEP,
} from "@/mocks/data";


describe("seed de mocks", () => {
  it("nunca gera um instante no futuro, qualquer que seja a hora pedida", () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const value = new Date(at(0, hour, 59)).getTime();
      expect(value).toBeLessThanOrEqual(Date.now());
    }
  });

  it("preserva a ordem relativa entre dois registros do mesmo dia", () => {
    const manha = new Date(at(0, 8, 30));
    const noite = new Date(at(0, 19, 10));
    expect(noite.getTime()).toBeGreaterThan(manha.getTime());
  });

  it("mantem no mesmo dia civil os registros marcados como de hoje", () => {
    // O invariante "multiplos check-ins por dia" depende disto: se um deles
    // escorregasse para ontem, o seed deixaria de demonstrar o que promete.
    const hoje = new Date().toDateString();
    for (const [h, m] of [
      [0, 1],
      [8, 30],
      [19, 10],
      [23, 59],
    ] as const) {
      expect(new Date(at(0, h, m)).toDateString()).toBe(hoje);
    }
  });

  it("nao tem check-in no futuro", () => {
    for (const checkin of MOCK_CHECKINS) {
      expect(new Date(checkin.occurredAt).getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
    }
  });

  it("nao tem anotacao de diario com data futura", () => {
    for (const entry of MOCK_JOURNAL) {
      expect(new Date(entry.createdAt).getTime()).toBeLessThanOrEqual(Date.now());
      expect(new Date(entry.updatedAt).getTime()).toBeLessThanOrEqual(Date.now());
      if (entry.trashedAt) {
        expect(new Date(entry.trashedAt).getTime()).toBeLessThanOrEqual(
          Date.now(),
        );
      }
    }
  });

  it("mantem ausencias reais no seed - NULL nao e zero", () => {
    // A jornada precisa exercitar o caminho da ausencia, nao so o do valor.
    expect(MOCK_CHECKINS.some((c) => c.energy === null)).toBe(true);
    expect(MOCK_SLEEP.some((s) => s.quality === null)).toBe(true);
    expect(MOCK_CHECKINS.every((c) => c.energy !== 0)).toBe(true);
  });
});
