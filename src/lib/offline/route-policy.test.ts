import { describe, expect, it } from "vitest";

import { OFFLINE_ROUTE_POLICY, offlinePolicyFor } from "./route-policy";

describe("matriz offline canonica (OFF-1, L-409)", () => {
  it("o shell monta so o nucleo pessoal e a Rede de Apoio", () => {
    const mounted = OFFLINE_ROUTE_POLICY.filter((p) => p.shell !== "online_only").map((p) => p.prefix).sort();
    expect(mounted).toEqual(
      ["/ciclo", "/conteudos-de-apoio", "/dashboard", "/diario", "/historico", "/metas", "/meu-humor", "/rede-de-apoio", "/relatorios"].sort(),
    );
  });

  it("autorizacao e seguranca nunca viram fila", () => {
    for (const route of ["/convite", "/configuracoes/privacidade", "/seguranca", "/agenda", "/pro/agenda", "/pro/pacientes/x"]) {
      const policy = offlinePolicyFor(route);
      expect(policy.shell, route).toBe("online_only");
      expect(policy.write, route).toBe("NO_OFFLINE_BY_DESIGN");
    }
    // Nenhuma rota fora do nucleo pessoal e QUEUEABLE.
    for (const policy of OFFLINE_ROUTE_POLICY) {
      if (policy.write === "QUEUEABLE") expect(policy.shell, policy.prefix).toBe("core");
    }
  });

  it("prefixo mais longo vence; rota desconhecida e ONLINE_ONLY", () => {
    expect(offlinePolicyFor("/configuracoes/privacidade?returnTo=%2Fperfil").prefix).toBe("/configuracoes/privacidade");
    expect(offlinePolicyFor("/configuracoes/dados").prefix).toBe("/configuracoes");
    expect(offlinePolicyFor("/pro").area).toBe("professional");
    expect(offlinePolicyFor("/pro/sessoes/abc").area).toBe("professional");
    expect(offlinePolicyFor("/profissionais/marina").prefix).toBe("/profissionais");
    expect(offlinePolicyFor("/rota-nova").shell).toBe("online_only");
    // "/pro" nao captura "/profissionais".
    expect(offlinePolicyFor("/profissionais").area).toBe("personal");
  });

  it("toda rota que precisa de conexao explica o porque, sem erro tecnico", () => {
    for (const policy of OFFLINE_ROUTE_POLICY.filter((p) => p.shell === "online_only")) {
      expect(policy.explanation.length, policy.prefix).toBeGreaterThan(20);
      expect(policy.explanation, policy.prefix).not.toMatch(/fetch|network|erro \d|undefined|null/i);
    }
  });
});
