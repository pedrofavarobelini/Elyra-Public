import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DEMO_VERIFICATION_COPY } from "@/lib/contracts/professional-directory";

import { DirectoryCard } from "./directory-card";
import { TrustFacts } from "./trust-facts";

const DEMO_PROFILE = {
  slug: null,
  display_name: "Marina Demo",
  council: "CRP",
  council_region: "00",
  registration_number: "DEMO-STAGING-0001",
  verified_at: "2026-09-28T12:00:00.000Z",
  city: "Cidade Demo",
  state: "SP",
  modalities: ["online"],
  areas: ["ansiedade"],
  languages: ["pt"],
};

describe("copy de verificacao dos profissionais DEMO", () => {
  it("marca o card DEMO sem afirmar conferencia oficial", () => {
    render(<DirectoryCard profile={DEMO_PROFILE} preview />);

    expect(screen.getByTestId("demo-verification-copy")).toHaveTextContent(DEMO_VERIFICATION_COPY);
    expect(screen.getByText("DEMO")).toBeInTheDocument();
    expect(screen.queryByText(/conferido em/i)).not.toBeInTheDocument();
  });

  it("troca verificacoes administrativas por simulacao no perfil DEMO", () => {
    render(
      <TrustFacts
        registration="CRP 00/DEMO-STAGING-0001"
        verifiedAt="2026-09-28T12:00:00.000Z"
        identityVerified
        demo
        credentials={[
          {
            kind: "education",
            title: "Psicologia (DEMO)",
            institution: "Universidade Fictícia",
            start_year: 2010,
            end_year: 2015,
            expires_on: null,
            trust_state: "verified",
            verified_at: "2026-09-28T12:00:00.000Z",
          },
        ]}
        credentialsAvailable
      />,
    );

    expect(screen.getByRole("heading", { name: "Perfil de demonstração" })).toBeInTheDocument();
    expect(screen.getAllByText(DEMO_VERIFICATION_COPY)).toHaveLength(2);
    expect(screen.getByText("Demonstração")).toBeInTheDocument();
    expect(screen.getByText("Simulado")).toBeInTheDocument();
    expect(screen.queryByText(/fonte oficial|titular do registro|conferido em/i)).not.toBeInTheDocument();
  });

  it("preserva a copy real para registro nao DEMO", () => {
    render(
      <TrustFacts
        registration="CRP 06/123456"
        verifiedAt="2026-09-28T12:00:00.000Z"
        identityVerified
        credentials={[]}
        credentialsAvailable
      />,
    );

    expect(screen.getByRole("heading", { name: "O que a Elyra verificou" })).toBeInTheDocument();
    expect(screen.getByText(/consultado na fonte oficial/i)).toBeInTheDocument();
    expect(screen.getByText(/titular do registro/i)).toBeInTheDocument();
  });
});
