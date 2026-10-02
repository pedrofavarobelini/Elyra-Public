import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InlineEmpty, InlineLoading, InlineSpinner } from "./index";

describe("sistema de loading e vazio (MOTION-1)", () => {
  it("InlineLoading anuncia em texto e o spinner e decorativo", () => {
    const { container } = render(<InlineLoading>Carregando horários livres…</InlineLoading>);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando horários livres…");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("InlineSpinner e decorativo e nao carrega informacao", () => {
    const { container } = render(<InlineSpinner size="sm" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("class")).toContain("animate-spin");
    expect(svg.getAttribute("class")).toContain("size-3.5");
  });

  it("InlineEmpty mantem o texto de quem usa", () => {
    render(<InlineEmpty>Nenhum recado aguardando.</InlineEmpty>);
    expect(screen.getByText("Nenhum recado aguardando.")).toHaveAttribute("data-elyra-empty", "inline");
  });
});
