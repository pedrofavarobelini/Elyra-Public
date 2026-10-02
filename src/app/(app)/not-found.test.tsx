import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import AppNotFound from "@/app/(app)/not-found";


describe("AppNotFound", () => {
  afterEach(cleanup);

  it("explica o 404 em portugues e oferece caminho de volta", () => {
    render(<AppNotFound />);

    expect(
      screen.getByRole("heading", { name: "Não encontramos esta página" }),
    ).toBeTruthy();
    expect(screen.getByText(/entrou com a conta certa/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Ir para o painel" }).getAttribute("href"),
    ).toBe("/dashboard");
    expect(screen.queryByText(/could not be found/i)).toBeNull();
  });

  it("nao distingue registro inexistente de registro de outra conta", () => {
    const { container } = render(<AppNotFound />);
    expect(container.textContent).not.toMatch(/n[aã]o tem permiss|pertence a outra pessoa|existe/i);
  });
});
