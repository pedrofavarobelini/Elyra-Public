import { describe, expect, it } from "vitest";

import {
  buildCrossDomainInputs,
  buildFactorFrequency,
  daysWithGoalProgress,
} from "@/lib/cross-domain";
import type { EmotionalCheckin, EmotionalFactor, SleepRecord } from "@/lib/contracts/emotional";
import type { GoalProgressEntry } from "@/lib/contracts/goals";
import type { JournalEntry } from "@/lib/contracts/journal";

const TZ = "America/Sao_Paulo";
const WINDOW = { from: "2026-03-01", to: "2026-03-10" };

function base() {
  return {
    window: WINDOW,
    timeZone: TZ,
    checkins: [] as EmotionalCheckin[],
    sleep: [] as SleepRecord[],
    factors: [] as EmotionalFactor[],
    journal: [] as JournalEntry[],
    goalProgress: [] as GoalProgressEntry[],
  };
}

function diario(id: string, createdAt: string, over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id,
    title: "t",
    content: "c",
    status: "saved",
    tagIds: [],
    createdAt,
    updatedAt: createdAt,
    trashedAt: null,
    ...over,
  } as JournalEntry;
}

function sono(night: string, durationMinutes: number | null): SleepRecord {
  return { id: night, night, durationMinutes, quality: null } as SleepRecord;
}

describe("buildCrossDomainInputs", () => {
  it("nao propoe cruzamento de um dominio sem nenhum registro na janela", () => {
    expect(buildCrossDomainInputs(base())).toEqual([]);
  });

  it("usa a data civil da pessoa, e nao a data UTC", () => {
    // 23h em Sao Paulo (UTC-3) e o dia seguinte em UTC. O dia da pessoa manda.
    const inputs = buildCrossDomainInputs({
      ...base(),
      journal: [diario("j1", "2026-03-05T23:30:00-03:00")],
    });

    const dias = inputs.find((i) => i.id === "diario-humor")?.days;
    expect(dias?.has("2026-03-05")).toBe(true);
    expect(dias?.has("2026-03-06")).toBe(false);
  });

  it("ignora rascunho e entrada na lixeira", () => {
    const inputs = buildCrossDomainInputs({
      ...base(),
      journal: [
        diario("j1", "2026-03-02T10:00:00-03:00", { status: "draft" }),
        diario("j2", "2026-03-03T10:00:00-03:00", { trashedAt: "2026-03-04T10:00:00-03:00" }),
      ],
    });

    expect(inputs.find((i) => i.id === "diario-humor")).toBeUndefined();
  });

  it("descarta registro fora da janela", () => {
    const inputs = buildCrossDomainInputs({
      ...base(),
      goalProgress: [
        { goalId: "g1", day: "2026-02-20", amount: 1 } as GoalProgressEntry,
        { goalId: "g1", day: "2026-03-04", amount: 1 } as GoalProgressEntry,
      ],
    });

    const dias = inputs.find((i) => i.id === "metas-energia")?.days;
    expect(dias?.size).toBe(1);
    expect(dias?.has("2026-03-04")).toBe(true);
  });

  /**
   * "Dormiu mais" compara a pessoa com ela mesma nesta janela - nunca com uma
   * norma populacional, que o produto nao tem e nao deve ter.
   */
  it("separa sono pela mediana da propria pessoa", () => {
    const inputs = buildCrossDomainInputs({
      ...base(),
      sleep: [sono("2026-03-01", 300), sono("2026-03-02", 420), sono("2026-03-03", 480)],
    });

    const dias = inputs.find((i) => i.id === "sono-humor")?.days;
    // mediana = 420; os dias >= 420 entram.
    expect(dias?.has("2026-03-02")).toBe(true);
    expect(dias?.has("2026-03-03")).toBe(true);
    expect(dias?.has("2026-03-01")).toBe(false);
  });

  it("ausencia de duracao nao vira zero na mediana", () => {
    const inputs = buildCrossDomainInputs({
      ...base(),
      sleep: [sono("2026-03-01", null), sono("2026-03-02", 420), sono("2026-03-03", 480)],
    });

    const dias = inputs.find((i) => i.id === "sono-humor")?.days;
    // Com 420 e 480, a mediana e 450 - se `null` virasse 0, seria 420.
    expect(dias?.has("2026-03-02")).toBe(false);
    expect(dias?.has("2026-03-03")).toBe(true);
  });

  it("escolhe o fator mais registrado e usa o rotulo dele na pergunta", () => {
    const checkin = (id: string, occurredAt: string, factorIds: string[]) =>
      ({ id, occurredAt, mood: 6, perceivedAnxiety: 4, energy: 5, primaryFeeling: null, factorIds, note: null }) as EmotionalCheckin;

    const inputs = buildCrossDomainInputs({
      ...base(),
      factors: [
        { id: "f1", label: "Trabalho", origin: "system", ownerId: null } as EmotionalFactor,
        { id: "f2", label: "Sono", origin: "system", ownerId: null } as EmotionalFactor,
      ],
      checkins: [
        checkin("c1", "2026-03-01T10:00:00-03:00", ["f1"]),
        checkin("c2", "2026-03-02T10:00:00-03:00", ["f1"]),
        checkin("c3", "2026-03-03T10:00:00-03:00", ["f2"]),
      ],
    });

    const fator = inputs.find((i) => i.id === "fator-humor");
    expect(fator?.question).toContain("Trabalho");
    expect(fator?.days.size).toBe(2);
  });
});

describe("buildFactorFrequency", () => {
  const checkin = (id: string, occurredAt: string, factorIds: string[]) =>
    ({
      id,
      occurredAt,
      mood: 6,
      perceivedAnxiety: 4,
      energy: 5,
      primaryFeeling: null,
      factorIds,
      note: null,
    }) as EmotionalCheckin;

  const fator = (id: string, label: string) =>
    ({ id, label, origin: "system", ownerId: null }) as EmotionalFactor;

  /**
   * Dias, e nao check-ins. Quem registra "Trabalho" tres vezes no mesmo dia nao
   * teve tres dias de trabalho - contar check-ins mediria habito de registro em
   * vez de presenca do fator.
   */
  it("conta dias distintos, nao numero de check-ins", () => {
    const freq = buildFactorFrequency({
      ...base(),
      factors: [fator("f1", "Trabalho")],
      checkins: [
        checkin("c1", "2026-03-01T09:00:00-03:00", ["f1"]),
        checkin("c2", "2026-03-01T18:00:00-03:00", ["f1"]),
        checkin("c3", "2026-03-02T09:00:00-03:00", ["f1"]),
      ],
    });

    expect(freq).toHaveLength(1);
    expect(freq[0]?.days).toBe(2);
  });

  it("ordena por dias e desempata pelo rotulo, para a ordem nao oscilar", () => {
    const freq = buildFactorFrequency({
      ...base(),
      factors: [fator("f1", "Sono"), fator("f2", "Alimentação")],
      checkins: [
        checkin("c1", "2026-03-01T09:00:00-03:00", ["f1", "f2"]),
        checkin("c2", "2026-03-02T09:00:00-03:00", ["f1", "f2"]),
      ],
    });

    expect(freq.map((f) => f.label)).toEqual(["Alimentação", "Sono"]);
  });

  it("descarta check-in fora da janela", () => {
    const freq = buildFactorFrequency({
      ...base(),
      factors: [fator("f1", "Trabalho")],
      checkins: [checkin("c1", "2026-02-01T09:00:00-03:00", ["f1"])],
    });

    expect(freq).toEqual([]);
  });

  it("nomeia fator removido em vez de exibir o id cru", () => {
    const freq = buildFactorFrequency({
      ...base(),
      factors: [],
      checkins: [checkin("c1", "2026-03-01T09:00:00-03:00", ["f9"])],
    });

    expect(freq[0]?.label).toBe("Fator removido");
  });
});

describe("daysWithGoalProgress", () => {
  it("conta dias com progresso, nao entradas", () => {
    const dias = daysWithGoalProgress({
      window: WINDOW,
      goalProgress: [
        { goalId: "g1", day: "2026-03-02", amount: 1 } as GoalProgressEntry,
        { goalId: "g2", day: "2026-03-02", amount: 1 } as GoalProgressEntry,
        { goalId: "g1", day: "2026-03-03", amount: 1 } as GoalProgressEntry,
      ],
    });

    expect(dias).toBe(2);
  });

  it("devolve zero dias registrados quando nao ha registro na janela", () => {
    expect(
      daysWithGoalProgress({
        window: WINDOW,
        goalProgress: [{ goalId: "g1", day: "2026-01-01", amount: 1 } as GoalProgressEntry],
      }),
    ).toBe(0);
  });
});
