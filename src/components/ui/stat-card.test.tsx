import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("renderiza valor e unidade", () => {
    render(<StatCard label="Energia" value="6,8" unit="/10" icon={null} />);
    expect(screen.getByText("6,8")).toBeInTheDocument();
    expect(screen.getByText("/10")).toBeInTheDocument();
  });

  it("valor ausente renderiza 'Sem registro' e nunca zero", () => {
    render(<StatCard label="Energia" value={null} unit="/10" icon={null} />);
    expect(screen.getByText("Sem registro")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("0,0")).not.toBeInTheDocument();
  });

  it("delta de melhora usa tom positivo", () => {
    const { container } = render(
      <StatCard
        label="Ansiedade percebida"
        value="4,2"
        unit="/10"
        icon={null}
        delta={{ direction: "down", label: "0,8 na semana", isPositive: true }}
      />,
    );
    expect(container.querySelector(".text-positive")).not.toBeNull();
  });
});
