import { describe, expect, it } from "vitest";

import {
  buildDayGroupAssociation,
  describeAssociation,
  type DayGroupInput,
} from "@/lib/associations";
import { MIN_DAYS_FOR_ASSOCIATION, type DailyAnalyticsPoint } from "@/lib/reports";

function ponto(
  date: string,
  mood: number | null,
  sleepHours: number | null = null,
): DailyAnalyticsPoint {
  return {
    date,
    mood,
    anxiety: null,
    energy: null,
    sleepHours,
    moodHeatmapBucket: null,
  };
}

function entrada(days: string[], over: Partial<DayGroupInput> = {}): DayGroupInput {
  return {
    id: "diario-humor",
    question: "Escrevo no diário nos dias melhores?",
    metric: "mood",
    withLabel: "Escrevi no diário",
    withoutLabel: "Não escrevi",
    days: new Set(days),
    ...over,
  };
}

describe("buildDayGroupAssociation", () => {
  const serie = [
    ponto("2026-03-01", 8),
    ponto("2026-03-02", 8),
    ponto("2026-03-03", 8),
    ponto("2026-03-04", 4),
    ponto("2026-03-05", 4),
    ponto("2026-03-06", 4),
  ];

  it("compara os dois grupos e devolve a amostra de cada um", () => {
    const a = buildDayGroupAssociation(
      serie,
      entrada(["2026-03-01", "2026-03-02", "2026-03-03"]),
    );

    expect(a.status).toBe("available");
    expect(a.withGroup.mean).toBe(8);
    expect(a.withGroup.samples).toBe(3);
    expect(a.withoutGroup.mean).toBe(4);
    expect(a.withoutGroup.samples).toBe(3);
    expect(a.delta).toBe(4);
  });

  /**
   * Um lado farto nao compensa o outro escasso: o minimo vale **em cada
   * grupo**. Sem isso, tres dias contra um dia viraria "padrao".
   */
  it("exige o minimo nos dois grupos, nao no total", () => {
    const a = buildDayGroupAssociation(
      serie,
      entrada(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]),
    );

    expect(a.withGroup.samples).toBe(5);
    expect(a.withoutGroup.samples).toBe(1);
    expect(a.withoutGroup.samples).toBeLessThan(MIN_DAYS_FOR_ASSOCIATION);
    expect(a.status).toBe("insufficient_data");
    expect(a.delta).toBeNull();
  });

  /**
   * `NULL != 0`. Um dia sem humor registrado nao pode entrar na media como
   * zero - isso afirmaria que a pessoa esteve no pior valor possivel.
   */
  it("ausencia sai da media dos dois lados, e nunca vira zero", () => {
    const comLacuna = [
      ponto("2026-03-01", 8),
      ponto("2026-03-02", null),
      ponto("2026-03-03", 8),
      ponto("2026-03-04", 8),
      ponto("2026-03-05", 4),
      ponto("2026-03-06", 4),
      ponto("2026-03-07", 4),
    ];

    const a = buildDayGroupAssociation(
      comLacuna,
      entrada(["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04"]),
    );

    expect(a.withGroup.samples).toBe(3);
    expect(a.withGroup.mean).toBe(8);
  });

  it("funciona para qualquer metrica, com a mesma regra", () => {
    const sono = [
      ponto("2026-03-01", null, 8),
      ponto("2026-03-02", null, 8),
      ponto("2026-03-03", null, 8),
      ponto("2026-03-04", null, 6),
      ponto("2026-03-05", null, 6),
      ponto("2026-03-06", null, 6),
    ];

    const a = buildDayGroupAssociation(
      sono,
      entrada(["2026-03-01", "2026-03-02", "2026-03-03"], {
        metric: "sleepHours",
      }),
    );

    expect(a.withGroup.mean).toBe(8);
    expect(a.withoutGroup.mean).toBe(6);
  });
});

describe("describeAssociation - linguagem", () => {
  const serie = [
    ponto("2026-03-01", 8),
    ponto("2026-03-02", 8),
    ponto("2026-03-03", 8),
    ponto("2026-03-04", 4),
    ponto("2026-03-05", 4),
    ponto("2026-03-06", 4),
  ];

  const CAUSAL = /\bcausa(?!\b.*não)|provoca|faz com que|melhora o|piora o|por causa/i;

  it("descreve coincidencia no tempo e nega causa explicitamente", () => {
    const texto = describeAssociation(
      buildDayGroupAssociation(
        serie,
        entrada(["2026-03-01", "2026-03-02", "2026-03-03"]),
      ),
    );

    expect(texto).toContain("coincidência no tempo");
    expect(texto).toContain("não uma causa");
  });

  it("nao usa verbo causal em nenhum dos estados", () => {
    const disponivel = describeAssociation(
      buildDayGroupAssociation(
        serie,
        entrada(["2026-03-01", "2026-03-02", "2026-03-03"]),
      ),
    );
    const insuficiente = describeAssociation(
      buildDayGroupAssociation(serie, entrada(["2026-03-01"])),
    );

    for (const texto of [disponivel, insuficiente]) {
      expect(texto).not.toMatch(/provoca|faz com que|por causa de/i);
    }
    expect(CAUSAL.test(disponivel)).toBe(false);
  });

  /**
   * Dado insuficiente **nao** e ausencia de relacao. Dizer "nao ha relacao"
   * transformaria silencio de dado numa conclusao sobre a pessoa.
   */
  it("dado insuficiente nao vira ausencia de relacao", () => {
    const texto = describeAssociation(
      buildDayGroupAssociation(serie, entrada(["2026-03-01"])),
    );

    expect(texto).toContain("Ainda não dá para descrever");
    expect(texto).toContain("não significa que não exista relação");
  });

  it("declara a amostra de cada grupo quando o dado nao basta", () => {
    const texto = describeAssociation(
      buildDayGroupAssociation(serie, entrada(["2026-03-01"])),
    );

    expect(texto).toContain(`${MIN_DAYS_FOR_ASSOCIATION} dias com registro em cada grupo`);
    expect(texto).toContain("Escrevi no diário: 1");
  });
});
