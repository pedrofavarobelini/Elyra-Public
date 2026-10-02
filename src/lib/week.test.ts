import { describe, expect, it } from "vitest";

import type { EmotionalCheckin, EmotionalFactor, SleepRecord } from "@/lib/contracts/emotional";
import type { Goal, GoalProgressEntry } from "@/lib/contracts/goals";
import type { JournalEntry } from "@/lib/contracts/journal";
import {
  derivarSemana,
  intervaloEmTexto,
  resumoEmTexto,
  semanaAnterior,
  semanaDe,
  type EstadoDaSemana,
} from "./week";

/**
 * A semana conta fatos. Os testes abaixo protegem principalmente o que ela
 * **nao** pode fazer: avaliar a pessoa, transformar ausencia em falta, ou
 * divergir entre a visao e o texto.
 */

// Sexta-feira, 18/09/2026. A semana vai de 14 (seg) a 20 (dom).
const SEXTA = new Date("2026-09-18T15:00:00-03:00");

const VAZIO: EstadoDaSemana = {
  checkins: [],
  sleep: [],
  journal: [],
  goals: [],
  goalProgress: [],
  factors: [],
  cycleRecords: [],
  cicloAtivo: false,
};

function checkin(dia: string, hora = "10:00", factorIds: string[] = []): EmotionalCheckin {
  return {
    id: `c-${dia}-${hora}`,
    occurredAt: `${dia}T${hora}:00-03:00`,
    mood: 4,
    perceivedAnxiety: null,
    energy: null,
    primaryFeeling: "neutro",
    factorIds,
    note: null,
  } as EmotionalCheckin;
}
const sono = (night: string): SleepRecord =>
  ({ id: `s-${night}`, night, durationMinutes: 420, quality: 4 }) as SleepRecord;
const anotacao = (dia: string): JournalEntry =>
  ({
    id: `j-${dia}`,
    title: "t",
    content: "c",
    status: "saved",
    createdAt: `${dia}T10:00:00-03:00`,
    updatedAt: `${dia}T10:00:00-03:00`,
  }) as JournalEntry;
const meta = (id: string): Goal => ({ id, title: `Meta ${id}`, status: "active" }) as Goal;
const progresso = (goalId: string, day: string): GoalProgressEntry => ({
  id: `p-${goalId}-${day}`,
  goalId,
  day,
  amount: 1,
});
const fator = (id: string, label: string): EmotionalFactor =>
  ({ id, label, origin: "system", ownerId: null }) as EmotionalFactor;

describe("o intervalo da semana", () => {
  it("vai de segunda a domingo", () => {
    expect(semanaDe(SEXTA)).toEqual({ inicio: "2026-09-14", fim: "2026-09-20" });
  });

  it("domingo pertence a semana que comecou na segunda anterior", () => {
    // O caso que erra quando alguem usa `getDay()` direto.
    const domingo = new Date("2026-09-20T22:00:00-03:00");
    expect(semanaDe(domingo)).toEqual({ inicio: "2026-09-14", fim: "2026-09-20" });
  });

  it("a semana anterior e a de sete dias antes", () => {
    expect(semanaAnterior(semanaDe(SEXTA))).toEqual({
      inicio: "2026-09-07",
      fim: "2026-09-13",
    });
  });
});

describe("contagem", () => {
  it("conta so o que caiu dentro da semana", () => {
    const resumo = derivarSemana(
      {
        ...VAZIO,
        checkins: [
          checkin("2026-09-14"),
          checkin("2026-09-18"),
          checkin("2026-09-13"), // semana anterior
          checkin("2026-09-21"), // semana seguinte
        ],
      },
      SEXTA,
    );
    expect(resumo.contagem.checkins).toBe(2);
    expect(resumo.contagem.diasComCheckin).toBe(2);
  });

  it("separa quantidade de registros de quantidade de dias", () => {
    const resumo = derivarSemana(
      { ...VAZIO, checkins: [checkin("2026-09-18", "09:00"), checkin("2026-09-18", "20:00")] },
      SEXTA,
    );
    expect(resumo.contagem.checkins).toBe(2);
    expect(resumo.contagem.diasComCheckin).toBe(1);
  });

  it("conta metas com progresso sem confundir com metas ativas", () => {
    const resumo = derivarSemana(
      {
        ...VAZIO,
        goals: [meta("g1"), meta("g2")],
        goalProgress: [progresso("g1", "2026-09-16"), progresso("g1", "2026-09-17")],
      },
      SEXTA,
    );
    expect(resumo.contagem.metasAtivas).toBe(2);
    // Duas entradas da MESMA meta contam como uma meta que avancou.
    expect(resumo.contagem.metasComProgresso).toBe(1);
  });

  it("ciclo desligado nao conta, mesmo com registros na semana", () => {
    const registros = [{ id: "r", date: "2026-09-16", flow: null, symptoms: [], note: null }] as EstadoDaSemana["cycleRecords"];
    expect(
      derivarSemana({ ...VAZIO, cycleRecords: registros, cicloAtivo: false }, SEXTA).contagem
        .registrosDeCiclo,
    ).toBe(0);
    expect(
      derivarSemana({ ...VAZIO, cycleRecords: registros, cicloAtivo: true }, SEXTA).contagem
        .registrosDeCiclo,
    ).toBe(1);
  });
});

describe("fatores mais marcados", () => {
  it("ordena por frequencia e desempata pelo rotulo, para nao trocar sozinho", () => {
    const resumo = derivarSemana(
      {
        ...VAZIO,
        factors: [fator("f1", "Trabalho"), fator("f2", "Sono"), fator("f3", "Estudos")],
        checkins: [
          checkin("2026-09-14", "10:00", ["f1", "f2"]),
          checkin("2026-09-15", "10:00", ["f1", "f3"]),
        ],
      },
      SEXTA,
    );
    expect(resumo.fatores.map((f) => f.label)).toEqual(["Trabalho", "Estudos", "Sono"]);
    expect(resumo.fatores[0]?.total).toBe(2);
  });

  it("fator apagado nao vira linha sem nome", () => {
    const resumo = derivarSemana(
      { ...VAZIO, factors: [], checkins: [checkin("2026-09-14", "10:00", ["sumiu"])] },
      SEXTA,
    );
    expect(resumo.fatores).toEqual([]);
  });
});

describe("ausencia e informacao, nunca cobranca", () => {
  it("lista os dominios sem registro", () => {
    const resumo = derivarSemana({ ...VAZIO, checkins: [checkin("2026-09-18")] }, SEXTA);
    expect(resumo.semRegistro).toContain("sono");
    expect(resumo.semRegistro).toContain("Diário");
    expect(resumo.semRegistro).not.toContain("check-ins");
  });

  it("sem metas ativas, 'progresso de metas' nao aparece como ausencia", () => {
    // Quem nao criou meta nao deixou de fazer nada.
    const resumo = derivarSemana(VAZIO, SEXTA);
    expect(resumo.semRegistro).not.toContain("progresso de metas");
  });

  it("semana sem nada explica o vazio e nao acusa", () => {
    const texto = resumoEmTexto(derivarSemana(VAZIO, SEXTA));
    expect(texto).toEqual(["Ainda não há registros nesta semana."]);
  });
});

describe("resumo em texto", () => {
  const estadoCheio: EstadoDaSemana = {
    ...VAZIO,
    checkins: [checkin("2026-09-14"), checkin("2026-09-16"), checkin("2026-09-18")],
    sleep: [sono("2026-09-15"), sono("2026-09-16")],
    journal: [anotacao("2026-09-17")],
    goals: [meta("g1"), meta("g2")],
    goalProgress: [progresso("g1", "2026-09-16")],
    factors: [fator("f1", "Trabalho")],
  };

  it("conta cada dominio, com plural correto", () => {
    const texto = resumoEmTexto(derivarSemana(estadoCheio, SEXTA)).join(" ");
    expect(texto).toContain("3 check-ins em 3 dias.");
    expect(texto).toContain("2 noites registradas de sono.");
    expect(texto).toContain("1 anotação no Diário.");
    expect(texto).toContain("1 meta avançou");
  });

  it("a variacao e diferenca de contagem, e nunca julgamento", () => {
    const comAnterior: EstadoDaSemana = {
      ...estadoCheio,
      checkins: [...estadoCheio.checkins, checkin("2026-09-08"), checkin("2026-09-09")],
    };
    const texto = resumoEmTexto(derivarSemana(comAnterior, SEXTA)).join(" ");
    expect(texto).toContain("1 check-in a mais que na semana anterior.");
    expect(texto).not.toMatch(/melhor|pior|caiu|piorou|evoluiu|progrediu/i);
  });

  it("nenhuma frase usa vocabulario de culpa ou de sequencia", () => {
    const texto = resumoEmTexto(derivarSemana(estadoCheio, SEXTA)).join(" ").toLowerCase();
    for (const proibido of [
      "você não",
      "perdeu",
      "falhou",
      "sequência",
      "streak",
      "atrasad",
      "esqueceu",
      "deveria",
      "parabéns",
    ]) {
      expect(texto, proibido).not.toContain(proibido);
    }
  });

  it("nao avalia como a pessoa esteve — so conta", () => {
    /* Media emocional e trabalho dos Relatorios, com os avisos que eles carregam. */
    const texto = resumoEmTexto(derivarSemana(estadoCheio, SEXTA)).join(" ").toLowerCase();
    expect(texto).not.toMatch(/humor médio|média de|tendência|padrão|porque|por causa/);
  });

  it("a visao e o texto contam a MESMA coisa", () => {
    const resumo = derivarSemana(estadoCheio, SEXTA);
    const texto = resumoEmTexto(resumo).join(" ");
    // O numero do texto vem do mesmo objeto que a tela usa.
    expect(texto).toContain(`${resumo.contagem.checkins} check-ins`);
    expect(texto).toContain(`${resumo.contagem.anotacoes} anotação`);
  });
});

describe("intervalo por extenso", () => {
  it("nao repete o mes quando a semana cabe nele", () => {
    expect(intervaloEmTexto({ inicio: "2026-09-14", fim: "2026-09-20" })).toBe(
      "14 a 20 de setembro",
    );
  });

  it("nomeia os dois meses quando a semana vira o mes", () => {
    expect(intervaloEmTexto({ inicio: "2026-09-28", fim: "2026-10-04" })).toBe(
      "28 de setembro a 4 de outubro",
    );
  });
});
