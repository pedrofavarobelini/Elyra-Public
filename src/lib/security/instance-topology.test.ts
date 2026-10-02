import { describe, expect, it } from "vitest";

import {
  INSTANCE_TOPOLOGY,
  InstanceTopologyError,
  TOPOLOGY_VAR,
  assertRateLimitTopology,
  declaredTopology,
  rateLimitIsAuthoritative,
} from "@/lib/security/instance-topology";



describe("topologia de instancia declarada", () => {
  it("ausente vale instancia unica, e o limitador em memoria e autoritativo", () => {
    expect(declaredTopology({})).toBe(INSTANCE_TOPOLOGY.SINGLE);
    expect(rateLimitIsAuthoritative({})).toBe(true);
  });

  it("valor ilegivel nao cai no padrao: e erro", () => {
    expect(declaredTopology({ [TOPOLOGY_VAR]: "singel" })).toBeNull();
    expect(() => assertRateLimitTopology({ [TOPOLOGY_VAR]: "singel" })).toThrow(
      InstanceTopologyError,
    );
  });

  it("aceita as duas topologias declaradas, sem diferenciar caixa e espaco", () => {
    expect(declaredTopology({ [TOPOLOGY_VAR]: " SINGLE " })).toBe(INSTANCE_TOPOLOGY.SINGLE);
    expect(declaredTopology({ [TOPOLOGY_VAR]: "Multi" })).toBe(INSTANCE_TOPOLOGY.MULTI);
  });

  it("com topologia multi o limitador em memoria deixa de ser autoritativo", () => {
    expect(rateLimitIsAuthoritative({ [TOPOLOGY_VAR]: "multi" })).toBe(false);
  });

  it("multi em staging ou producao sem limitador compartilhado nao sobe", () => {
    for (const runtime of ["staging", "production"]) {
      expect(() =>
        assertRateLimitTopology({ [TOPOLOGY_VAR]: "multi", ELYRA_RUNTIME_ENV: runtime }),
      ).toThrow(/L-040/);
    }
  });

  it("fora de staging e producao, multi declarada nao impede desenvolver", () => {
    expect(() =>
      assertRateLimitTopology({ [TOPOLOGY_VAR]: "multi", ELYRA_RUNTIME_ENV: "qa" }),
    ).not.toThrow();
  });

  it("instancia unica sobe em qualquer ambiente", () => {
    for (const runtime of ["", "qa", "staging", "production"]) {
      expect(() =>
        assertRateLimitTopology({ [TOPOLOGY_VAR]: "single", ELYRA_RUNTIME_ENV: runtime }),
      ).not.toThrow();
    }
  });
});
