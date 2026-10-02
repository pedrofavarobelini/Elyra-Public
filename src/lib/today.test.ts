import { describe, expect, it } from "vitest";

import type { EmotionalCheckin } from "@/lib/contracts/emotional";
import type { Goal, GoalProgressEntry } from "@/lib/contracts/goals";
import type { JournalEntry } from "@/lib/contracts/journal";
import type { CycleDailyRecord } from "@/lib/contracts/cycle";
import { FATO_HOJE, derivarHoje, diaCivil, type EstadoDeHoje } from "./today";

/**
 * O motor de "Hoje na Elyra".
 *
 * A metade facil e provar que os fatos aparecem. A metade que importa e provar
 * o que **nao** pode acontecer: ausencia virar culpa, zero, cobranca ou
 * conteudo pessoal vazando para o resumo.
 */

const AGORA = new Date("2026-09-18T15:00:00-03:00");
const HOJE = diaCivil(AGORA);
const ONTEM = "2026-09-17";

function checkin(occurredAt: string): EmotionalCheckin {
  return {
    id: `c-${occurredAt}`,
    occurredAt,
    mood: 4,
    perceivedAnxiety: null,
    energy: null,
    primaryFeeling: null,
    factorIds: [],
    note: null,
  };
}

function meta(id: string, recurrence: Goal["recurrence"] = "daily"): Goal {
  return {
    id,
    title: `Meta ${id}`,
    kind: "frequency",
    status: "active",
    recurrence,
    target: 1,
    unit: null,
  } as Goal;
}

function progresso(goalId: string, day: string): GoalProgressEntry {
  return { id: `p-${goalId}-${day}`, goalId, day, amount: 1 };
}

function anotacao(updatedAt: string, status: JournalEntry["status"] = "saved"): JournalEntry {
  return {
    id: `j-${updatedAt}`,
    title: "Anotação",
    content: "Texto íntimo que jamais deve aparecer no resumo de hoje.",
    status,
    createdAt: updatedAt,
    updatedAt,
  } as JournalEntry;
}

function registroCiclo(date: string): CycleDailyRecord {
  return { id: `cc-${date}`, date } as CycleDailyRecord;
}

const VAZIO: EstadoDeHoje = {
  checkins: [],
  goals: [],
  goalProgress: [],
  journal: [],
  cycle: { enabled: false },
  cycleRecords: [],
  pendentes: 0,
};

function fato(estado: Partial<EstadoDeHoje>, tipo: string) {
  return derivarHoje({ ...VAZIO, ...estado }, AGORA).find((f) => f.tipo === tipo);
}

describe("check-in de hoje", () => {
  it("sem registro hoje, convida — e nao cobra", () => {
    const item = fato({}, FATO_HOJE.CHECKIN);
    expect(item?.tom).toBe("convite");
    expect(item?.titulo).toBe("Você ainda não registrou como está hoje");
    expect(item?.acao?.href).toBe("/meu-humor");
  });

  it("registro de ontem nao conta como hoje", () => {
    const item = fato({ checkins: [checkin(`${ONTEM}T22:00:00-03:00`)] }, FATO_HOJE.CHECKIN);
    expect(item?.tom).toBe("convite");
  });

  it("com registro hoje, confirma sem expor o conteudo", () => {
    const item = fato({ checkins: [checkin(`${HOJE}T09:00:00-03:00`)] }, FATO_HOJE.CHECKIN);
    expect(item?.tom).toBe("registro");
    expect(item?.titulo).toBe("Você registrou como está hoje");
    /*
      Nenhum **valor** do check-in vaza para o resumo. "Meu Humor" e nome de
      tela e pode aparecer; o que nao pode e o numero, o sentimento ou a nota.
    */
    const serializado = JSON.stringify(item);
    expect(serializado).not.toMatch(/\b\d+\/10\b|\bmood\b|primaryFeeling|\bnote\b/i);
    expect(serializado).not.toContain('"mood"');
    expect(serializado).not.toMatch(/ansiedade|energia/i);
  });

  it("varios registros no dia sao contados, nao julgados", () => {
    const item = fato(
      { checkins: [checkin(`${HOJE}T09:00:00-03:00`), checkin(`${HOJE}T18:00:00-03:00`)] },
      FATO_HOJE.CHECKIN,
    );
    expect(item?.titulo).toBe("Você fez 2 registros hoje");
    expect(item?.tom).toBe("registro");
  });
});

describe("metas", () => {
  it("sem metas ativas, o item nao existe — e nao vira 'zero metas'", () => {
    expect(fato({}, FATO_HOJE.METAS)).toBeUndefined();
  });

  it("meta aberta e contada como aberta, nunca como atrasada", () => {
    const item = fato({ goals: [meta("g1")] }, FATO_HOJE.METAS);
    expect(item?.titulo).toBe("Você tem 1 meta aberta neste período");
    expect(item?.tom).toBe("convite");
    // O vocabulario de cobranca nao entra.
    expect(`${item?.titulo ?? ""} ${item?.detalhe ?? ""}`).not.toMatch(
      /atrasad|perdeu|falhou|pendência/i,
    );
  });

  it("meta com progresso no periodo sai da contagem de abertas", () => {
    const item = fato(
      { goals: [meta("g1")], goalProgress: [progresso("g1", HOJE)] },
      FATO_HOJE.METAS,
    );
    expect(item?.tom).toBe("registro");
    expect(item?.titulo).toBe("Sua meta já teve progresso neste período");
  });

  it("meta semanal usa o periodo da semana, e nao o dia", () => {
    // Progresso de ontem mantem a meta semanal como ja trabalhada nesta semana.
    const item = fato(
      { goals: [meta("g1", "weekly")], goalProgress: [progresso("g1", ONTEM)] },
      FATO_HOJE.METAS,
    );
    expect(item?.tom).toBe("registro");
  });
});

describe("diario", () => {
  it("sem anotacao hoje, nao ha item: escrever nao e tarefa diaria", () => {
    expect(fato({}, FATO_HOJE.DIARIO)).toBeUndefined();
  });

  it("rascunho nao conta como anotacao do dia", () => {
    expect(
      fato({ journal: [anotacao(`${HOJE}T10:00:00-03:00`, "draft")] }, FATO_HOJE.DIARIO),
    ).toBeUndefined();
  });

  it("com anotacao, confirma sem mostrar uma palavra do texto", () => {
    const item = fato({ journal: [anotacao(`${HOJE}T10:00:00-03:00`)] }, FATO_HOJE.DIARIO);
    expect(item?.titulo).toBe("Você escreveu no Diário hoje");
    expect(JSON.stringify(item)).not.toContain("Texto íntimo");
  });
});

describe("ciclo", () => {
  it("modulo desligado nao aparece nem como convite", () => {
    expect(fato({ cycle: { enabled: false } }, FATO_HOJE.CICLO)).toBeUndefined();
  });

  it("ligado e sem registro, convida deixando claro que nada e estimado", () => {
    const item = fato({ cycle: { enabled: true } }, FATO_HOJE.CICLO);
    expect(item?.tom).toBe("convite");
    expect(item?.detalhe).toContain("Nada é estimado");
  });

  it("ligado e com registro de hoje, confirma", () => {
    const item = fato(
      { cycle: { enabled: true }, cycleRecords: [registroCiclo(HOJE)] },
      FATO_HOJE.CICLO,
    );
    expect(item?.tom).toBe("registro");
  });
});

describe("sincronizacao", () => {
  it("fila vazia nao vira item", () => {
    expect(fato({ pendentes: 0 }, FATO_HOJE.SINCRONIZACAO)).toBeUndefined();
  });

  it("fila pendente explica que o envio e automatico", () => {
    const item = fato({ pendentes: 2 }, FATO_HOJE.SINCRONIZACAO);
    expect(item?.titulo).toBe("2 alterações ainda estão só neste aparelho");
    expect(item?.detalhe).toContain("sozinhas quando a conexão voltar");
    // E nao oferece acao: nao ha nada que a pessoa precise fazer.
    expect(item?.acao).toBeUndefined();
  });
});

describe("a tela inteira", () => {
  it("aparelho sem nenhum dado mostra so o convite de check-in", () => {
    /*
      O caso de quem acabou de chegar. Um painel vazio com quatro zeros diria
      "voce nao fez nada"; o certo e uma porta aberta.
    */
    const fatos = derivarHoje(VAZIO, AGORA);
    expect(fatos).toHaveLength(1);
    expect(fatos[0]?.tipo).toBe(FATO_HOJE.CHECKIN);
    expect(fatos[0]?.tom).toBe("convite");
  });

  it("nenhum fato usa vocabulario de culpa ou de sequencia", () => {
    const completo: EstadoDeHoje = {
      checkins: [],
      goals: [meta("g1")],
      goalProgress: [],
      journal: [],
      cycle: { enabled: true },
      cycleRecords: [],
      pendentes: 3,
    };
    const texto = derivarHoje(completo, AGORA)
      .map((f) => `${f.titulo} ${f.detalhe ?? ""}`)
      .join(" ")
      .toLowerCase();
    for (const proibido of [
      "você não",
      "perdeu",
      "falhou",
      "sequência",
      "streak",
      "atrasad",
      "esqueceu",
      "deveria",
    ]) {
      expect(texto, proibido).not.toContain(proibido);
    }
  });

  it("a ordem e estavel: a tela nao se reorganiza entre visitas", () => {
    const completo: EstadoDeHoje = {
      checkins: [checkin(`${HOJE}T09:00:00-03:00`)],
      goals: [meta("g1")],
      goalProgress: [],
      journal: [anotacao(`${HOJE}T10:00:00-03:00`)],
      cycle: { enabled: true },
      cycleRecords: [],
      pendentes: 1,
    };
    expect(derivarHoje(completo, AGORA).map((f) => f.tipo)).toEqual([
      FATO_HOJE.CHECKIN,
      FATO_HOJE.METAS,
      FATO_HOJE.DIARIO,
      FATO_HOJE.CICLO,
      FATO_HOJE.SINCRONIZACAO,
    ]);
  });

  it("toda acao aponta para uma rota interna do produto", () => {
    const completo: EstadoDeHoje = {
      checkins: [],
      goals: [meta("g1")],
      goalProgress: [],
      journal: [anotacao(`${HOJE}T10:00:00-03:00`)],
      cycle: { enabled: true },
      cycleRecords: [],
      pendentes: 0,
    };
    for (const f of derivarHoje(completo, AGORA)) {
      if (!f.acao) continue;
      expect(f.acao.href.startsWith("/"), f.acao.href).toBe(true);
      expect(f.acao.href).not.toMatch(/^https?:/);
    }
  });
});

describe("diaCivil", () => {
  it("usa o relogio local, e nao UTC", () => {
    // 21h em Sao Paulo ja e o dia seguinte em UTC; o dia da pessoa e o local.
    const noite = new Date("2026-09-18T21:00:00-03:00");
    expect(diaCivil(noite)).toBe("2026-09-18");
  });
});
