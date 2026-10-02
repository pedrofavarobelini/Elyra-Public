import { describe, expect, it } from "vitest";

import type { CyclePeriod } from "@/lib/contracts/cycle";
import {
  customCycleSymptomInputSchema,
  cycleDailyRecordInputSchema,
  cyclePeriodInputSchema,
  cyclePeriodSchema,
  FLOW_LEVELS,
  SEVERITIES,
} from "@/lib/contracts/cycle";
import {
  addDays,
  averageCycleLength,
  averagePeriodLength,
  cycleDay,
  cyclesConsidered,
  CYCLE_HEURISTIC_VERSION,
  DEFAULT_CYCLE_LENGTH_DAYS,
  daysBetween,
  daysUntilNextPeriod,
  derivedPhase,
  effectiveCycleLength,
  estimatedNextPeriodStart,
  estimatedOvulation,
  isRegisteredPeriodDay,
  LUTEAL_PHASE_DAYS,
  registeredPeriodBands,
} from "@/lib/cycle";



/** Tres ciclos de 28 dias, periodos de 6 dias. */
const PERIODS: CyclePeriod[] = [
  { id: "p1", startDate: "2026-03-01", endDate: "2026-03-06" },
  { id: "p2", startDate: "2026-03-29", endDate: "2026-04-03" },
  { id: "p3", startDate: "2026-04-26", endDate: "2026-05-01" },
];

describe("aritmetica de datas civis", () => {
  it("soma e subtrai dias atravessando o fim do mes", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("mede a diferenca em dias civis", () => {
    expect(daysBetween("2026-03-01", "2026-03-29")).toBe(28);
    expect(daysBetween("2026-03-29", "2026-03-01")).toBe(-28);
  });
});

describe("media de ciclo", () => {
  it("calcula a media entre inicios consecutivos", () => {
    expect(averageCycleLength(PERIODS)).toBe(28);
    expect(cyclesConsidered(PERIODS)).toBe(2);
  });

  it("retorna null com menos de dois inicios - nao inventa historico", () => {
    expect(averageCycleLength([PERIODS[0] as CyclePeriod])).toBeNull();
    expect(averageCycleLength([])).toBeNull();
  });

  it("cai no padrao declarado quando nao ha media do usuario", () => {
    expect(effectiveCycleLength([])).toBe(DEFAULT_CYCLE_LENGTH_DAYS);
    expect(effectiveCycleLength(PERIODS)).toBe(28);
  });

  it("calcula a duracao media do periodo apenas com periodos encerrados", () => {
    expect(averagePeriodLength(PERIODS)).toBe(6);
    expect(
      averagePeriodLength([{ id: "x", startDate: "2026-05-01", endDate: null }]),
    ).toBeNull();
  });
});

describe("dia do ciclo", () => {
  it("conta a partir do ultimo inicio anterior ou igual a data", () => {
    expect(cycleDay(PERIODS, "2026-04-26")).toBe(1);
    expect(cycleDay(PERIODS, "2026-05-15")).toBe(20);
  });

  it("retorna null antes do primeiro periodo registrado", () => {
    expect(cycleDay(PERIODS, "2026-02-01")).toBeNull();
  });
});

describe("estimativas", () => {
  it("projeta a proxima menstruacao a partir do ultimo inicio", () => {
    expect(estimatedNextPeriodStart(PERIODS)).toBe("2026-05-24");
    expect(daysUntilNextPeriod(PERIODS, "2026-05-15")).toBe(9);
  });

  it("deriva a ovulacao estimada recuando a fase lutea", () => {
    // Heuristica V1 declarada: proximo inicio - LUTEAL_PHASE_DAYS.
    expect(estimatedOvulation(PERIODS)).toBe(
      addDays("2026-05-24", -LUTEAL_PHASE_DAYS),
    );
    expect(estimatedOvulation(PERIODS)).toBe("2026-05-10");
  });

  it("e deterministica: a mesma entrada produz o mesmo resultado", () => {
    const a = estimatedNextPeriodStart(PERIODS);
    const b = estimatedNextPeriodStart([...PERIODS].reverse());
    expect(a).toBe(b);
    expect(estimatedOvulation(PERIODS)).toBe(
      estimatedOvulation([...PERIODS].reverse()),
    );
  });

  it("nao estima sem nenhum periodo registrado", () => {
    expect(estimatedNextPeriodStart([])).toBeNull();
    expect(estimatedOvulation([])).toBeNull();
    expect(daysUntilNextPeriod([], "2026-05-15")).toBeNull();
  });

  it("declara a versao da heuristica em vigor", () => {
    // A versao distingue o contrato V1 do identificador provisorio historico.
    expect(CYCLE_HEURISTIC_VERSION).toBe("elyra-cycle/v1");
  });
});

describe("fase derivada", () => {
  it("marca menstrual dentro de um periodo registrado", () => {
    expect(derivedPhase(PERIODS, "2026-04-28")).toBe("menstrual");
  });

  it("marca ovulatoria na janela em torno da ovulacao estimada", () => {
    // Ciclo de 28 dias: ovulacao estimada no dia 14, janela de +/- 1.
    expect(derivedPhase(PERIODS, "2026-05-09")).toBe("ovulatory");
  });

  it("marca folicular antes e lutea depois da janela", () => {
    expect(derivedPhase(PERIODS, "2026-05-04")).toBe("follicular");
    expect(derivedPhase(PERIODS, "2026-05-15")).toBe("luteal");
  });

  it("nao deriva fase sem base", () => {
    expect(derivedPhase([], "2026-05-15")).toBeNull();
    expect(derivedPhase(PERIODS, "2026-01-01")).toBeNull();
  });
});

describe("periodo registrado x estimado", () => {
  it("reconhece apenas dias dentro de periodos registrados", () => {
    expect(isRegisteredPeriodDay(PERIODS, "2026-04-27")).toBe(true);
    expect(isRegisteredPeriodDay(PERIODS, "2026-05-24")).toBe(false);
  });

  it("as faixas do grafico usam somente periodos registrados", () => {
    // A estimativa de 2026-05-24 nao pode virar faixa: um palpite desenhado
    // igual a um registro apagaria a diferenca entre os dois.
    const bands = registeredPeriodBands(PERIODS, "2026-04-01", "2026-05-31");
    expect(bands).toEqual([
      { from: "2026-04-01", to: "2026-04-03" },
      { from: "2026-04-26", to: "2026-05-01" },
    ]);
  });
});

describe("constraint de periodo", () => {
  it("aceita periodo em curso (endDate nulo)", () => {
    const parsed = cyclePeriodSchema.safeParse({
      id: "p",
      startDate: "2026-05-01",
      endDate: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejeita fim anterior ao inicio", () => {
    const parsed = cyclePeriodSchema.safeParse({
      id: "p",
      startDate: "2026-05-10",
      endDate: "2026-05-01",
    });
    expect(parsed.success).toBe(false);
  });

  it("aceita periodo de um unico dia", () => {
    const parsed = cyclePeriodSchema.safeParse({
      id: "p",
      startDate: "2026-05-10",
      endDate: "2026-05-10",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("contratos persistentes da Stage 07", () => {
  it("ratifica quatro niveis de fluxo e tres severidades", () => {
    expect(FLOW_LEVELS).toEqual(["spotting", "light", "medium", "heavy"]);
    expect(SEVERITIES).toEqual(["leve", "moderada", "intensa"]);
  });

  it("aceita um periodo novo sem id e rejeita intervalo invertido", () => {
    expect(
      cyclePeriodInputSchema.safeParse({
        startDate: "2026-05-01",
        endDate: null,
      }).success,
    ).toBe(true);
    expect(
      cyclePeriodInputSchema.safeParse({
        startDate: "2026-05-02",
        endDate: "2026-05-01",
      }).success,
    ).toBe(false);
  });

  it("rejeita fluxo ou severidade fora dos catalogos fechados", () => {
    expect(
      cycleDailyRecordInputSchema.safeParse({
        date: "2026-05-01",
        flow: "extreme",
        note: null,
        symptoms: [],
      }).success,
    ).toBe(false);
    expect(
      cycleDailyRecordInputSchema.safeParse({
        date: "2026-05-01",
        flow: null,
        note: null,
        symptoms: [{ symptomId: "symptom", severity: 7 }],
      }).success,
    ).toBe(false);
  });

  it("mantem humor, ansiedade, energia e sono fora do registro do ciclo", () => {
    const parsed = cycleDailyRecordInputSchema.parse({
      date: "2026-05-01",
      flow: "light",
      note: null,
      symptoms: [],
      mood: 8,
      anxiety: 2,
      energy: 7,
      sleep: 480,
    });
    expect(parsed).toEqual({
      date: "2026-05-01",
      flow: "light",
      note: null,
      symptoms: [],
    });
  });

  it("normaliza o nome do sintoma proprio e limita o tamanho", () => {
    expect(customCycleSymptomInputSchema.parse({ label: "  Tontura  " })).toEqual(
      { label: "Tontura" },
    );
    expect(
      customCycleSymptomInputSchema.safeParse({ label: "x".repeat(41) }).success,
    ).toBe(false);
  });
});
