import { describe, expect, it } from "vitest";

import {
  decideFromEvidence,
  evidenceAccepted,
  MANDATORY_GATES,
  normalizePersonName,
  type Evidence,
} from "./verification-decision";

const NOW = Date.parse("2026-09-26T12:00:00Z");
const at = new Date(NOW - 60_000).toISOString();

function full(overrides: Partial<Record<(typeof MANDATORY_GATES)[number], Partial<Evidence>>> = {}): Evidence[] {
  const base: Record<(typeof MANDATORY_GATES)[number], Evidence> = {
    auth_account: { fact: "auth_account", sourceType: "local_evidence", provider: "s", status: "PASS", checkedAt: at },
    required_terms: { fact: "required_terms", sourceType: "local_evidence", provider: "s", status: "PASS", checkedAt: at },
    registry_format: { fact: "registry_format", sourceType: "local_evidence", provider: "s", status: "PASS", checkedAt: at },
    identity_match: {
      fact: "identity_match", sourceType: "optional_provider", provider: "idp", status: "PASS",
      assurance: "identity_strongly_verified", checkedAt: at,
    },
    professional_registry: { fact: "professional_registry", sourceType: "official_registry", provider: "cfp", status: "PASS", checkedAt: at },
    registry_holder_match: { fact: "registry_holder_match", sourceType: "official_registry", provider: "cfp", status: "PASS", checkedAt: at },
    registry_status: { fact: "registry_status", sourceType: "official_registry", provider: "cfp", status: "PASS", checkedAt: at },
  };
  return MANDATORY_GATES.map((gate) => ({ ...base[gate], ...overrides[gate] }) as Evidence);
}

const decide = (items: Evidence[], acceptFixtures = false) => decideFromEvidence(items, { acceptFixtures, now: NOW });

describe("motor de decisao V2", () => {
  it("todos os gates por fonte aceita: VERIFIED", () => {
    expect(decide(full()).outcome).toBe("VERIFIED");
  });

  it("nenhum gate nomeia provider: trocar o fornecedor nao muda a decisao", () => {
    const other = full({
      professional_registry: { sourceType: "optional_provider", provider: "outro" },
      registry_holder_match: { sourceType: "optional_provider", provider: "outro" },
      registry_status: { sourceType: "optional_provider", provider: "outro" },
    });
    expect(decide(other).outcome).toBe("VERIFIED");
  });

  it("identidade so declarada (baseline gratuita de hoje): UNDER_REVIEW, nunca aprova nem recusa", () => {
    const d = decide(full({ identity_match: { sourceType: "local_evidence", status: "UNVERIFIED", assurance: "identity_declared", detail: "assurance_identity_declared" } }));
    expect(d.outcome).toBe("UNDER_REVIEW");
    expect(d.reasons).toContain("identity_match:assurance_identity_declared");
  });

  it("PASS de identidade com assurance fraca nao conta", () => {
    const d = decide(full({ identity_match: { assurance: "identity_declared" } }));
    expect(d.outcome).toBe("UNDER_REVIEW");
    expect(d.reasons).toContain("identity_match:source_not_accepted");
  });

  it("registro 'confirmado' por evidencia local nao conta", () => {
    expect(decide(full({ professional_registry: { sourceType: "local_evidence" } })).outcome).toBe("UNDER_REVIEW");
  });

  it("fonte indisponivel: UNDER_REVIEW com motivo, nunca REJECTED", () => {
    const d = decide(full({ professional_registry: { status: "SOURCE_UNAVAILABLE", detail: "cfp:timeout" }, registry_status: { status: "UNKNOWN" } }));
    expect(d.outcome).toBe("UNDER_REVIEW");
    expect(d.reasons).toContain("professional_registry:cfp:timeout");
  });

  it("provider nao configurado nunca vira recusa", () => {
    const d = decide(full({ professional_registry: { status: "NOT_CONFIGURED" }, registry_status: { status: "NOT_CONFIGURED" } }));
    expect(d.outcome).toBe("UNDER_REVIEW");
  });

  it("inativo + mesmo titular em fonte aceita: REJECTED", () => {
    expect(decide(full({ registry_status: { status: "FAIL", detail: "registry_inactive" } })).outcome).toBe("REJECTED");
  });

  it("inativo mas titular diverge: correcao (pode ser o registro errado)", () => {
    const d = decide(full({ registry_status: { status: "FAIL", detail: "registry_inactive" }, registry_holder_match: { status: "MISMATCH" } }));
    expect(d.outcome).toBe("PENDING_CORRECTION");
    expect(d.reasons).toEqual(["name_mismatch"]);
  });

  it("inativo vindo de fixture sem interruptor: nunca recusa", () => {
    const d = decide(full({
      registry_status: { status: "FAIL", detail: "registry_inactive", sourceType: "qa_fixture" },
      registry_holder_match: { sourceType: "qa_fixture" },
    }));
    expect(d.outcome).not.toBe("REJECTED");
  });

  it("correcoes: formato, declaracao, nao encontrado, ilegivel", () => {
    expect(decide(full({ registry_format: { status: "FAIL" } })).reasons).toEqual(["registry_format_invalid"]);
    expect(decide(full({ required_terms: { status: "FAIL" } })).reasons).toEqual(["identity_unconfirmed"]);
    expect(decide(full({ professional_registry: { status: "FAIL", detail: "registry_not_found" } })).reasons).toEqual(["registry_mismatch"]);
    expect(decide(full({ identity_match: { status: "DOCUMENT_UNREADABLE" } })).reasons).toEqual(["document_unreadable"]);
  });

  it("sinal de seguranca: UNDER_REVIEW mesmo com tudo PASS", () => {
    const items = [...full(), { fact: "registry_format", sourceType: "local_evidence", provider: "s", status: "REPLAY", checkedAt: at } as Evidence];
    expect(decide(items).outcome).toBe("UNDER_REVIEW");
  });

  it("o pior status do mesmo fato vence (PASS nao mascara FAIL)", () => {
    const items = [...full(), { fact: "registry_status", sourceType: "official_registry", provider: "cfp", status: "FAIL", detail: "registry_inactive", checkedAt: at } as Evidence];
    expect(decide(items).outcome).toBe("REJECTED");
  });

  it("evidencia velha ou vencida nao aprova", () => {
    const old = new Date(NOW - 25 * 3600_000).toISOString();
    expect(decide(full({ registry_status: { checkedAt: old } })).outcome).toBe("UNDER_REVIEW");
    expect(decide(full({ registry_status: { expiresAt: new Date(NOW - 1).toISOString() } })).outcome).toBe("UNDER_REVIEW");
  });

  it("confianca baixa rebaixa PASS", () => {
    expect(decide(full({ professional_registry: { confidence: 0.5 } })).outcome).toBe("UNDER_REVIEW");
  });

  it("fixture so decide com interruptor local", () => {
    const fixture = full(
      Object.fromEntries(
        (["professional_registry", "registry_holder_match", "registry_status", "identity_match"] as const).map((gate) => [
          gate,
          { sourceType: "qa_fixture", assurance: gate === "identity_match" ? "identity_document_crosschecked" : undefined },
        ]),
      ),
    );
    expect(decide(fixture, false).outcome).toBe("UNDER_REVIEW");
    expect(decide(fixture, true).outcome).toBe("VERIFIED");
  });

  it("gate sem evidencia: UNKNOWN, nunca aprova", () => {
    const d = decide(full().filter((item) => item.fact !== "registry_status"));
    expect(d.outcome).toBe("UNDER_REVIEW");
    expect(d.gates.find((gate) => gate.gate === "registry_status")?.status).toBe("UNKNOWN");
  });

  it("aceitacao espelha a regra do banco", () => {
    const base = { checkedAt: at, provider: "p", status: "PASS" as const };
    expect(evidenceAccepted({ ...base, fact: "registry_status", sourceType: "official_open_data" }, { acceptFixtures: false })).toBe(false);
    expect(evidenceAccepted({ ...base, fact: "auth_account", sourceType: "optional_provider" }, { acceptFixtures: false })).toBe(false);
    expect(evidenceAccepted({ ...base, fact: "education", sourceType: "official_open_data" }, { acceptFixtures: true })).toBe(false);
  });

  it("nome comparavel ignora acento, caixa e pontuacao", () => {
    expect(normalizePersonName("  Joana  D'Ávila-Souza ")).toBe(normalizePersonName("JOANA D AVILA SOUZA"));
  });
});
