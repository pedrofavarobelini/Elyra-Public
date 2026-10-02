import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ScoreSlider } from "@/components/journey/score-slider";


describe("ScoreSlider - estado x acao", () => {
  it("com valor preenchido, o botao nomeia a acao e nao o estado", () => {
    render(
      <ScoreSlider id="mood" label="Humor" value={7} onChange={() => {}} />,
    );

    // O valor diz o estado.
    expect(screen.getByTestId("mood-value")).toHaveTextContent("7/10");

    // O botao diz a acao - e nao repete a frase de ausencia.
    const botao = screen.getByTestId("mood-toggle");
    expect(botao).toHaveAccessibleName("Deixar Humor sem registro");
    expect(botao).not.toHaveAccessibleName(/^Sem registro$/);
  });

  it("nao exibe 'Sem registro' como estado enquanto ha valor", () => {
    render(
      <ScoreSlider id="mood" label="Humor" value={7} onChange={() => {}} />,
    );
    // A contradicao do finding: estado de ausencia ao lado de valor presente.
    expect(screen.getByTestId("mood-value")).not.toHaveTextContent(
      "Sem registro",
    );
  });

  it("sem valor, o estado e 'Sem registro' e a acao e registrar", () => {
    render(
      <ScoreSlider id="mood" label="Humor" value={null} onChange={() => {}} />,
    );
    expect(screen.getByTestId("mood-value")).toHaveTextContent("Sem registro");
    expect(screen.getByTestId("mood-toggle")).toHaveAccessibleName(
      "Registrar um valor para Humor",
    );
  });

  it("o botao tem nome acessivel que identifica o campo", () => {
    render(
      <ScoreSlider id="mood" label="Humor" value={7} onChange={() => {}} />,
    );
    // Sem o nome do campo, quem usa leitor de tela ouve o mesmo rotulo em
    // varios sliders da mesma pagina.
    expect(
      screen.getByRole("button", { name: "Deixar Humor sem registro" }),
    ).toBeInTheDocument();
  });

  it("limpar devolve null, nunca zero", async () => {
    const onChange = vi.fn();
    render(
      <ScoreSlider id="mood" label="Humor" value={7} onChange={onChange} />,
    );

    await userEvent.click(screen.getByTestId("mood-toggle"));

    expect(onChange).toHaveBeenCalledWith(null);
    expect(onChange).not.toHaveBeenCalledWith(0);
  });

  it("o slider anuncia ausencia em vez de anunciar o valor de repouso", () => {
    render(
      <ScoreSlider id="mood" label="Humor" value={null} onChange={() => {}} />,
    );
    // O trilho repousa em 5 por razao visual; o leitor de tela nao pode dizer
    // "5 de 10" para um campo que nao tem registro.
    expect(screen.getByRole("slider")).toHaveAttribute(
      "aria-valuetext",
      "Sem registro",
    );
  });
});
