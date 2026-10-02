import { describe, expect, it } from "vitest";

import {
  aggregateByBucket,
  aggregateForReadability,
  DAILY_READABLE_LIMIT,
} from "@/components/charts/aggregate";

/**
 * `VR-004` - agregar sem inventar.
 *
 * Agregacao e o lugar classico onde ausencia vira zero por descuido: basta
 * somar o bucket inteiro e dividir pelo tamanho dele. Estes testes fixam a
 * regra oposta - a media considera **o que existe**, e um bucket sem nada
 * continua ausente.
 */
const ponto = (label: string, mood: number | null) => ({ label, mood });

describe("aggregateByBucket", () => {
  it("devolve a media dos valores presentes", () => {
    const out = aggregateByBucket(
      [ponto("01", 4), ponto("02", 6), ponto("03", 8)],
      ["mood"],
      3,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.mood).toBe(6);
  });

  it("ignora ausencia em vez de trata-la como zero", () => {
    const out = aggregateByBucket(
      [ponto("01", 4), ponto("02", null), ponto("03", 8)],
      ["mood"],
      3,
    );
    // Media de 4 e 8. Contar o `null` como zero daria 4 e rebaixaria o humor
    // da pessoa por um dia que ela simplesmente nao registrou.
    expect(out[0]?.mood).toBe(6);
  });

  it("bucket sem nenhum registro permanece ausente", () => {
    const out = aggregateByBucket(
      [ponto("01", null), ponto("02", null)],
      ["mood"],
      2,
    );
    expect(out[0]?.mood).toBeNull();
  });

  it("registra quantos pontos sustentam o bucket", () => {
    const out = aggregateByBucket(
      [ponto("01", 4), ponto("02", 6), ponto("03", 8)],
      ["mood"],
      2,
    );
    expect(out.map((p) => p.sourceCount)).toEqual([2, 1]);
  });

  it("o rotulo nomeia o intervalo, nao um dia que o bucket nao representa", () => {
    const out = aggregateByBucket(
      [ponto("01/08", 4), ponto("07/08", 6)],
      ["mood"],
      2,
    );
    expect(out[0]?.label).toBe("01/08 – 07/08");
  });

  it("bucket de um ponto mantem o rotulo original", () => {
    const out = aggregateByBucket([ponto("01/08", 4)], ["mood"], 7);
    expect(out[0]?.label).toBe("01/08");
  });

  it("preserva a ordem de entrada", () => {
    const out = aggregateByBucket(
      [ponto("a", 1), ponto("b", 2), ponto("c", 3), ponto("d", 4)],
      ["mood"],
      2,
    );
    expect(out.map((p) => p.label)).toEqual(["a – b", "c – d"]);
  });

  it("size <= 1 nao agrega", () => {
    const entrada = [ponto("01", 4), ponto("02", 6)];
    expect(aggregateByBucket(entrada, ["mood"], 1)).toHaveLength(2);
  });
});

describe("aggregateForReadability", () => {
  const serie = (n: number) =>
    Array.from({ length: n }, (_, i) => ponto(String(i + 1), i % 10));

  it("nao agrega janela curta - o dia ainda e legivel", () => {
    const out = aggregateForReadability(serie(DAILY_READABLE_LIMIT), ["mood"]);
    expect(out.aggregated).toBe(false);
    expect(out.points).toHaveLength(DAILY_READABLE_LIMIT);
  });

  it("agrega janela longa e diz que agregou", () => {
    const out = aggregateForReadability(serie(90), ["mood"]);
    expect(out.aggregated).toBe(true);
    // 90 dias em blocos de 7.
    expect(out.points).toHaveLength(Math.ceil(90 / 7));
  });

  it("agregar em silencio seria mentir sobre a granularidade do eixo", () => {
    // O flag existe para a tela poder dizer "media semanal".
    expect(aggregateForReadability(serie(90), ["mood"]).aggregated).toBe(true);
    expect(aggregateForReadability(serie(10), ["mood"]).aggregated).toBe(false);
  });

  it("serie vazia nao quebra", () => {
    const out = aggregateForReadability([], ["mood"]);
    expect(out.points).toEqual([]);
    expect(out.aggregated).toBe(false);
  });
});
