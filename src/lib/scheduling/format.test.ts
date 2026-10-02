import { describe, expect, it } from "vitest";

import { findOverlappingRule, isKnownTimezone } from "@/lib/contracts/scheduling";
import {
  clockToMinutes,
  describeRule,
  differsFromViewer,
  formatDayHeading,
  formatTime,
  groupByLocalDay,
  minutesToClock,
  timezoneLabel,
} from "./format";

describe("fuso da agenda", () => {
  it("aceita so regiao IANA, nunca deslocamento fixo nem UTC", () => {
    expect(isKnownTimezone("America/Sao_Paulo")).toBe(true);
    expect(isKnownTimezone("Europe/Lisbon")).toBe(true);
    for (const invalid of ["UTC", "Etc/GMT+3", "-03:00", "GMT-3", "America/Atlantida", "", "BRT"]) {
      expect(isKnownTimezone(invalid), invalid).toBe(false);
    }
  });

  it("mostra a hora no fuso do horario, com horario de verao resolvido", () => {
    // 2026-03-08: Nova York pula de 02:00 para 03:00.
    expect(formatTime("2026-03-08T06:30:00Z", "America/New_York")).toBe("01:30");
    expect(formatTime("2026-03-08T07:00:00Z", "America/New_York")).toBe("03:00");
    // 2026-11-01: 01:00 acontece duas vezes; instantes distintos, mesma hora de parede.
    expect(formatTime("2026-11-01T05:00:00Z", "America/New_York")).toBe("01:00");
    expect(formatTime("2026-11-01T06:00:00Z", "America/New_York")).toBe("01:00");
    // Sao Paulo nao tem horario de verao desde 2019.
    expect(formatTime("2026-10-18T13:00:00Z", "America/Sao_Paulo")).toBe("10:00");
  });

  it("so avisa a hora local quando o relogio de quem ve e outro", () => {
    const iso = "2026-10-01T17:00:00Z";
    expect(differsFromViewer(iso, "America/Sao_Paulo", "America/Sao_Paulo")).toBe(false);
    expect(differsFromViewer(iso, "America/Sao_Paulo", "America/Bahia")).toBe(false);
    expect(differsFromViewer(iso, "America/Sao_Paulo", "Europe/Lisbon")).toBe(true);
    expect(differsFromViewer(iso, "America/Sao_Paulo", null)).toBe(false);
  });

  it("agrupa por dia local do fuso do horario, nao do UTC", () => {
    const groups = groupByLocalDay([
      { startsAt: "2026-10-02T01:30:00Z", timezone: "America/Sao_Paulo" }, // 1/out 22:30
      { startsAt: "2026-10-01T12:00:00Z", timezone: "America/Sao_Paulo" },
      { startsAt: "2026-10-02T12:00:00Z", timezone: "America/Sao_Paulo" },
    ]);
    expect(groups.map((group) => group.items.length)).toEqual([2, 1]);
  });

  it("titulo do dia em pt-BR: so a primeira letra maiuscula", () => {
    expect(formatDayHeading("2026-09-25T15:00:00Z", "America/Sao_Paulo")).toBe("Sexta-feira, 25 de setembro");
  });

  it("descreve o intervalo em linguagem humana", () => {
    expect(describeRule(0, 1440, 50)).toBe("Das 00:00 às 24:00 · 28 horários de 50 min");
    expect(describeRule(540, 600, 60)).toBe("Das 09:00 às 10:00 · 1 horário de 60 min");
  });

  it("nomeia o fuso por extenso", () => {
    expect(timezoneLabel("America/Sao_Paulo")).toBe("horário de São Paulo");
    expect(timezoneLabel("America/New_York")).toBe("horário de New York");
  });
});

describe("intervalos de disponibilidade", () => {
  it("converte relogio e minutos, com meia-noite de fim de dia", () => {
    expect(clockToMinutes("09:30")).toBe(570);
    expect(clockToMinutes("00:00", { isEnd: true })).toBe(1440);
    expect(clockToMinutes("24:00")).toBeNull();
    expect(clockToMinutes("9:30")).toBeNull();
    expect(minutesToClock(1440)).toBe("24:00");
  });

  it("detecta sobreposicao so no mesmo dia", () => {
    const base = { slotMinutes: 60 as const, modality: "online" as const };
    expect(
      findOverlappingRule([
        { weekday: 1, startMinute: 540, endMinute: 720, ...base },
        { weekday: 1, startMinute: 700, endMinute: 800, ...base },
      ]),
    ).toBe(1);
    expect(
      findOverlappingRule([
        { weekday: 1, startMinute: 540, endMinute: 720, ...base },
        { weekday: 1, startMinute: 720, endMinute: 800, ...base },
        { weekday: 2, startMinute: 540, endMinute: 720, ...base },
      ]),
    ).toBeNull();
  });
});
