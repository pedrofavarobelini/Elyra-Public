import { describe, expect, it } from "vitest";

import { groupGrants, type GrantRowData } from "./grant-list";

const NOW = Date.parse("2026-09-24T12:00:00Z");

function grant(overrides: Partial<GrantRowData>): GrantRowData {
  return {
    id: crypto.randomUUID(),
    scope: "emotional",
    journalEntryId: null,
    status: "granted",
    grantedAt: "2026-09-24T10:00:00Z",
    validFrom: null,
    validUntil: null,
    revokedAt: null,
    dataFrom: null,
    dataTo: null,
    ...overrides,
  };
}

describe("groupGrants (W2)", () => {
  it("junta escopos cujas celulas exibidas sao identicas", () => {
    const groups = groupGrants(
      [grant({ scope: "cycle" }), grant({ scope: "emotional" }), grant({ scope: "sleep" })],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.scopes).toEqual(["Ciclo", "Emocional", "Sono"]);
    expect(groups[0]!.state.label).toBe("Vigente");
  });

  it("qualquer diferenca visivel mantem linhas separadas", () => {
    const groups = groupGrants(
      [
        grant({ scope: "emotional" }),
        grant({ scope: "sleep", validUntil: "2026-10-01T00:00:00Z" }),
        grant({ scope: "goals", dataFrom: "2026-07-01" }),
        grant({ scope: "cycle", revokedAt: "2026-09-24T11:00:00Z", status: "revoked" }),
        grant({ scope: "reports", validFrom: "2026-09-30T00:00:00Z" }),
        grant({ scope: "journal_entry", journalEntryId: crypto.randomUUID() }),
      ],
      NOW,
    );
    expect(groups.map((group) => group.scopes)).toEqual([
      ["Emocional"],
      ["Sono"],
      ["Metas"],
      ["Ciclo"],
      ["Relatórios"],
      ["Entrada do diário"],
    ]);
    expect(groups.map((group) => group.state.label)).toEqual([
      "Vigente",
      "Vigente",
      "Vigente",
      "Revogado",
      "Ainda não começou",
      "Vigente",
    ]);
  });

  it("duas entradas de diario iguais nas celulas mostram a contagem", () => {
    const groups = groupGrants(
      [
        grant({ scope: "journal_entry", journalEntryId: crypto.randomUUID() }),
        grant({ scope: "journal_entry", journalEntryId: crypto.randomUUID() }),
      ],
      NOW,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.scopes).toEqual(["Entrada do diário (2)"]);
    expect(groups[0]!.access).toBe("Entradas específicas · leitura");
  });

  it("grant expirado nao se mistura com vigente", () => {
    const groups = groupGrants(
      [grant({ scope: "sleep", validUntil: "2026-09-20T00:00:00Z" }), grant({ scope: "emotional" })],
      NOW,
    );
    expect(groups.map((group) => group.state.label)).toEqual(["Expirado", "Vigente"]);
  });

  it("vinculo pausado: grant vigente aparece como suspenso; revogado continua revogado", () => {
    const groups = groupGrants(
      [grant({ scope: "emotional" }), grant({ scope: "sleep", revokedAt: "2026-09-24T11:00:00Z", status: "revoked" })],
      NOW,
      true,
    );
    expect(groups.map((group) => group.state.label)).toEqual(["Suspenso", "Revogado"]);
  });
});
