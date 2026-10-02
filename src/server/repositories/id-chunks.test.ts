import { describe, expect, it } from "vitest";

import { ID_CHUNK_SIZE, chunkIds } from "@/server/repositories/id-chunks";


describe("consulta por blocos de ID", () => {
  it("lista vazia nao gera consulta", () => {
    expect(chunkIds([])).toEqual([]);
  });

  it("lista pequena vira um bloco so", () => {
    expect(chunkIds(["a", "b"])).toEqual([["a", "b"]]);
  });

  it("900 IDs viram 6 blocos e nenhum ID se perde", () => {
    const ids = Array.from({ length: 900 }, (_, index) => `id-${index}`);
    const chunks = chunkIds(ids);
    expect(chunks).toHaveLength(6);
    expect(chunks.every((chunk) => chunk.length <= ID_CHUNK_SIZE)).toBe(true);
    expect(chunks.flat()).toEqual(ids);
  });

  it("o teto cabe com folga no limite de cabecalho (~8 KB)", () => {
    const uuidLength = 39; // 36 caracteres + separador codificado
    expect(ID_CHUNK_SIZE * uuidLength).toBeLessThan(8 * 1024);
  });
});
