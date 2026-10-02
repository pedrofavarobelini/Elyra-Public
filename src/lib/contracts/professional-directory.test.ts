import { describe, expect, it } from "vitest";

import {
  directorySearchQuery,
  isDemoProfessionalRegistration,
  discoveryVisibility,
  parseDirectorySearch,
  publicProfileInputSchema,
  registrationLabel,
} from "./professional-directory";

const COMPLETE = {
  listed: true,
  displayName: "Marina Demo",
  bio: "Apresentacao.",
  city: "São Paulo",
  state: "SP",
  modalities: ["online"],
  areas: ["luto"],
  languages: ["pt"],
};

describe("parseDirectorySearch", () => {
  it("aceita filtros do vocabulario", () => {
    expect(parseDirectorySearch({ q: " Joao  Silva ", uf: "SP", cidade: "Recife", modalidade: "online", area: "luto", idioma: "es", pagina: "3" })).toEqual({
      q: "Joao Silva",
      state: "SP",
      city: "Recife",
      modality: "online",
      area: "luto",
      language: "es",
      page: 3,
    });
  });

  it("valor adulterado vira ausencia de filtro, e nao erro", () => {
    const parsed = parseDirectorySearch({
      q: "a".repeat(61),
      uf: "sp; drop table",
      cidade: "\u0000\u0007",
      modalidade: "telepatia",
      area: "diagnostico",
      idioma: "klingon",
      pagina: "9999",
    });
    expect(parsed).toEqual({ q: null, state: null, city: null, modality: null, area: null, language: null, page: 1 });
    expect(parseDirectorySearch({ pagina: "-1" }).page).toBe(1);
    expect(parseDirectorySearch({ pagina: "1.5" }).page).toBe(1);
    expect(parseDirectorySearch({ q: ["joao", "maria"] }).q).toBe("joao");
  });

  it("querystring canonica preserva filtros e troca a pagina", () => {
    const search = parseDirectorySearch({ q: "ana", uf: "PE" });
    expect(directorySearchQuery(search, { page: 2 })).toEqual({ q: "ana", uf: "PE", pagina: "2" });
    expect(directorySearchQuery(search)).toEqual({ q: "ana", uf: "PE" });
  });
});

describe("publicProfileInputSchema", () => {
  it("publicar exige perfil completo", () => {
    expect(publicProfileInputSchema.parse(COMPLETE).listed).toBe(true);
    const result = publicProfileInputSchema.safeParse({ ...COMPLETE, city: "", areas: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("cidade");
    expect(result.error?.issues[0]?.message).toContain("área");
  });

  it("sem publicar, rascunho incompleto e aceito", () => {
    expect(publicProfileInputSchema.safeParse({ ...COMPLETE, listed: false, city: "", areas: [] }).success).toBe(true);
  });

  it("recusa vocabulario fora da lista, campo extra e limites", () => {
    expect(publicProfileInputSchema.safeParse({ ...COMPLETE, areas: ["diagnostico"] }).success).toBe(false);
    expect(publicProfileInputSchema.safeParse({ ...COMPLETE, state: "XX" }).success).toBe(false);
    expect(publicProfileInputSchema.safeParse({ ...COMPLETE, cpf: "000" }).success).toBe(false);
    expect(publicProfileInputSchema.safeParse({ ...COMPLETE, bio: "a".repeat(601) }).success).toBe(false);
    expect(
      publicProfileInputSchema.safeParse({ ...COMPLETE, areas: ["luto", "estresse", "familia", "autoestima", "adolescencia", "transicoes", "diversidade"] }).success,
    ).toBe(false);
  });

  it("remove duplicatas", () => {
    expect(publicProfileInputSchema.parse({ ...COMPLETE, languages: ["pt", "pt", "es"] }).languages).toEqual(["pt", "es"]);
  });
});

describe("discoveryVisibility", () => {
  it("so aparece com verificacao vigente, completo e opt-in", () => {
    expect(discoveryVisibility({ verification: "verified", listed: true, missing: [] })).toEqual({ visible: true });
  });

  it("explica o motivo, verificacao primeiro", () => {
    const pending = discoveryVisibility({ verification: "pending", listed: true, missing: [] });
    expect(pending).toMatchObject({ visible: false, reason: "verification" });
    expect(pending.visible ? "" : pending.message).toContain("verificação está pendente");
    expect(discoveryVisibility({ verification: "expired_review", listed: true, missing: [] })).toMatchObject({ reason: "verification" });
    expect(discoveryVisibility({ verification: "verified", listed: true, missing: ["cidade"] })).toMatchObject({ reason: "incomplete" });
    expect(discoveryVisibility({ verification: "verified", listed: false, missing: [] })).toMatchObject({ reason: "not_listed" });
  });
});

describe("registrationLabel", () => {
  it("escreve o registro como o conselho", () => {
    expect(registrationLabel("CRP", "06", "123456")).toBe("CRP 06/123456");
    expect(registrationLabel(null, null, "123456")).toBe("CRP 123456");
    expect(registrationLabel("CRP", "06", null)).toBeNull();
  });

  it("separa registros DEMO dos registros reais sem alterar o estado de verificacao", () => {
    expect(isDemoProfessionalRegistration("DEMO-STAGING-0001")).toBe(true);
    expect(isDemoProfessionalRegistration("demo-local-0002")).toBe(true);
    expect(isDemoProfessionalRegistration("123456")).toBe(false);
    expect(isDemoProfessionalRegistration(null)).toBe(false);
  });
});
