import { afterEach, describe, expect, it, vi } from "vitest";

import {
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("normalizarCausa", () => {
  it("extrai code, message e hint do erro do PostgREST", () => {
    expect(
      normalizarCausa({
        code: "23505",
        message: 'duplicate key value violates unique constraint "x"',
        hint: "use upsert",
      }),
    ).toEqual({
      code: "23505",
      message: 'duplicate key value violates unique constraint "x"',
      hint: "use upsert",
    });
  });

  it("aceita um code ja extraido, pela compatibilidade com as chamadas antigas", () => {
    expect(normalizarCausa("PGRST116")).toEqual({ code: "PGRST116" });
  });

  it("devolve undefined quando nao ha causa aproveitavel", () => {
    expect(normalizarCausa(undefined)).toBeUndefined();
    expect(normalizarCausa(null)).toBeUndefined();
    expect(normalizarCausa({})).toBeUndefined();
  });

  /**
   * `details` e o campo em que o Postgres ecoa **valores da linha** recusada.
   * Numa constraint sobre `note`, ele conteria o texto que a pessoa escreveu.
   * Log nao carrega conteudo de pessoa - por isso ele nunca e normalizado.
   */
  it("nunca propaga `details`, que carrega valores da linha recusada", () => {
    const normalizada = normalizarCausa({
      code: "23514",
      message: "new row violates check constraint",
      details: "Failing row contains (uuid, 'hoje chorei no trabalho').",
    });
    expect(normalizada).toEqual({
      code: "23514",
      message: "new row violates check constraint",
    });
    expect(JSON.stringify(normalizada)).not.toContain("chorei");
  });
});

describe("registrarFalhaDeRepositorio", () => {
  it("registra dominio, operacao e a causa", () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    registrarFalhaDeRepositorio("ciclo", "save_record", {
      code: "57014",
      message: "canceling statement due to statement timeout",
    });
    expect(erro).toHaveBeenCalledWith("elyra.repository_failure", {
      dominio: "ciclo",
      operacao: "save_record",
      code: "57014",
      message: "canceling statement due to statement timeout",
      hint: null,
    });
  });

  it("registra mesmo sem causa - a operacao que falhou ja e informacao", () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    registrarFalhaDeRepositorio("diario", "list_entries", undefined);
    expect(erro).toHaveBeenCalledWith("elyra.repository_failure", {
      dominio: "diario",
      operacao: "list_entries",
      code: null,
      message: null,
      hint: null,
    });
  });
});
