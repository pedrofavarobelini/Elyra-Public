import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SampleSizeNote, describeSampleSize } from "./sample-size";
import { MIN_DAYS_FOR_COMPARISON } from "@/lib/reports";
import type { Comparison } from "@/lib/reports";

function comparacao(overrides: Partial<Comparison> = {}): Comparison {
  return {
    current: 6,
    previous: 5,
    delta: 1,
    trend: "up",
    currentSamples: 5,
    previousSamples: 6,
    ...overrides,
  };
}

describe("describeSampleSize", () => {
  it("declara quantos dias sustentam cada lado da comparacao", () => {
    expect(describeSampleSize(comparacao())).toBe(
      "Comparação baseada em 5 dias neste período e 6 dias no anterior.",
    );
  });

  it("concorda o singular quando ha um unico dia", () => {
    const texto = describeSampleSize(
      comparacao({ currentSamples: 1, previousSamples: 1 }),
    );
    expect(texto).toContain("1 dia ");
    expect(texto).not.toContain("1 dias");
  });

  /**
   * A distincao que o produto nao pode perder: dado insuficiente **nao** e
   * ausencia de padrao. Dizer "sem padrao" transformaria silencio de dado numa
   * afirmacao sobre a pessoa.
   */
  it("diz que nao da para afirmar - nunca que nao existe padrao", () => {
    const texto = describeSampleSize(
      comparacao({ trend: "insufficient_data", currentSamples: 1, previousSamples: 0 }),
    );

    expect(texto).toContain("Ainda não dá para afirmar");
    expect(texto).not.toMatch(/sem padr|nenhum padr|não há padr/i);
    expect(texto).not.toMatch(/estável|estavel/i);
  });

  it("deriva o minimo da constante, e nao de numero escrito a mao", () => {
    const texto = describeSampleSize(comparacao({ trend: "insufficient_data" }));
    expect(texto).toContain(`${MIN_DAYS_FOR_COMPARISON} dias com registro`);
  });

  it("nunca apresenta ausencia de registro como zero", () => {
    const texto = describeSampleSize(
      comparacao({ trend: "insufficient_data", currentSamples: 0, previousSamples: 0 }),
    );
    expect(texto).toContain("0 dias");
    expect(texto).not.toMatch(/\b0\/10\b/);
  });
});

describe("SampleSizeNote", () => {
  it("acompanha a comparacao em vez de substitui-la", () => {
    render(<SampleSizeNote comparison={comparacao()} />);
    expect(
      screen.getByText(/Comparação baseada em 5 dias/),
    ).toBeInTheDocument();
  });

  it("continua visivel quando o dado e insuficiente", () => {
    render(
      <SampleSizeNote comparison={comparacao({ trend: "insufficient_data" })} />,
    );
    expect(screen.getByText(/Ainda não dá para afirmar/)).toBeInTheDocument();
  });
});
