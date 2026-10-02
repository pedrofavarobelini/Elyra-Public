import { describe, expect, it } from "vitest";

import { findGapBands, hasAnyGap } from "@/components/charts/gaps";

/**
 * `VR-003` - a lacuna precisa ser anunciada, nunca preenchida.
 *
 * O ponto destes testes nao e so "acha o buraco": e garantir que a marcacao
 * **nunca** afirma ausencia onde ha dado. Sombrear demais e tao errado quanto
 * nao sombrear - passaria a esconder registro que existe.
 */
describe("findGapBands", () => {
  const chaves = ["mood"] as const;

  it("nao marca nada quando toda a serie tem registro", () => {
    const data = [
      { label: "01", mood: 5 },
      { label: "02", mood: 6 },
      { label: "03", mood: 7 },
    ];
    expect(findGapBands(data, chaves)).toEqual([]);
  });

  it("marca a lacuna do inicio ao fim do intervalo vazio", () => {
    const data = [
      { label: "01", mood: 5 },
      { label: "02", mood: null },
      { label: "03", mood: null },
      { label: "04", mood: 8 },
    ];
    expect(findGapBands(data, chaves)).toEqual([{ from: "02", to: "04" }]);
  });

  it("fecha a lacuna que vai ate o fim da janela", () => {
    const data = [
      { label: "01", mood: 5 },
      { label: "02", mood: null },
      { label: "03", mood: null },
    ];
    // A ausencia mais recente e justamente a que a pessoa quer entender.
    expect(findGapBands(data, chaves)).toEqual([{ from: "02", to: "03" }]);
  });

  it("marca varias lacunas separadas", () => {
    const data = [
      { label: "01", mood: null },
      { label: "02", mood: 5 },
      { label: "03", mood: null },
      { label: "04", mood: 7 },
    ];
    expect(findGapBands(data, chaves)).toEqual([
      { from: "01", to: "02" },
      { from: "03", to: "04" },
    ]);
  });

  it("so marca quando TODAS as series exibidas estao ausentes", () => {
    const data = [
      { label: "01", mood: 5, energy: 4 },
      // Humor ausente, energia presente: o vazio pertence a uma serie so.
      { label: "02", mood: null, energy: 6 },
      { label: "03", mood: 7, energy: 5 },
    ];
    expect(findGapBands(data, ["mood", "energy"] as const)).toEqual([]);
  });

  it("marca quando todas as series exibidas estao ausentes no mesmo ponto", () => {
    const data = [
      { label: "01", mood: 5, energy: 4 },
      { label: "02", mood: null, energy: null },
      { label: "03", mood: 7, energy: 5 },
    ];
    expect(findGapBands(data, ["mood", "energy"] as const)).toEqual([
      { from: "02", to: "03" },
    ]);
  });

  it("trata undefined como ausencia, igual a null", () => {
    const data = [
      { label: "01", mood: 5 },
      { label: "02" },
      { label: "03", mood: 7 },
    ];
    expect(findGapBands(data, chaves)).toEqual([{ from: "02", to: "03" }]);
  });

  it("nao quebra com serie vazia nem sem chaves", () => {
    expect(findGapBands([], chaves)).toEqual([]);
    expect(findGapBands([{ label: "01", mood: 5 }], [])).toEqual([]);
  });

  it("zero e valor, nao ausencia", () => {
    // A regra central do produto: `NULL` nao e zero, e zero nao e `NULL`.
    const data = [
      { label: "01", mood: 5 },
      { label: "02", mood: 0 },
      { label: "03", mood: 7 },
    ];
    expect(findGapBands(data, chaves)).toEqual([]);
  });
});

describe("hasAnyGap", () => {
  it("e falso quando nao ha nenhuma ausencia", () => {
    expect(
      hasAnyGap([{ label: "01", mood: 5 }, { label: "02", mood: 6 }], ["mood"]),
    ).toBe(false);
  });

  it("e verdadeiro com ausencia em qualquer serie exibida", () => {
    // Basta uma serie ter buraco para a legenda precisar explicar o sombreado.
    expect(
      hasAnyGap(
        [
          { label: "01", mood: 5, energy: null },
          { label: "02", mood: 6, energy: 4 },
        ],
        ["mood", "energy"],
      ),
    ).toBe(true);
  });

  it("zero nao conta como ausencia", () => {
    expect(hasAnyGap([{ label: "01", mood: 0 }], ["mood"])).toBe(false);
  });
});
