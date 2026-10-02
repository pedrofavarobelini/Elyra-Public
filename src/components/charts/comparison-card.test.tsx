import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ComparisonCard } from "./comparison-card";
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

function renderizar(props: Partial<Parameters<typeof ComparisonCard>[0]> = {}) {
  return render(
    <ComparisonCard
      label="Ansiedade percebida"
      comparison={comparacao()}
      format={(v) => v.toFixed(1)}
      tone="anxiety"
      icon={<svg aria-hidden="true" />}
      higherIsBetter={false}
      {...props}
    />,
  );
}


describe("nome acessivel do ComparisonCard", () => {
  it("diz que e comparacao, e de que janela, quando pode colidir", () => {
    renderizar({ windowDays: 7 });

    expect(
      screen.getByRole("group", {
        name: "Ansiedade percebida, comparação de 7 dias",
      }),
    ).toBeInTheDocument();
  });

  it("a janela do nome acompanha a que foi comparada", () => {
    renderizar({ windowDays: 28 });

    expect(
      screen.getByRole("group", {
        name: "Ansiedade percebida, comparação de 28 dias",
      }),
    ).toBeInTheDocument();
  });

  it("sem ambiguidade, o rotulo fica limpo", () => {
    // Em `/relatorios` os rotulos ja sao proprios ("Humor medio"): acrescentar
    // sufixo onde nao ha colisao alonga o nome sem esclarecer nada.
    renderizar({ label: "Humor médio" });

    expect(
      screen.getByRole("group", { name: "Humor médio" }),
    ).toBeInTheDocument();
  });

  it("ausencia continua sendo ausencia, e nao zero", () => {
    renderizar({
      windowDays: 7,
      comparison: comparacao({ current: null, previous: null, delta: null }),
    });

    const grupo = screen.getByRole("group", {
      name: "Ansiedade percebida, comparação de 7 dias",
    });
    expect(grupo).toHaveTextContent("Sem registro");
    expect(grupo).not.toHaveTextContent("0,0");
  });
});

describe("variacao sempre com unidade (F7, L-314)", () => {
  it("score 0-10 diz pontos; sono usa o proprio formato; formatDelta explicito vence", async () => {
    const { deltaText } = await import("./comparison-card");
    const identity = (v: number) => String(v);
    expect(deltaText(-0.5, { format: identity, unit: "/10" })).toBe("0,5 pontos");
    expect(deltaText(1, { format: identity, unit: "/10" })).toMatch(/^1(,0)? ponto$/);
    const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}m`;
    // O caso real do /pro/relatorios: 5,6 minutos a menos nao pode virar "5,6".
    expect(deltaText(-5.6, { format: hours })).toBe("0h 06m");
    expect(deltaText(-30, { format: hours, formatDelta: () => "30 min" })).toBe("30 min");
  });
});
