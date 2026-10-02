import { describe, expect, it } from "vitest";

import type { CycleDailyRecord } from "@/lib/contracts/cycle";
import type { EmotionalCheckin, SleepRecord } from "@/lib/contracts/emotional";
import type { Goal, GoalProgressEntry } from "@/lib/contracts/goals";
import type { JournalEntry } from "@/lib/contracts/journal";
import {
  EVENTO,
  FAIXA_LABEL,
  derivarDiasAcompanhados,
  derivarLinhaDoTempo,
  diasDoMes,
  faixaDoDia,
  type EstadoDaJornada,
} from "./journey";

/**
 * A garantia mais importante deste modulo nao e "a lista aparece": e que a
 * linha do tempo e o heatmap **nunca divergem**, porque o segundo e uma
 * agregacao do primeiro.
 */

const VAZIO: EstadoDaJornada = {
  checkins: [],
  sleep: [],
  journal: [],
  goals: [],
  goalProgress: [],
  cycleRecords: [],
  cicloAtivo: false,
};

function checkin(occurredAt: string, primaryFeeling: string | null = "feliz"): EmotionalCheckin {
  return {
    id: `c-${occurredAt}`,
    occurredAt,
    mood: 4,
    perceivedAnxiety: null,
    energy: null,
    primaryFeeling,
    factorIds: [],
    note: "nota privada que nao pode aparecer",
  } as EmotionalCheckin;
}

function sono(night: string, durationMinutes: number | null = 450): SleepRecord {
  return { id: `s-${night}`, night, durationMinutes, quality: 4 } as SleepRecord;
}

function anotacao(updatedAt: string, title = "Título meu"): JournalEntry {
  return {
    id: `j-${updatedAt}`,
    title,
    content: "TEXTO ÍNTIMO QUE NUNCA PODE APARECER NA LINHA DO TEMPO",
    status: "saved",
    createdAt: updatedAt,
    updatedAt,
  } as JournalEntry;
}

const META: Goal = { id: "g1", title: "Caminhar", status: "active" } as Goal;
function progresso(day: string, goalId = "g1"): GoalProgressEntry {
  return { id: `p-${day}-${goalId}`, goalId, day, amount: 1 };
}
function ciclo(date: string): CycleDailyRecord {
  return { id: `cc-${date}`, date, flow: "light", symptoms: [], note: null } as CycleDailyRecord;
}

describe("linha do tempo", () => {
  it("unifica os dominios numa sequencia unica, do mais recente ao mais antigo", () => {
    const eventos = derivarLinhaDoTempo({
      ...VAZIO,
      checkins: [checkin("2026-09-16T09:00:00-03:00")],
      sleep: [sono("2026-09-17")],
      journal: [anotacao("2026-09-18T10:00:00-03:00")],
      goals: [META],
      goalProgress: [progresso("2026-09-15")],
    });
    expect(eventos.map((e) => e.tipo)).toEqual([
      EVENTO.DIARIO,
      EVENTO.SONO,
      EVENTO.CHECKIN,
      EVENTO.META,
    ]);
  });

  it("nao mostra o conteudo do diario nem a nota do check-in", () => {
    const eventos = derivarLinhaDoTempo({
      ...VAZIO,
      checkins: [checkin("2026-09-18T09:00:00-03:00")],
      journal: [anotacao("2026-09-18T10:00:00-03:00")],
    });
    const texto = JSON.stringify(eventos);
    expect(texto).not.toContain("TEXTO ÍNTIMO");
    expect(texto).not.toContain("nota privada");
    // O titulo que a propria pessoa deu continua visivel: e o que a identifica.
    expect(texto).toContain("Título meu");
  });

  it("check-in sem sentimento nao vira 'nenhum' — vira o fato de ter registrado", () => {
    const [evento] = derivarLinhaDoTempo({
      ...VAZIO,
      checkins: [checkin("2026-09-18T09:00:00-03:00", null)],
    });
    expect(evento?.titulo).toBe("Check-in registrado");
  });

  it("sono sem duracao registrada nao inventa horas", () => {
    const [evento] = derivarLinhaDoTempo({ ...VAZIO, sleep: [sono("2026-09-18", null)] });
    expect(evento?.titulo).toBe("Sono registrado");
  });

  it("ciclo desligado nao entra, mesmo com registros guardados", () => {
    /* Desativar o modulo nao apaga dado — mas tambem nao o traz de volta a tela. */
    const comCiclo = { ...VAZIO, cycleRecords: [ciclo("2026-09-18")] };
    expect(derivarLinhaDoTempo({ ...comCiclo, cicloAtivo: false })).toHaveLength(0);
    expect(derivarLinhaDoTempo({ ...comCiclo, cicloAtivo: true })).toHaveLength(1);
  });

  it("progresso de meta apagada nao vira linha orfa", () => {
    const eventos = derivarLinhaDoTempo({
      ...VAZIO,
      goals: [],
      goalProgress: [progresso("2026-09-18", "meta-que-sumiu")],
    });
    expect(eventos).toHaveLength(0);
  });

  it("a ordem e estavel quando dois eventos caem no mesmo instante", () => {
    const estado = {
      ...VAZIO,
      goals: [META, { ...META, id: "g2", title: "Ler" } as Goal],
      goalProgress: [progresso("2026-09-18", "g1"), progresso("2026-09-18", "g2")],
    };
    const primeira = derivarLinhaDoTempo(estado).map((e) => e.id);
    const segunda = derivarLinhaDoTempo(estado).map((e) => e.id);
    expect(primeira).toEqual(segunda);
  });

  it("aparelho sem dado devolve lista vazia, e nao um evento de 'nada'", () => {
    expect(derivarLinhaDoTempo(VAZIO)).toEqual([]);
  });
});

describe("dias acompanhados", () => {
  it("agrega a MESMA sequencia — heatmap e linha do tempo nao podem divergir", () => {
    const estado: EstadoDaJornada = {
      ...VAZIO,
      checkins: [
        checkin("2026-09-18T09:00:00-03:00"),
        checkin("2026-09-18T18:00:00-03:00"),
      ],
      sleep: [sono("2026-09-18")],
      journal: [anotacao("2026-09-17T10:00:00-03:00")],
    };
    const eventos = derivarLinhaDoTempo(estado);
    const dias = derivarDiasAcompanhados(eventos);

    // A soma dos totais do mapa e exatamente o tamanho da sequencia.
    const soma = [...dias.values()].reduce((s, d) => s + d.total, 0);
    expect(soma).toBe(eventos.length);

    expect(dias.get("2026-09-18")?.total).toBe(3);
    expect(dias.get("2026-09-18")?.tipos.sort()).toEqual([EVENTO.CHECKIN, EVENTO.SONO].sort());
    expect(dias.get("2026-09-17")?.total).toBe(1);
  });

  it("dia sem registro nao existe no mapa — ausencia nao e zero", () => {
    const dias = derivarDiasAcompanhados(
      derivarLinhaDoTempo({ ...VAZIO, checkins: [checkin("2026-09-18T09:00:00-03:00")] }),
    );
    expect(dias.has("2026-09-17")).toBe(false);
  });
});

describe("faixas do calendario", () => {
  it("cada faixa tem nome legivel: a cor nunca e a unica informacao", () => {
    expect(faixaDoDia(0)).toBe("sem-registro");
    expect(faixaDoDia(1)).toBe("leve");
    expect(faixaDoDia(3)).toBe("media");
    expect(faixaDoDia(9)).toBe("intensa");
    for (const faixa of ["sem-registro", "leve", "media", "intensa"] as const) {
      expect(FAIXA_LABEL[faixa].length).toBeGreaterThan(0);
    }
  });

  it("o rotulo de ausencia nao carrega julgamento", () => {
    expect(FAIXA_LABEL["sem-registro"]).toBe("sem registro");
    expect(FAIXA_LABEL["sem-registro"]).not.toMatch(/perdid|falha|vazio|nada/i);
  });
});

describe("diasDoMes", () => {
  it("conhece o tamanho real do mes, inclusive fevereiro bissexto", () => {
    expect(diasDoMes("2026-09")).toHaveLength(30);
    expect(diasDoMes("2026-02")).toHaveLength(28);
    expect(diasDoMes("2028-02")).toHaveLength(29);
    expect(diasDoMes("2026-01")[0]).toBe("2026-01-01");
  });

  it("mes invalido devolve vazio em vez de quebrar a tela", () => {
    expect(diasDoMes("")).toEqual([]);
    expect(diasDoMes("xxxx-yy")).toEqual([]);
  });
});
