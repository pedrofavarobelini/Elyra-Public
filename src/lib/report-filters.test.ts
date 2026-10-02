import { describe, expect, it } from "vitest";

import type { CyclePeriod } from "@/lib/contracts/cycle";
import type { EmotionalCheckin, SleepRecord } from "@/lib/contracts/emotional";
import type { JournalEntry } from "@/lib/contracts/journal";
import {
  NO_REPORT_FILTERS,
  applyReportFilters,
  hasDayFilter,
  hasReportFilter,
  normalizeSelection,
  type ReportFilterSelection,
} from "@/lib/report-filters";
import { buildAnalyticsReport } from "@/lib/reports";

const TZ = "America/Sao_Paulo";

const TRABALHO = "fator-trabalho";
const TERAPIA = "fator-terapia";
const GRATIDAO = "tag-gratidao";

function checkin(
  id: string,
  day: string,
  mood: number,
  factorIds: string[] = [],
): EmotionalCheckin {
  return {
    id,
    // 12h UTC = 09h em Sao Paulo: o dia civil e o mesmo, sem borda de fuso.
    occurredAt: `${day}T12:00:00.000Z`,
    mood,
    perceivedAnxiety: 10 - mood,
    energy: mood,
    primaryFeeling: null,
    note: null,
    factorIds,
  } as unknown as EmotionalCheckin;
}

function noite(day: string, minutos: number): SleepRecord {
  return { night: day, durationMinutes: minutos } as unknown as SleepRecord;
}

function entrada(id: string, day: string, tagIds: string[]): JournalEntry {
  return {
    id,
    title: "",
    content: "",
    status: "saved",
    tagIds,
    createdAt: `${day}T12:00:00.000Z`,
    updatedAt: `${day}T12:00:00.000Z`,
    trashedAt: null,
  };
}

function selecao(parcial: Partial<ReportFilterSelection>): ReportFilterSelection {
  return { ...NO_REPORT_FILTERS, ...parcial };
}

const CHECKINS = [
  checkin("c1", "2026-06-01", 8, [TRABALHO]),
  checkin("c2", "2026-06-02", 2, [TERAPIA]),
  checkin("c3", "2026-06-03", 8, [TRABALHO, TERAPIA]),
  checkin("c4", "2026-06-04", 2, []),
];

const SLEEP = [
  noite("2026-06-01", 480),
  noite("2026-06-02", 300),
  noite("2026-06-03", 480),
  noite("2026-06-04", 300),
];

const JOURNAL = [
  entrada("j1", "2026-06-01", [GRATIDAO]),
  entrada("j2", "2026-06-04", ["tag-outra"]),
];

function recorte(selection: ReportFilterSelection, periods: CyclePeriod[] = []) {
  return applyReportFilters({
    selection,
    timeZone: TZ,
    checkins: CHECKINS,
    sleep: SLEEP,
    periods,
    journal: JOURNAL,
    cycleEnabled: periods.length > 0,
  });
}

describe("sem recorte, o conjunto e o de antes da Era 3", () => {
  it("devolve tudo quando nada esta filtrado", () => {
    const saida = recorte(NO_REPORT_FILTERS);

    expect(saida.checkins).toHaveLength(4);
    expect(saida.sleep).toHaveLength(4);
    expect(hasReportFilter(NO_REPORT_FILTERS)).toBe(false);
    expect(hasDayFilter(NO_REPORT_FILTERS)).toBe(false);
  });
});

describe("dominio escolhe que registros entram", () => {
  it("tirar sono esvazia o sono, e nao apenas esconde a linha", () => {
    const saida = recorte(selecao({ domains: ["emotional", "cycle"] }));

    expect(saida.checkins).toHaveLength(4);
    expect(saida.sleep).toEqual([]);
    expect(hasReportFilter(selecao({ domains: ["emotional", "cycle"] }))).toBe(true);
  });

  it("tirar ciclo desliga o ciclo do relatorio, e nao so as faixas", () => {
    const periodos: CyclePeriod[] = [
      { id: "p1", startDate: "2026-06-01", endDate: "2026-06-04" },
    ];
    const saida = recorte(selecao({ domains: ["emotional", "sleep"] }), periodos);

    expect(saida.periods).toEqual([]);
    expect(saida.cycleEnabled).toBe(false);
  });
});

describe("fator recorta dias, e diz que recorta dias", () => {
  it("mantem os dias em que o fator foi registrado", () => {
    const saida = recorte(selecao({ factorIds: [TRABALHO] }));

    expect(saida.checkins.map((c) => c.id)).toEqual(["c1", "c3"]);
    // O dia inteiro entra - inclusive o sono daquela noite, que nao tem fator.
    // Sem isso, humor descreveria um conjunto e sono descreveria outro.
    expect(saida.sleep.map((s) => s.night)).toEqual(["2026-06-01", "2026-06-03"]);
  });

  it("dois fatores combinam por OU", () => {
    const saida = recorte(selecao({ factorIds: [TRABALHO, TERAPIA] }));

    expect(saida.checkins.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });
});

describe("tag vem do diario, e so alcanca o dia", () => {
  it("mantem os dias com entrada salva marcada com a tag", () => {
    const saida = recorte(selecao({ journalTagIds: [GRATIDAO] }));

    expect(saida.checkins.map((c) => c.id)).toEqual(["c1"]);
  });

  it("entrada na lixeira nao qualifica o dia", () => {
    const saida = applyReportFilters({
      selection: selecao({ journalTagIds: [GRATIDAO] }),
      timeZone: TZ,
      checkins: CHECKINS,
      sleep: SLEEP,
      periods: [],
      journal: [
        { ...entrada("j1", "2026-06-01", [GRATIDAO]), trashedAt: "2026-06-05T00:00:00.000Z" },
      ],
      cycleEnabled: false,
    });

    expect(saida.checkins).toEqual([]);
  });
});

describe("fase do ciclo e estimativa, e fail-closed", () => {
  const periodos: CyclePeriod[] = [
    { id: "p1", startDate: "2026-06-01", endDate: "2026-06-03" },
  ];

  it("mantem apenas os dias cuja fase derivada foi pedida", () => {
    const saida = recorte(selecao({ cyclePhases: ["menstrual"] }), periodos);

    expect(saida.checkins.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("sem base para derivar, nenhum dia passa", () => {
    // Ciclo desligado: `derivedPhase` nao tem de onde partir. Deixar passar
    // transformaria "nao sei" em "sim".
    const saida = recorte(selecao({ cyclePhases: ["menstrual"] }), []);

    expect(saida.checkins).toEqual([]);
    expect(saida.sleep).toEqual([]);
  });
});

describe("dimensoes diferentes combinam por E", () => {
  it("fator e tag juntos pedem o dia que satisfaz os dois", () => {
    const saida = recorte(
      selecao({ factorIds: [TRABALHO], journalTagIds: [GRATIDAO] }),
    );

    // 01/06 tem os dois; 03/06 tem o fator mas nao a tag.
    expect(saida.checkins.map((c) => c.id)).toEqual(["c1"]);
  });
});


describe("o filtro alcanca o motor deterministico", () => {
  const relatorio = (selection: ReportFilterSelection) => {
    const entrada = recorte(selection);
    return buildAnalyticsReport({
      referenceDate: "2026-06-04",
      days: 4,
      timeZone: TZ,
      checkins: entrada.checkins,
      sleep: entrada.sleep,
      periods: entrada.periods,
      cycleEnabled: entrada.cycleEnabled,
    });
  };

  it("a media muda quando o conjunto muda", () => {
    const inteiro = relatorio(NO_REPORT_FILTERS);
    const filtrado = relatorio(selecao({ factorIds: [TRABALHO] }));

    expect(inteiro.metrics.mood.current).toBe(5);
    expect(filtrado.metrics.mood.current).toBe(8);
  });

  it("a base amostral encolhe junto, e nao fica mentindo", () => {
    const filtrado = relatorio(selecao({ factorIds: [TRABALHO] }));

    // A janela continua tendo 4 dias; o que encolhe e quantos deles tem
    // registro no conjunto analisado. Ausencia continua sendo ausencia.
    expect(filtrado.dataQuality.daysInWindow).toBe(4);
    expect(filtrado.dataQuality.daysWithMood).toBe(2);
    expect(inteiroDaysWithMood()).toBe(4);
  });

  function inteiroDaysWithMood() {
    return relatorio(NO_REPORT_FILTERS).dataQuality.daysWithMood;
  }

  it("amostra insuficiente continua sem conclusao, e nunca conclusao fraca", () => {
    const filtrado = relatorio(selecao({ journalTagIds: [GRATIDAO] }));

    expect(filtrado.dataQuality.daysWithMood).toBe(1);
    expect(filtrado.metrics.mood.trend).toBe("insufficient_data");
    expect(filtrado.metrics.mood.delta).toBeNull();
  });

  it("dominio fora devolve ausencia, e nao zero", () => {
    const filtrado = relatorio(selecao({ domains: ["emotional", "cycle"] }));

    expect(filtrado.metrics.sleepDurationMinutes.current).toBeNull();
    expect(filtrado.metrics.sleepDurationMinutes.currentSamples).toBe(0);
  });
});

describe("normalizacao torna duas geracoes do mesmo estado identicas", () => {
  it("ordena independentemente da ordem de clique", () => {
    const a = normalizeSelection(
      selecao({ domains: ["cycle", "emotional"], factorIds: [TERAPIA, TRABALHO] }),
    );
    const b = normalizeSelection(
      selecao({ domains: ["emotional", "cycle"], factorIds: [TRABALHO, TERAPIA] }),
    );

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
