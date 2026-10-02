import { describe, expect, it } from "vitest";

import { EVENTO, type EventoJornada } from "@/lib/journey";
import {
  CONQUISTA,
  ENGAJAMENTO_TERMOS_PROIBIDOS,
  consistenciaDaSemana,
  derivarConquistas,
} from "./achievements";

/**
 * O gate com maior risco de virar gamificacao.
 *
 * Os testes abaixo protegem sobretudo o que **nao** pode existir: streak,
 * ranking, pontos, lista de pendencias e conquista que volta atras.
 */

function evento(tipo: EventoJornada["tipo"], dia: string, i = 0): EventoJornada {
  return {
    id: `${tipo}-${dia}-${i}`,
    tipo,
    dia,
    ordem: `${dia}T12:00:00`,
    titulo: "x",
    href: "/historico",
  };
}

describe("conquistas", () => {
  it("aparelho sem registro nao tem conquista — e nem lista de pendencias", () => {
    /*
      Mostrar o que falta transformaria a tela num painel de tarefas, que e o
      oposto do 8.12.
    */
    expect(derivarConquistas([])).toEqual([]);
  });

  it("o primeiro registro de cada tipo vira marco", () => {
    const ids = derivarConquistas([
      evento(EVENTO.CHECKIN, "2026-09-01"),
      evento(EVENTO.DIARIO, "2026-09-01"),
      evento(EVENTO.META, "2026-09-01"),
    ]).map((c) => c.id);
    expect(ids).toContain(CONQUISTA.PRIMEIRO_CHECKIN);
    expect(ids).toContain(CONQUISTA.PRIMEIRA_ANOTACAO);
    expect(ids).toContain(CONQUISTA.PRIMEIRA_META);
  });

  it("so registro de sono nao gera marco de check-in", () => {
    const ids = derivarConquistas([evento(EVENTO.SONO, "2026-09-01")]).map((c) => c.id);
    expect(ids).not.toContain(CONQUISTA.PRIMEIRO_CHECKIN);
  });

  it("10 registros e contagem da propria sequencia, sem contador paralelo", () => {
    const poucos = Array.from({ length: 9 }, (_, i) =>
      evento(EVENTO.CHECKIN, "2026-09-01", i),
    );
    expect(derivarConquistas(poucos).map((c) => c.id)).not.toContain(CONQUISTA.DEZ_REGISTROS);

    const dez = [...poucos, evento(EVENTO.CHECKIN, "2026-09-01", 9)];
    const conquista = derivarConquistas(dez).find((c) => c.id === CONQUISTA.DEZ_REGISTROS);
    expect(conquista?.detalhe).toBe("Você já tem 10 registros na Elyra.");
  });

  it("7 dias acompanhados conta DIAS, e nao registros", () => {
    // Dez registros no mesmo dia nao sao sete dias de acompanhamento.
    const mesmoDia = Array.from({ length: 10 }, (_, i) =>
      evento(EVENTO.CHECKIN, "2026-09-01", i),
    );
    expect(derivarConquistas(mesmoDia).map((c) => c.id)).not.toContain(CONQUISTA.SETE_DIAS);

    const seteDias = Array.from({ length: 7 }, (_, i) =>
      evento(EVENTO.CHECKIN, `2026-09-0${i + 1}`),
    );
    expect(derivarConquistas(seteDias).map((c) => c.id)).toContain(CONQUISTA.SETE_DIAS);
  });

  it("'um mes' e distancia entre o primeiro e o ultimo — nao 30 dias seguidos", () => {
    /*
      Quem registrou no dia 1 e no dia 31 acompanhou por um mes, mesmo tendo
      descansado no meio. Exigir os dias do meio seria streak com outro nome.
    */
    const ids = derivarConquistas([
      evento(EVENTO.CHECKIN, "2026-08-01"),
      evento(EVENTO.CHECKIN, "2026-08-31"),
    ]).map((c) => c.id);
    expect(ids).toContain(CONQUISTA.UM_MES);
  });

  it("a ordem de exibicao e sempre a mesma", () => {
    const eventos = [
      evento(EVENTO.META, "2026-09-05"),
      evento(EVENTO.DIARIO, "2026-09-03"),
      evento(EVENTO.CHECKIN, "2026-09-01"),
    ];
    expect(derivarConquistas(eventos).map((c) => c.id)).toEqual([
      CONQUISTA.PRIMEIRO_CHECKIN,
      CONQUISTA.PRIMEIRA_ANOTACAO,
      CONQUISTA.PRIMEIRA_META,
    ]);
  });

  it("nenhuma conquista usa vocabulario de jogo, cobranca ou elogio", () => {
    const eventos = [
      ...Array.from({ length: 10 }, (_, i) => evento(EVENTO.CHECKIN, `2026-08-0${(i % 9) + 1}`, i)),
      evento(EVENTO.DIARIO, "2026-08-10"),
      evento(EVENTO.META, "2026-08-11"),
      evento(EVENTO.CHECKIN, "2026-09-12"),
    ];
    const copy = derivarConquistas(eventos)
      .map((c) => `${c.titulo} ${c.detalhe}`)
      .join(" ")
      .toLowerCase();
    for (const termo of ENGAJAMENTO_TERMOS_PROIBIDOS) {
      expect(copy, termo).not.toContain(termo);
    }
  });

  it("conquista nao volta atras quando chegam mais registros", () => {
    // Marco que pode ser retirado e punicao com outro nome.
    const base = Array.from({ length: 7 }, (_, i) => evento(EVENTO.CHECKIN, `2026-09-0${i + 1}`));
    const antes = derivarConquistas(base).map((c) => c.id);
    const depois = derivarConquistas([...base, evento(EVENTO.SONO, "2026-09-20")]).map((c) => c.id);
    for (const id of antes) expect(depois, id).toContain(id);
  });
});

describe("consistencia da semana", () => {
  it("descreve dias acompanhados, e nunca dias seguidos", () => {
    expect(consistenciaDaSemana(4)).toBe("4 dias de acompanhamento nesta semana.");
    expect(consistenciaDaSemana(1)).toBe("1 dia de acompanhamento nesta semana.");
  });

  it("semana sem registro e descrita, nao cobrada", () => {
    const frase = consistenciaDaSemana(0);
    expect(frase).toBe("Ainda não há dias com registro nesta semana.");
    expect(frase.toLowerCase()).not.toMatch(/perdeu|falhou|você não|voltar/);
  });

  it("nenhuma frase carrega vocabulario de sequencia", () => {
    for (const dias of [0, 1, 3, 7]) {
      const frase = consistenciaDaSemana(dias).toLowerCase();
      for (const termo of ENGAJAMENTO_TERMOS_PROIBIDOS) {
        expect(frase, `${dias}: ${termo}`).not.toContain(termo);
      }
    }
  });
});
