import { describe, expect, it } from "vitest";

import { SHARING_SCOPES } from "@/lib/contracts/sharing";

import { SCOPE_GROUPS } from "./professional-sharing";

describe("compartilhamento em dois grupos (L-398)", () => {
  it("os grupos cobrem todo escopo (exceto diario), sem repetir nenhum", () => {
    const grouped = SCOPE_GROUPS.flatMap((group) => group.scopes);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(SHARING_SCOPES.filter((scope) => scope !== "journal_entry").sort());
  });

  it("sessoes particulares explicam a dupla chave", () => {
    const sessions = SCOPE_GROUPS.find((group) => group.id === "sessoes");
    expect(sessions?.note).toContain("As duas permissões precisam permitir o acesso");
    expect(sessions?.scopes).toEqual(expect.arrayContaining(["multimodal_result", "multimodal_transcript", "multimodal_media"]));
  });
});
