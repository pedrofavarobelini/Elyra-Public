import { describe, expect, it } from "vitest";

import type { SupportMunicipality } from "@/lib/contracts/support-network";

import { groupByState, plural } from "./support-catalog";

const m = (code: string, name: string, state: string, facilityCount: number): SupportMunicipality => ({
  code,
  name,
  state,
  facilityCount,
  center: null,
});

const DEMO = [m("355030", "São Paulo", "SP", 6), m("330455", "Rio de Janeiro", "RJ", 1), m("353470", "Orlândia", "SP", 3)];

describe("catalogo da Rede de Apoio: ESTADO -> MUNICIPIO", () => {
  it("agrupa por UF, ordena estados e municipios em pt-BR e soma unidades", () => {
    const groups = groupByState(DEMO);
    expect(groups.map((g) => `${g.stateName}:${g.municipalities.map((x) => x.name).join(",")}:${g.facilityCount}`)).toEqual([
      "Rio de Janeiro:Rio de Janeiro:1",
      "São Paulo:Orlândia,São Paulo:9",
    ]);
  });

  it("filtro de texto ignora acento e caixa e casa com o nome do estado", () => {
    for (const text of ["ORLANDIA", "orlândia", "Orlândia"]) {
      expect(groupByState(DEMO, { text }).flatMap((g) => g.municipalities.map((x) => x.code))).toEqual(["353470"]);
    }
    expect(groupByState(DEMO, { text: "sao paulo" }).flatMap((g) => g.municipalities.map((x) => x.code))).toEqual(["353470", "355030"]);
  });

  it("filtro de UF e combinacao sem resultado", () => {
    expect(groupByState(DEMO, { state: "RJ" }).map((g) => g.state)).toEqual(["RJ"]);
    expect(groupByState(DEMO, { state: "RJ", text: "orlandia" })).toEqual([]);
  });

  it("plural", () => {
    expect(plural(1, "unidade", "unidades")).toBe("1 unidade");
    expect(plural(9, "unidade", "unidades")).toBe("9 unidades");
  });
});
