import { describe, expect, it } from "vitest";

import { PRIMARY_GOALS } from "@/lib/contracts/identity";
import { planoPara } from "@/lib/personal-plan";
import {
  ROTINAS,
  ROTINA_TERMOS_PROIBIDOS,
  duracaoEmTexto,
  duracaoTotal,
  posicaoEm,
  rotinaPorId,
} from "./routines";

/**
 * Rotinas e plano pessoal.
 *
 * As duas garantias que importam aqui: nenhuma rotina promete efeito clinico, e
 * o avanco dos passos acerta as bordas — a virada exata e o tempo alem do fim,
 * que e onde um player costuma travar no ultimo passo ou pular o primeiro.
 */

describe("conteudo das rotinas", () => {
  it("toda rotina tem nome, descricao e passos com tempo", () => {
    expect(ROTINAS.length).toBeGreaterThan(0);
    for (const rotina of ROTINAS) {
      expect(rotina.nome.length, rotina.id).toBeGreaterThan(0);
      expect(rotina.descricao.length, rotina.id).toBeGreaterThan(0);
      expect(rotina.passos.length, rotina.id).toBeGreaterThan(1);
      for (const passo of rotina.passos) {
        expect(passo.texto.length, rotina.id).toBeGreaterThan(0);
        expect(passo.segundos, rotina.id).toBeGreaterThan(0);
      }
    }
  });

  it("os ids sao unicos", () => {
    const ids = ROTINAS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("NENHUMA copy apresenta rotina como tratamento", () => {
    /*
      A regra central do 8.7. "Rotina para ansiedade" ou "reduz o estresse"
      seriam promessa clinica — e a Elyra nao faz nenhuma.
    */
    for (const rotina of ROTINAS) {
      const copy = [rotina.nome, rotina.descricao, ...rotina.passos.map((p) => p.texto)]
        .join(" ")
        .toLowerCase();
      for (const termo of ROTINA_TERMOS_PROIBIDOS) {
        expect(copy, `"${termo}" em ${rotina.id}`).not.toContain(termo);
      }
    }
  });

  it("os nomes sao acoes, e nao indicacoes", () => {
    /*
      "Respirar com calma" e "Preparar para dormir" convidam a fazer algo.
      "Rotina para ansiedade" indicaria uma condicao — e e isso que nao pode.
      Barrar todo " para " seria largo demais: reprovaria o nome correto, e um
      gate que reprova o texto certo acaba desligado.
    */
    for (const rotina of ROTINAS) {
      const nome = rotina.nome.toLowerCase();
      expect(nome, rotina.id).not.toMatch(/^rotina\b/);
      expect(nome, rotina.id).not.toMatch(/\b(para|contra)\s+(a|o)?\s*(ansiedade|estresse|insônia|tristeza|crise)\b/);
    }
  });

  it("cada rotina cabe em poucos minutos", () => {
    // Uma rotina de 15 minutos nao e feita no intervalo entre duas aulas.
    for (const rotina of ROTINAS) {
      expect(duracaoTotal(rotina), rotina.id).toBeLessThanOrEqual(5 * 60);
    }
  });

  it("rotinaPorId devolve null para id desconhecido, em vez de quebrar", () => {
    expect(rotinaPorId("nao-existe")).toBeNull();
    expect(rotinaPorId("respirar")?.id).toBe("respirar");
  });
});

describe("duracao em texto", () => {
  it("formata minutos e segundos de forma legivel", () => {
    const fake = { id: "x", nome: "x", descricao: "x", passos: [{ texto: "a", segundos: 45 }] };
    expect(duracaoEmTexto(fake as never)).toBe("45 s");
    expect(duracaoEmTexto({ ...fake, passos: [{ texto: "a", segundos: 120 }] } as never)).toBe(
      "2 min",
    );
    expect(duracaoEmTexto({ ...fake, passos: [{ texto: "a", segundos: 90 }] } as never)).toBe(
      "1 min 30 s",
    );
  });
});

describe("avanco dos passos", () => {
  const rotina = {
    id: "t",
    nome: "t",
    descricao: "t",
    passos: [
      { texto: "um", segundos: 10 },
      { texto: "dois", segundos: 20 },
      { texto: "tres", segundos: 30 },
    ],
  } as never;

  it("comeca no primeiro passo", () => {
    expect(posicaoEm(rotina, 0)).toEqual({ indice: 0, restante: 10, terminou: false });
  });

  it("vira no instante exato, e nao um segundo depois", () => {
    // A borda que costuma escapar: `decorridos === soma dos anteriores`.
    expect(posicaoEm(rotina, 10).indice).toBe(1);
    expect(posicaoEm(rotina, 30).indice).toBe(2);
  });

  it("conta o restante do passo atual", () => {
    expect(posicaoEm(rotina, 15)).toEqual({ indice: 1, restante: 15, terminou: false });
  });

  it("termina exatamente no total, e continua terminada depois", () => {
    expect(posicaoEm(rotina, 60)).toEqual({ indice: 3, restante: 0, terminou: true });
    expect(posicaoEm(rotina, 999)).toEqual({ indice: 3, restante: 0, terminou: true });
  });
});

describe("plano pessoal", () => {
  it("todo objetivo tem um caminho, e nenhum fica sem plano", () => {
    for (const objetivo of PRIMARY_GOALS) {
      const plano = planoPara(objetivo);
      expect(plano.passos.length, objetivo).toBeGreaterThan(0);
      expect(plano.chamada.length, objetivo).toBeGreaterThan(0);
    }
  });

  it("quem nao escolheu objetivo ve o caminho geral, e nao uma cobranca", () => {
    const plano = planoPara(null);
    expect(plano.passos.length).toBeGreaterThan(0);
    expect(plano.chamada.toLowerCase()).not.toMatch(/escolha|defina|complete|falta/);
  });

  it("o plano organiza — nao promete resultado", () => {
    for (const objetivo of [...PRIMARY_GOALS, null]) {
      const plano = planoPara(objetivo);
      const copy = [plano.chamada, ...plano.passos.map((p) => p.descricao)]
        .join(" ")
        .toLowerCase();
      for (const termo of [
        "vai melhorar",
        "garante",
        "trata",
        "cura",
        "resolve",
        "você precisa",
        "deveria",
        "recomendamos",
      ]) {
        expect(copy, `${objetivo}: "${termo}"`).not.toContain(termo);
      }
    }
  });

  it("todo destino e rota interna do produto", () => {
    for (const objetivo of [...PRIMARY_GOALS, null]) {
      for (const passo of planoPara(objetivo).passos) {
        expect(passo.href.startsWith("/"), passo.href).toBe(true);
        expect(passo.href).not.toMatch(/^https?:/);
      }
    }
  });

  it("a rotina sugerida existe de verdade", () => {
    // Um id de rotina invalido so apareceria em producao, ao abrir o player.
    for (const objetivo of [...PRIMARY_GOALS, null]) {
      const { rotina } = planoPara(objetivo);
      if (rotina) expect(rotinaPorId(rotina), `${objetivo}`).not.toBeNull();
    }
  });

  it("o plano de ciclo nao sugere rotina — e nao inventa uma", () => {
    expect(planoPara("cycle_tracking").rotina).toBeNull();
  });
});
