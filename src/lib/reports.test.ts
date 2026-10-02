import { describe, expect, it } from "vitest";

import type { CyclePeriod } from "@/lib/contracts/cycle";
import type { EmotionalCheckin, SleepRecord } from "@/lib/contracts/emotional";
import {
  ANALYTICS_VERSION,
  REPORT_SCHEMA_VERSION,
  COMPARISON_WINDOW_DAYS,
  MAX_CUSTOM_RANGE_DAYS,
  customRangeRequestSchema,
  liveReportRequestSchema,
  reportRequestSchema,
} from "@/lib/contracts/reports";
import {
  addCivilDays,
  buildAnalyticsReport,
  civilDateInTimeZone,
  civilDaysBetween,
  comparePeriods,
  heatmapBucket,
  inclusiveDayCount,
  mean,
  previousWindow,
  roundMetric,
  windowEndingAt,
} from "@/lib/reports";

const TZ = "America/Sao_Paulo";

function checkin(
  id: string,
  day: string,
  mood: number | null,
  energy: number | null = mood,
): EmotionalCheckin {
  return {
    id,
    occurredAt: `${day}T15:00:00-03:00`,
    mood,
    perceivedAnxiety: mood === null ? null : 10 - mood,
    energy,
    primaryFeeling: null,
    factorIds: [],
    note: null,
  };
}

function report(
  checkins: EmotionalCheckin[],
  options: {
    referenceDate?: string;
    days?: number;
    sleep?: SleepRecord[];
    periods?: CyclePeriod[];
    cycleEnabled?: boolean;
  } = {},
) {
  return buildAnalyticsReport({
    referenceDate: options.referenceDate ?? "2026-03-28",
    days: options.days ?? 7,
    timeZone: TZ,
    checkins,
    sleep: options.sleep ?? [],
    periods: options.periods ?? [],
    cycleEnabled: options.cycleEnabled ?? false,
  });
}

describe("datas, fuso e janelas", () => {
  it("usa boundaries inclusivos e janela anterior contigua do mesmo tamanho", () => {
    const current = windowEndingAt("2026-03-31", 7);
    expect(current).toEqual({ from: "2026-03-25", to: "2026-03-31" });
    expect(previousWindow(current)).toEqual({
      from: "2026-03-18",
      to: "2026-03-24",
    });
  });

  it("faz aritmetica civil sem depender de DST do host", () => {
    expect(addCivilDays("2026-03-31", 1)).toBe("2026-04-01");
    expect(civilDaysBetween("2026-03-01", "2026-04-01")).toBe(31);
  });

  it("converte o mesmo instante conforme o fuso IANA declarado", () => {
    const instant = "2026-03-29T02:30:00.000Z";
    expect(civilDateInTimeZone(instant, TZ)).toBe("2026-03-28");
    expect(civilDateInTimeZone(instant, "UTC")).toBe("2026-03-29");
  });

  it("rejeita janela, data ou fuso invalidos", () => {
    expect(() => windowEndingAt("2026-03-28", 0)).toThrow(RangeError);
    expect(() => addCivilDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => civilDateInTimeZone(new Date(), "Mars/Olympus")).toThrow(
      RangeError,
    );
  });
});

describe("ausencia, media e arredondamento", () => {
  it("mantem NULL diferente de zero", () => {
    expect(mean([null, undefined])).toBeNull();
    expect(mean([null, 0, 10])).toBe(5);
  });

  it("arredonda empate para longe de zero", () => {
    expect(roundMetric(1.25)).toBe(1.3);
    expect(roundMetric(-1.25)).toBe(-1.3);
    expect(roundMetric(null)).toBeNull();
  });

  it("bucketiza heatmap sem transformar ausencia em bucket", () => {
    expect([null, 0, 2.1, 4.1, 6.1, 8.1].map(heatmapBucket)).toEqual([
      null,
      0,
      1,
      2,
      3,
      4,
    ]);
  });

  it("da peso um a cada dia, nao a cada check-in", () => {
    const value = report([
      checkin("a", "2026-03-27", 2),
      checkin("b", "2026-03-27", 10),
      checkin("c", "2026-03-28", 8),
    ]);
    expect(value.metrics.mood.current).toBe(7);
    expect(value.metrics.mood.currentSamples).toBe(2);
    expect(value.series.at(-2)?.mood).toBe(6);
  });
});

describe("comparacao, tendencia e dados insuficientes", () => {
  const enough = [
    checkin("p1", "2026-03-19", 2),
    checkin("p2", "2026-03-20", 4),
    checkin("p3", "2026-03-21", 6),
    checkin("c1", "2026-03-26", 8),
    checkin("c2", "2026-03-27", 6),
    checkin("c3", "2026-03-28", 4),
  ];

  it("publica delta somente com tres dias em cada janela", () => {
    const value = report(enough);
    expect(value.metrics.mood).toMatchObject({
      current: 6,
      previous: 4,
      delta: 2,
      trend: "up",
      currentSamples: 3,
      previousSamples: 3,
    });
  });

  it("mantem a media mas omite delta quando falta base", () => {
    const value = report(enough.slice(0, 2).concat(enough.slice(3, 5)));
    expect(value.metrics.mood.current).not.toBeNull();
    expect(value.metrics.mood.delta).toBeNull();
    expect(value.metrics.mood.trend).toBe("insufficient_data");
  });

  it("mesma entrada em ordem diferente produz a mesma saida", () => {
    expect(report(enough)).toEqual(report([...enough].reverse()));
  });
});

describe("series, ciclo e associacao temporal", () => {
  it("preserva lacunas e converte sono para horas somente na serie", () => {
    const value = report([checkin("a", "2026-03-28", 7)], {
      sleep: [
        {
          id: "s1",
          night: "2026-03-28",
          durationMinutes: 450,
          quality: null,
        },
      ],
    });
    expect(value.series).toHaveLength(7);
    expect(value.series[0]?.mood).toBeNull();
    expect(value.series.at(-1)?.sleepHours).toBe(7.5);
    expect(value.metrics.sleepDurationMinutes.current).toBe(450);
  });

  it("overlay e contagem usam somente periodo registrado", () => {
    const periods: CyclePeriod[] = [
      { id: "p", startDate: "2026-03-25", endDate: "2026-03-27" },
    ];
    const value = report([], { periods, cycleEnabled: true });
    expect(value.cycle.registeredMenstruationDays).toBe(3);
    expect(value.cycle.registeredBands).toEqual([
      { from: "2026-03-25", to: "2026-03-27" },
    ]);
  });

  it("nao analisa periodos preservados quando o acompanhamento esta desligado", () => {
    const value = report(
      [
        checkin("b1", "2026-03-25", 5, 2),
        checkin("b2", "2026-03-26", 5, 3),
        checkin("b3", "2026-03-27", 5, 4),
      ],
      {
        periods: [
          { id: "p", startDate: "2026-03-28", endDate: "2026-03-30" },
        ],
        cycleEnabled: false,
      },
    );
    expect(value.cycle.registeredBands).toEqual([]);
    expect(value.cycle.registeredMenstruationDays).toBeNull();
    expect(value.associations.prePeriodEnergy).toMatchObject({
      status: "insufficient_data",
      beforePeriodSamples: 0,
      delta: null,
    });
  });

  it("associa os tres dias anteriores sem alegar causalidade", () => {
    const periods: CyclePeriod[] = [
      { id: "p", startDate: "2026-03-28", endDate: "2026-03-30" },
    ];
    const values = [
      checkin("b1", "2026-03-25", 5, 2),
      checkin("b2", "2026-03-26", 5, 3),
      checkin("b3", "2026-03-27", 5, 4),
      checkin("o1", "2026-03-22", 5, 6),
      checkin("o2", "2026-03-23", 5, 7),
      checkin("o3", "2026-03-24", 5, 8),
    ];
    const association = report(values, {
      days: 10,
      referenceDate: "2026-03-31",
      periods,
      cycleEnabled: true,
    }).associations.prePeriodEnergy;
    expect(association).toMatchObject({
      status: "available",
      beforePeriodMean: 3,
      otherDaysMean: 7,
      delta: -4,
      beforePeriodSamples: 3,
      otherDaysSamples: 3,
    });
  });

  it("retorna insufficient_data sem amostra minima", () => {
    const association = report([], {
      periods: [
        { id: "p", startDate: "2026-03-28", endDate: "2026-03-30" },
      ],
      cycleEnabled: true,
    }).associations.prePeriodEnergy;
    expect(association.status).toBe("insufficient_data");
    expect(association.delta).toBeNull();
  });
});

describe("contrato versionado", () => {
  it("explicita schema, analytics e heuristica no relatorio", () => {
    const value = report([]);
    expect(value.schemaVersion).toBe(REPORT_SCHEMA_VERSION);
    expect(value.analyticsVersion).toBe(ANALYTICS_VERSION);
    expect(value.cycleHeuristicVersion).toBe("elyra-cycle/v1");
  });

  it("aceita somente ranges de export e fuso validos", () => {
    expect(
      reportRequestSchema.safeParse({
        days: 28,
        referenceDate: "2026-03-28",
        timeZone: TZ,
      }).success,
    ).toBe(true);
    expect(
      reportRequestSchema.safeParse({
        days: 7,
        referenceDate: "2026-03-28",
        timeZone: TZ,
      }).success,
    ).toBe(false);
    expect(
      reportRequestSchema.safeParse({
        days: 28,
        referenceDate: "2026-02-30",
        timeZone: TZ,
      }).success,
    ).toBe(false);
  });
});

describe("Era 2 - janelas comparaveis 7 / 28 / 90", () => {
  it("as tres janelas saem da mesma funcao, com janela anterior contigua e do mesmo tamanho", () => {
    for (const days of COMPARISON_WINDOW_DAYS) {
      const relatorio = report([], { days });
      expect(civilDaysBetween(relatorio.window.from, relatorio.window.to) + 1).toBe(days);
      expect(civilDaysBetween(relatorio.previousWindow.from, relatorio.previousWindow.to) + 1).toBe(days);
      // Contigua: o dia seguinte ao fim da janela anterior e o inicio da atual.
      expect(addCivilDays(relatorio.previousWindow.to, 1)).toBe(relatorio.window.from);
      expect(relatorio.analyticsVersion).toBe(ANALYTICS_VERSION);
    }
  });

  /**
   * A janela de 7 dias e a que mais estressa os minimos. Sem dado suficiente a
   * comparacao precisa dizer `insufficient_data` - e **nao** devolver 0, que
   * afirmaria que a pessoa esteve no pior valor possivel.
   */
  it("7 dias com dado insuficiente devolve insufficient_data, nunca zero", () => {
    const relatorio = report([checkin("c1", "2026-03-27", 6)], { days: 7 });

    expect(relatorio.metrics.mood.trend).toBe("insufficient_data");
    expect(relatorio.metrics.mood.current).not.toBe(0);
    expect(relatorio.metrics.mood.currentSamples).toBe(1);
  });

  it("declara quantos dias tem dado, para a tela poder dizer o minimo", () => {
    const relatorio = report(
      [checkin("c1", "2026-03-27", 6), checkin("c2", "2026-03-26", 7)],
      { days: 7 },
    );

    expect(relatorio.dataQuality.daysInWindow).toBe(7);
    expect(relatorio.dataQuality.daysWithMood).toBe(2);
  });
});

describe("Era 2 - a janela de 7 dias nao pode virar snapshot", () => {
  const base = { referenceDate: "2026-03-28", timeZone: TZ };


  it("a leitura ao vivo aceita 7; o snapshot recusa", () => {
    expect(liveReportRequestSchema.safeParse({ ...base, days: 7 }).success).toBe(true);
    expect(reportRequestSchema.safeParse({ ...base, days: 7 }).success).toBe(false);
  });

  it("as janelas que viram snapshot continuam aceitas nos dois", () => {
    for (const days of [28, 56, 90]) {
      expect(liveReportRequestSchema.safeParse({ ...base, days }).success).toBe(true);
      expect(reportRequestSchema.safeParse({ ...base, days }).success).toBe(true);
    }
  });
});


describe("Era 3 - periodo personalizado", () => {
  it("traduz um intervalo em dias, e e por isso que nao ha motor novo", () => {
    expect(inclusiveDayCount("2026-06-01", "2026-06-01")).toBe(1);
    expect(inclusiveDayCount("2026-06-01", "2026-06-30")).toBe(30);
  });

  it("um periodo personalizado produz o mesmo relatorio que a janela fixa equivalente", () => {
    const checkins = [
      checkin("c1", "2026-06-28", 6),
      checkin("c2", "2026-06-29", 7),
      checkin("c3", "2026-06-30", 8),
    ];
    const base = {
      timeZone: TZ,
      checkins,
      sleep: [],
      periods: [],
      cycleEnabled: false,
    };

    const fixo = buildAnalyticsReport({
      ...base,
      referenceDate: "2026-06-30",
      days: 28,
    });
    const personalizado = buildAnalyticsReport({
      ...base,
      referenceDate: "2026-06-30",
      days: inclusiveDayCount("2026-06-03", "2026-06-30"),
    });

    expect(personalizado.metrics.mood).toEqual(fixo.metrics.mood);
    expect(personalizado.dataQuality.daysInWindow).toBe(28);
  });

  it("recusa fim anterior ao inicio", () => {
    expect(
      customRangeRequestSchema.safeParse({
        from: "2026-06-30",
        to: "2026-06-01",
        timeZone: TZ,
      }).success,
    ).toBe(false);
  });

  it("recusa periodo alem do teto declarado", () => {
    const inicio = "2024-01-01";
    const fim = addCivilDays(inicio, MAX_CUSTOM_RANGE_DAYS);
    expect(
      customRangeRequestSchema.safeParse({ from: inicio, to: fim, timeZone: TZ })
        .success,
    ).toBe(false);
    expect(
      customRangeRequestSchema.safeParse({
        from: inicio,
        to: addCivilDays(inicio, MAX_CUSTOM_RANGE_DAYS - 1),
        timeZone: TZ,
      }).success,
    ).toBe(true);
  });

  it("periodo personalizado nao pode virar snapshot", () => {

    // janela que nao seja 28, 56 ou 90.
    expect(
      reportRequestSchema.safeParse({
        days: 45,
        referenceDate: "2026-06-30",
        timeZone: TZ,
      }).success,
    ).toBe(false);
  });
});

describe("Era 3 - comparacao entre dois periodos escolhidos", () => {
  const checkins = [
    checkin("a1", "2026-06-01", 4),
    checkin("a2", "2026-06-02", 4),
    checkin("a3", "2026-06-03", 4),
    checkin("b1", "2026-07-01", 8),
    checkin("b2", "2026-07-02", 8),
    checkin("b3", "2026-07-03", 8),
  ];

  it("usa a mesma regra: media dos dois lados, delta e base amostral", () => {
    const resultado = comparePeriods({
      timeZone: TZ,
      checkins,
      sleep: [],
      current: { from: "2026-07-01", to: "2026-07-03" },
      baseline: { from: "2026-06-01", to: "2026-06-03" },
    });

    expect(resultado.mood.current).toBe(8);
    expect(resultado.mood.previous).toBe(4);
    expect(resultado.mood.delta).toBe(4);
    expect(resultado.mood.trend).toBe("up");
    expect(resultado.mood.currentSamples).toBe(3);
    expect(resultado.mood.previousSamples).toBe(3);
  });

  it("aceita periodos de tamanhos diferentes, com a amostra dizendo a diferenca", () => {
    const resultado = comparePeriods({
      timeZone: TZ,
      checkins,
      sleep: [],
      current: { from: "2026-07-01", to: "2026-07-03" },
      baseline: { from: "2026-06-01", to: "2026-06-30" },
    });

    expect(resultado.mood.currentSamples).toBe(3);
    expect(resultado.mood.previousSamples).toBe(3);
    expect(resultado.mood.trend).toBe("up");
  });

  it("amostra insuficiente vira ausencia de conclusao, nunca conclusao fraca", () => {
    const resultado = comparePeriods({
      timeZone: TZ,
      checkins,
      sleep: [],
      current: { from: "2026-07-01", to: "2026-07-02" },
      baseline: { from: "2026-06-01", to: "2026-06-03" },
    });

    expect(resultado.mood.currentSamples).toBe(2);
    expect(resultado.mood.trend).toBe("insufficient_data");
    expect(resultado.mood.delta).toBeNull();
  });

  it("ausencia de registro nao vira zero em nenhum dos lados", () => {
    const resultado = comparePeriods({
      timeZone: TZ,
      checkins,
      sleep: [],
      current: { from: "2026-08-01", to: "2026-08-31" },
      baseline: { from: "2026-06-01", to: "2026-06-03" },
    });

    expect(resultado.mood.current).toBeNull();
    expect(resultado.mood.currentSamples).toBe(0);
    expect(resultado.mood.trend).toBe("insufficient_data");
  });
});
