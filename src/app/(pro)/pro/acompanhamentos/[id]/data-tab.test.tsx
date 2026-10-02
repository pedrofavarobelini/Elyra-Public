import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tabs, TabsList } from "@/components/ui/tabs";
import { DataTab } from "./view";

function renderTab(props: {
  shared: boolean;
  layer: "observed" | "deterministic" | "ai";
}) {
  return render(
    <Tabs defaultValue="sono">
      <TabsList />
      <DataTab value="sono" label="Sono" shared={props.shared} layer={props.layer}>
        <p>Nenhum registro de sono compartilhado.</p>
      </DataTab>
    </Tabs>,
  );
}

/**
 * Os dois silencios do dossie profissional.
 *
 * "Nao compartilhado" e "sem registro" levam a condutas diferentes: o primeiro
 * diz que existe dado que o profissional **nao ve**; o segundo diz que o dado
 * **nao existe**. Um profissional que confunde os dois supoe ausencia onde ha
 * ausencia de permissao - e decide com base nisso.
 *
 * A tela ja acertava isto desde a V1. Nenhum teste garantia, e o que nao e
 * testado volta a divergir na primeira reescrita de copy.
 */
describe("dossie profissional - os dois silencios", () => {
  it("sem permissao, diz que nao esta disponivel para este acesso - sem sugerir que existe registro", () => {
    renderTab({ shared: false, layer: "observed" });

    expect(
      screen.getByText(/Não disponível para este acesso/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Nenhum registro de sono compartilhado/i),
    ).not.toBeInTheDocument();
  });

  it("com permissao e sem dado, diz que esta vazio - e nao insinua falta de permissao", () => {
    renderTab({ shared: true, layer: "observed" });

    expect(
      screen.getByText(/Nenhum registro de sono compartilhado/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Não disponível para este acesso/i),
    ).not.toBeInTheDocument();
  });

  it("o cracha de compartilhamento diferencia os dois estados", () => {
    const { unmount } = renderTab({ shared: false, layer: "observed" });
    expect(screen.getByText("Não compartilhado")).toBeInTheDocument();
    unmount();

    renderTab({ shared: true, layer: "observed" });
    expect(screen.getByText("Compartilhado")).toBeInTheDocument();
  });
});

/**
 * As tres camadas, nomeadas na tela de quem vai decidir com elas.
 *
 * Registro, calculo e leitura de modelo respondem a perguntas diferentes sobre
 * confiabilidade. Aqui a confusao entre elas vira conduta.
 */
describe("dossie profissional - as tres camadas", () => {
  it("nomeia registro da pessoa", () => {
    renderTab({ shared: true, layer: "observed" });
    expect(screen.getByTestId("layer-sono")).toHaveTextContent(
      "Registro da pessoa",
    );
    expect(screen.getByText(/como registrou/i)).toBeInTheDocument();
  });

  it("nomeia calculo deterministico, e diz que e reproduzivel", () => {
    renderTab({ shared: true, layer: "deterministic" });
    expect(screen.getByTestId("layer-sono")).toHaveTextContent(
      "Cálculo da Elyra",
    );
    expect(screen.getByText(/regra fixa e reproduzível/i)).toBeInTheDocument();
  });

  it("quando existir, leitura de modelo se identifica e nega ser medicao", () => {


    // nasca obrigada a se identificar - em vez de a distincao ficar para depois.
    renderTab({ shared: true, layer: "ai" });
    expect(screen.getByTestId("layer-sono")).toHaveTextContent(
      "Leitura de modelo",
    );
    expect(screen.getByText(/Não é medição/i)).toBeInTheDocument();
  });
});
