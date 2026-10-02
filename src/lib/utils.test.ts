import { describe, expect, it } from "vitest";

import { cn, formatDuration, formatScore } from "./utils";

describe("cn", () => {
  it("resolve conflito de classes do Tailwind mantendo a ultima", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("ignora valores falsos", () => {
    expect(cn("a", false, undefined, null, "b")).toBe("a b");
  });
});

describe("formatScore", () => {
  it("formata score com uma casa decimal e virgula", () => {
    expect(formatScore(4.2)).toBe("4,2");
    expect(formatScore(10)).toBe("10,0");
  });

  it("NULL nao e zero: ausencia retorna null", () => {
    expect(formatScore(null)).toBeNull();
    expect(formatScore(undefined)).toBeNull();
  });

  it("zero e um valor real e deve ser formatado", () => {
    expect(formatScore(0)).toBe("0,0");
  });
});

describe("formatDuration", () => {
  it("formata horas e minutos", () => {
    expect(formatDuration(432)).toBe("7h 12m");
  });

  it("omite horas quando menor que uma hora", () => {
    expect(formatDuration(45)).toBe("45m");
  });

  it("ausencia retorna null", () => {
    expect(formatDuration(null)).toBeNull();
  });
});
