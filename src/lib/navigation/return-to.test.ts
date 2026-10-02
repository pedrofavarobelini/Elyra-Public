import { describe, expect, it } from "vitest";

import { parseReturnTo, resolveReturnTo, withReturnTo } from "./return-to";

const FALLBACK = { href: "/configuracoes", label: "Voltar para o hub de ajustes" };

describe("returnTo seguro (L-398)", () => {
  it("aceita caminhos internos da area pessoal, com rotulo pela origem", () => {
    expect(parseReturnTo("/profissionais/marina-demo")).toEqual({ href: "/profissionais/marina-demo", label: "Voltar ao perfil do profissional" });
    expect(parseReturnTo("/agenda")?.href).toBe("/agenda");
    expect(parseReturnTo("/agenda?vinculo=abc")?.href).toBe("/agenda?vinculo=abc");
    expect(parseReturnTo(["/perfil", "/x"])?.label).toBe("Voltar para o Perfil");
  });

  it.each([
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "%2F%2Fevil.com",
    "/%2F%2Fevil.com",
    "/profissionais/../../api/auth",
    "/api/professional/connections",
    "/x\u0000y",
    "/profissionais/a b",
    "",
    "   ",
    "a".repeat(400),
  ])("recusa %s", (raw) => {
    expect(parseReturnTo(raw)).toBeNull();
    expect(resolveReturnTo(raw, FALLBACK)).toEqual(FALLBACK);
  });

  it("sem returnTo usa o padrao da tela", () => {
    expect(resolveReturnTo(undefined, FALLBACK)).toEqual(FALLBACK);
    expect(resolveReturnTo(null, FALLBACK)).toEqual(FALLBACK);
  });

  it("monta o link preservando a ancora", () => {
    expect(withReturnTo("/configuracoes/privacidade#cfg-profissional", "/profissionais/marina-demo")).toBe(
      "/configuracoes/privacidade?returnTo=%2Fprofissionais%2Fmarina-demo#cfg-profissional",
    );
    expect(withReturnTo("/convite", "/profissionais/x")).toBe("/convite?returnTo=%2Fprofissionais%2Fx");
    expect(withReturnTo("/agenda?vinculo=1", "/perfil")).toBe("/agenda?vinculo=1&returnTo=%2Fperfil");
  });
});
