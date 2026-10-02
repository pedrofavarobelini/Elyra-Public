import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RequiresConnection } from "./requires-connection";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => value });
}

describe("RequiresConnection (OFF-4)", () => {
  afterEach(() => setOnline(true));

  it("sem rede: botao desabilitado antes do clique e motivo em texto", () => {
    setOnline(false);
    render(
      <RequiresConnection>
        <button type="button">Aceitar convite</button>
      </RequiresConnection>,
    );
    expect(screen.getByRole("button", { name: "Aceitar convite" })).toBeDisabled();
    expect(screen.getByTestId("requires-connection-note")).toHaveTextContent("Sem conexão: esta ação precisa de internet. Nada foi alterado.");
  });

  it("com rede: nada muda", () => {
    setOnline(true);
    render(
      <RequiresConnection>
        <button type="button">Aceitar convite</button>
      </RequiresConnection>,
    );
    expect(screen.getByRole("button", { name: "Aceitar convite" })).toBeEnabled();
    expect(screen.queryByTestId("requires-connection-note")).toBeNull();
  });
});
