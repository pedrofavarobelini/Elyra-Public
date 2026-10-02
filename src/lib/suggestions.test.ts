import { describe, expect, it } from "vitest";

import type { EmotionalCheckin, EmotionalFactor, SleepRecord } from "@/lib/contracts/emotional";
import { METRICA_LABEL, explorar, perguntaExploravel, reexpressar } from "./explore";
import { SUGESTAO, sugerir, type EstadoDasSugestoes } from "./suggestions";

/**
 * Sugestoes e relatorios exploraveis.
 *
 * As duas garantias centrais: nenhuma sugestao infere estado, causa ou intencao;
 * e nenhuma pergunta de cruzamento vira frase causal ao trocar de metrica.
 */

const AGORA = new Date("2026-09-18T15:00:00-03:00");

const VAZIO: EstadoDasSugestoes = {
  checkins: [],
  goals: [],
  goalProgress: [],
  journal: [],
  cycle: { enabled: false },
  cycleRecords: [],
  pendentes: 0,
  sleep: [],
  factors: [],
};

function checkin(dia: string, factorIds: string[] = []): EmotionalCheckin {
  return {
    id: `c-${dia}-${factorIds.join("")}`,
    occurredAt: `${dia}T10:00:00-03:00`,
    mood: 4,
    perceivedAnxiety: null,
    energy: null,
    primaryFeeling: "neutro",
    factorIds,
    note: null,
  } as EmotionalCheckin;
}
const sono = (night: string, min: number | null): SleepRecord =>
  ({ id: `s-${night}`, night, durationMinutes: min, quality: 4 }) as SleepRecord;
const fator = (id: string, label: string): EmotionalFactor =>
  ({ id, label, origin: "system", ownerId: null }) as EmotionalFactor;

describe("sugestoes", () => {
  it("sem fato que sustente, nao inventa sugestao", () => {
    /*
      Silencio e resposta valida. Preencher a tela com convite generico ensinaria
      a ignorar todos.
    */
    expect(sugerir({ ...VAZIO, checkins: [checkin("2026-09-18")] }, AGORA)).toEqual([]);
  });

  it("o fato do check-in vem do MESMO motor do Hoje na Elyra", () => {
    // Sem check-in hoje -> convite; com check-in -> nada. Uma fonte so.
    expect(sugerir(VAZIO, AGORA)[0]?.id).toBe(SUGESTAO.CHECKIN_HOJE);
    expect(
      sugerir({ ...VAZIO, checkins: [checkin("2026-09-18")] }, AGORA).map((s) => s.id),
    ).not.toContain(SUGESTAO.CHECKIN_HOJE);
  });

  it("sono abaixo do habitual da PROPRIA pessoa vira convite, nao diagnostico", () => {
    const estado: EstadoDasSugestoes = {
      ...VAZIO,
      checkins: [checkin("2026-09-18")],
      sleep: [
        sono("2026-09-17", 300), // a noite recem-passada, bem abaixo
        sono("2026-09-16", 460),
        sono("2026-09-15", 450),
        sono("2026-09-14", 470),
        sono("2026-09-13", 455),
        sono("2026-09-12", 465),
      ],
    };
    const sugestao = sugerir(estado, AGORA).find((s) => s.id === SUGESTAO.SONO_ABAIXO);
    expect(sugestao?.texto).toBe(
      "Você registrou menos horas de sono do que costuma nas últimas noites.",
    );
    // Nao afirma efeito nem estado.
    expect(sugestao?.texto).not.toMatch(/ansios|cansad|afeta|por causa|prejudic|deveria/i);
    expect(sugestao?.acao.href).toBe("/meu-humor");
  });

  it("com poucas noites registradas, nao compara com habito nenhum", () => {
    const estado: EstadoDasSugestoes = {
      ...VAZIO,
      checkins: [checkin("2026-09-18")],
      sleep: [sono("2026-09-17", 200), sono("2026-09-16", 460)],
    };
    expect(sugerir(estado, AGORA).map((s) => s.id)).not.toContain(SUGESTAO.SONO_ABAIXO);
  });

  it("variacao pequena de sono nao vira sugestao", () => {
    const estado: EstadoDasSugestoes = {
      ...VAZIO,
      checkins: [checkin("2026-09-18")],
      sleep: [
        sono("2026-09-17", 430),
        sono("2026-09-16", 460),
        sono("2026-09-15", 450),
        sono("2026-09-14", 470),
        sono("2026-09-13", 455),
        sono("2026-09-12", 465),
      ],
    };
    expect(sugerir(estado, AGORA).map((s) => s.id)).not.toContain(SUGESTAO.SONO_ABAIXO);
  });

  it("registro de sono antigo nao vira sugestao de agora", () => {
    const estado: EstadoDasSugestoes = {
      ...VAZIO,
      checkins: [checkin("2026-09-18")],
      sleep: [
        sono("2026-09-10", 200),
        sono("2026-09-09", 460),
        sono("2026-09-08", 450),
        sono("2026-09-07", 470),
        sono("2026-09-06", 455),
      ],
    };
    expect(sugerir(estado, AGORA).map((s) => s.id)).not.toContain(SUGESTAO.SONO_ABAIXO);
  });

  it("fator recorrente conta DIAS, e nao check-ins", () => {
    const estado: EstadoDasSugestoes = {
      ...VAZIO,
      factors: [fator("f1", "Trabalho")],
      // Tres check-ins no MESMO dia nao sao tres dias.
      checkins: [
        checkin("2026-09-18"),
        { ...checkin("2026-09-17", ["f1"]), id: "a" } as EmotionalCheckin,
        { ...checkin("2026-09-17", ["f1"]), id: "b" } as EmotionalCheckin,
        { ...checkin("2026-09-17", ["f1"]), id: "c" } as EmotionalCheckin,
      ],
    };
    expect(sugerir(estado, AGORA).map((s) => s.id)).not.toContain(SUGESTAO.FATOR_RECENTE);
  });

  it("fator em tres dias vira convite para ver esses dias", () => {
    const estado: EstadoDasSugestoes = {
      ...VAZIO,
      factors: [fator("f1", "Trabalho")],
      checkins: [
        checkin("2026-09-18"),
        checkin("2026-09-17", ["f1"]),
        checkin("2026-09-16", ["f1"]),
        checkin("2026-09-15", ["f1"]),
      ],
    };
    const sugestao = sugerir(estado, AGORA).find((s) => s.id === SUGESTAO.FATOR_RECENTE);
    expect(sugestao?.texto).toBe('Você marcou "Trabalho" em 3 dias recentes.');
    expect(sugestao?.acao.href).toBe("/relatorios");
  });

  it("no maximo duas sugestoes: convite nao vira lista de tarefas", () => {
    const estado: EstadoDasSugestoes = {
      ...VAZIO,
      factors: [fator("f1", "Trabalho")],
      checkins: [
        checkin("2026-09-17", ["f1"]),
        checkin("2026-09-16", ["f1"]),
        checkin("2026-09-15", ["f1"]),
      ],
      sleep: [
        sono("2026-09-17", 300),
        sono("2026-09-16", 460),
        sono("2026-09-15", 450),
        sono("2026-09-14", 470),
        sono("2026-09-13", 455),
      ],
    };
    expect(sugerir(estado, AGORA)).toHaveLength(2);
  });

  it("nenhuma sugestao infere estado, causa ou intencao", () => {
    const estado: EstadoDasSugestoes = {
      ...VAZIO,
      factors: [fator("f1", "Trabalho")],
      checkins: [checkin("2026-09-17", ["f1"]), checkin("2026-09-16", ["f1"]), checkin("2026-09-15", ["f1"])],
    };
    const texto = sugerir(estado, AGORA).map((s) => s.texto).join(" ").toLowerCase();
    for (const proibido of [
      "parece",
      "você está",
      "por causa",
      "porque",
      "afeta",
      "prejudic",
      "deveria",
      "precisa",
      "ansios",
      "depress",
      "estresse",
    ]) {
      expect(texto, proibido).not.toContain(proibido);
    }
  });
});

describe("relatorios exploraveis", () => {
  const entrada = {
    id: "fator-humor",
    question: "Pergunta original da Era 3",
    metric: "mood" as const,
    withLabel: 'Registrei "Trabalho"',
    withoutLabel: "Não registrei",
    days: new Set(["2026-09-17"]),
  };

  it("sem metrica escolhida, devolve as perguntas sugeridas como estavam", () => {
    // O estado inicial da tela: quem nao quer explorar continua vendo o que via.
    expect(explorar([entrada], null)).toEqual([entrada]);
  });

  it("trocar a metrica mantem os MESMOS dias — muda so a pergunta", () => {
    const [saida] = explorar([entrada], "anxiety");
    expect(saida?.days).toBe(entrada.days);
    expect(saida?.metric).toBe("anxiety");
    expect(saida?.question).not.toBe(entrada.question);
  });

  it("o id carrega a metrica, para duas perguntas nao colidirem", () => {
    expect(reexpressar(entrada, "energy").id).toBe("fator-humor:energy");
    expect(reexpressar(entrada, "mood").id).not.toBe(reexpressar(entrada, "energy").id);
  });

  it("NENHUMA pergunta gerada afirma causa", () => {
    /*
      A regra que nao pode ser afrouxada: trocar a metrica nao pode virar porta
      lateral para uma frase causal.
    */
    for (const metrica of ["mood", "anxiety", "energy", "sleepHours"] as const) {
      const pergunta = perguntaExploravel('Registrei "Trabalho"', metrica).toLowerCase();
      expect(pergunta, metrica).toContain("aparece diferente");
      for (const proibido of [
        "causa",
        "porque",
        "por causa",
        "melhora",
        "piora",
        "provoca",
        "faz com que",
        "resulta",
        "impacta",
        "influencia",
      ]) {
        expect(pergunta, `${metrica}: ${proibido}`).not.toContain(proibido);
      }
    }
  });

  it("ansiedade aparece sempre como percebida", () => {
    // O sistema nao mede ansiedade: a pessoa relata.
    expect(METRICA_LABEL.anxiety).toBe("ansiedade percebida");
    expect(perguntaExploravel("Dormi mais", "anxiety")).toContain("ansiedade percebida");
  });
});
