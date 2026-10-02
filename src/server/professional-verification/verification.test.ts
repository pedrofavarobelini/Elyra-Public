import { afterEach, describe, expect, it, vi } from "vitest";

import { readVerificationConfig, type VerificationConfig } from "./config";
import { runProfessionalVerification, type OrchestratorDeps, type VerificationSubject } from "./orchestrator";
import { createEmecSnapshotProvider } from "./providers/education/emec-snapshot";
import { guardXml } from "./providers/education/xml-guard";
import { createFixtureIdentityProvider, createFixtureRegistryProvider } from "./providers/fixtures";
import { createDatavalidProvider } from "./providers/identity/datavalid";
import { createLocalIdentityProvider } from "./providers/identity/local-evidence";
import { createCfpOfficialProvider } from "./providers/registry/cfp-official";
import { createInfosimplesProvider } from "./providers/registry/infosimples";
import type { ProfessionalRegistryProvider } from "./providers/types";
import { CircuitBreaker, CostGuard, TtlCache } from "./runtime";
import type { TrustedVerificationStore } from "./trusted-store";
import { verifySubmission } from "./veltrix-service";

vi.spyOn(console, "info").mockImplementation(() => {});

const FREE: VerificationConfig = readVerificationConfig({});
const LOCAL: VerificationConfig = { ...FREE, fixturesEnabled: true, timeoutMs: 50 };

function subject(number: string, overrides: Partial<VerificationSubject> = {}): VerificationSubject {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    submission: 1,
    accountName: "Joana Ávila",
    declaredTitularity: true,
    region: "06",
    registrationNumber: number,
    education: [],
    ...overrides,
  };
}

function deps(config: VerificationConfig, extra: Partial<OrchestratorDeps> = {}): OrchestratorDeps {
  return {
    config,
    registryProviders: [
      createCfpOfficialProvider({ enabled: config.cfpOfficialEnabled }),
      createInfosimplesProvider(config.infosimples),
      createFixtureRegistryProvider(config.fixturesEnabled, () => "JOANA AVILA"),
    ],
    identityProviders: [
      createLocalIdentityProvider(),
      createFixtureIdentityProvider(config.fixturesEnabled),
      createDatavalidProvider(config.datavalid),
    ],
    educationProviders: [],
    costGuard: new CostGuard(config.paidDailyLimit),
    breaker: new CircuitBreaker(),
    registryCache: new TtlCache(60_000),
    ...extra,
  };
}

/** Provider pago de QA que conta chamadas. */
function spyPaid(onCall: () => void): ProfessionalRegistryProvider {
  return {
    id: "qa_paid_registry",
    kind: "registry",
    billing: "paid",
    sourceType: "optional_provider",
    productionAccepted: true,
    availability: () => ({ available: true }),
    async lookup(input) {
      onCall();
      return {
        source: "optional_provider", provider: "qa_paid_registry", registryNumber: input.number, region: input.region,
        professionalName: "Joana Avila", status: "ACTIVE", specialty: null, checkedAt: new Date().toISOString(),
        confidence: 1, evidenceLevel: "third_party",
      };
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("configuracao — ZERO_COST_BASELINE", () => {
  it("sem nenhuma variavel: pagos desligados, orcamento zero, sem fixture", () => {
    expect(FREE.infosimples.enabled).toBe(false);
    expect(FREE.datavalid.enabled).toBe(false);
    expect(FREE.paidDailyLimit).toBe(0);
    expect(FREE.fixturesEnabled).toBe(false);
    expect(FREE.cfpOfficialEnabled).toBe(true);
  });

  it("chave sozinha nunca liga provider pago", () => {
    const c = readVerificationConfig({ INFOSIMPLES_TOKEN: "x", DATAVALID_CLIENT_ID: "a", DATAVALID_CLIENT_SECRET: "b", PAID_VERIFICATION_DAILY_LIMIT: "50" });
    expect(c.infosimples).toEqual({ enabled: false, reason: "flag_off" });
    expect(c.datavalid).toEqual({ enabled: false, reason: "flag_off" });
  });

  it("flag + chave com orcamento 0: continua desligado", () => {
    const c = readVerificationConfig({ ELYRA_INFOSIMPLES_ENABLED: "true", INFOSIMPLES_TOKEN: "x" });
    expect(c.infosimples).toEqual({ enabled: false, reason: "budget_zero" });
  });

  it("fixture so em ambiente local", () => {
    expect(readVerificationConfig({ ELYRA_VERIFICATION_FIXTURES: "local", NEXT_PUBLIC_SUPABASE_URL: "https://x.example.invalid" }).fixturesEnabled).toBe(false);
    expect(
      readVerificationConfig({ ELYRA_VERIFICATION_FIXTURES: "local", NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54381" }).fixturesEnabled,
    ).toBe(false);
    expect(readVerificationConfig({ ELYRA_VERIFICATION_FIXTURES: "local", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54381" }).fixturesEnabled).toBe(true);
    expect(
      readVerificationConfig({ ELYRA_VERIFICATION_FIXTURES: "local", NODE_ENV: "production", ELYRA_RUNTIME_ENV: "qa", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54381" }).fixturesEnabled,
    ).toBe(true);
    expect(
      readVerificationConfig({ ELYRA_VERIFICATION_FIXTURES: "local", NODE_ENV: "production", ELYRA_RUNTIME_ENV: "qa", NEXT_PUBLIC_SUPABASE_URL: "https://x.example.invalid" }).fixturesEnabled,
    ).toBe(false);
  });
});

describe("modo gratuito (nenhum provider pago) — matriz §41", () => {
  it("sem fonte oficial automatizavel: UNDER_REVIEW, sem erro, zero chamada paga, zero rede", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const run = await runProfessionalVerification(subject("123456"), deps(FREE));
    expect(run.decision.outcome).toBe("UNDER_REVIEW");
    expect(run.decision.reasons).toContain("professional_registry:unverified_contract");
    expect(run.paidCalls).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("identidade gratuita e so declarada: nunca aprova", async () => {
    const run = await runProfessionalVerification(subject("123456"), deps(FREE));
    const identity = run.evidence.find((item) => item.fact === "identity_match");
    expect(identity).toMatchObject({ status: "UNVERIFIED", assurance: "identity_declared" });
  });

  it("formato invalido: correcao, sem consultar fonte nenhuma", async () => {
    const calls = vi.fn();
    const run = await runProfessionalVerification(subject("ab"), deps(LOCAL, { registryProviders: [spyPaid(calls)] }));
    expect(run.decision).toMatchObject({ outcome: "PENDING_CORRECTION", reasons: ["registry_format_invalid"] });
    expect(calls).not.toHaveBeenCalled();
  });

  it("sem declaracao de titularidade: correcao", async () => {
    const run = await runProfessionalVerification(subject("120001", { declaredTitularity: false }), deps(LOCAL));
    expect(run.decision.reasons).toContain("identity_unconfirmed");
  });

  it.each([
    ["120001", "VERIFIED", []],
    ["120002", "REJECTED", ["registry_inactive"]],
    ["120003", "PENDING_CORRECTION", ["registry_mismatch"]],
    ["120005", "PENDING_CORRECTION", ["name_mismatch"]],
  ])("fixture local %s → %s", async (number, outcome, reasons) => {
    const run = await runProfessionalVerification(subject(number), deps(LOCAL));
    expect(run.decision.outcome).toBe(outcome);
    if (reasons.length) expect(run.decision.reasons).toEqual(reasons);
  });

  it.each([
    ["120004", "timeout"],
    ["120006", "http_5xx"],
    ["120007", "quota_exhausted"],
  ])("fonte com falha %s (%s): UNDER_REVIEW, sem excecao, nunca REJECTED", async (number, category) => {
    const run = await runProfessionalVerification(subject(number), deps(LOCAL));
    expect(run.decision.outcome).toBe("UNDER_REVIEW");
    expect(run.evidence.find((item) => item.fact === "professional_registry")).toMatchObject({
      status: "SOURCE_UNAVAILABLE",
    });
    expect(
      run.evidence.filter((item) => item.fact === "professional_registry").map((item) => `${item.provider}:${item.detail}`),
    ).toContain(`qa_fixture_registry:${category}`);
  });
});

describe("providers opcionais pagos — matriz §42/§23/§24", () => {
  it("InfoSimples e Datavalid sem credencial: NOT_CONFIGURED e zero request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(createInfosimplesProvider(FREE.infosimples).availability()).toEqual({ available: false, reason: "NOT_CONFIGURED" });
    expect(createDatavalidProvider(FREE.datavalid).availability()).toEqual({ available: false, reason: "NOT_CONFIGURED" });
    await runProfessionalVerification(subject("123456"), deps(FREE));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("mesmo ligados, contrato nao verificado: nenhuma chamada paga automatica", async () => {
    const enabled = readVerificationConfig({
      ELYRA_INFOSIMPLES_ENABLED: "true", INFOSIMPLES_TOKEN: "t",
      ELYRA_DATAVALID_ENABLED: "true", DATAVALID_CLIENT_ID: "a", DATAVALID_CLIENT_SECRET: "b",
      PAID_VERIFICATION_DAILY_LIMIT: "10",
    });
    expect(enabled.infosimples.enabled).toBe(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const run = await runProfessionalVerification(subject("123456"), deps(enabled));
    expect(run.paidCalls).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(run.decision.outcome).toBe("UNDER_REVIEW");
  });

  it("provider pago de QA com orcamento 0: zero chamadas", async () => {
    const calls = vi.fn();
    const run = await runProfessionalVerification(subject("123456"), deps(FREE, { registryProviders: [spyPaid(calls)] }));
    expect(calls).not.toHaveBeenCalled();
    expect(run.evidence.map((item) => `${item.provider}:${item.detail}`)).toContain("qa_paid_registry:budget_exhausted");
  });

  it("provider pago de QA habilitado: a decisao usa a evidencia extra (so registro; identidade segue insuficiente)", async () => {
    const calls = vi.fn();
    const config = { ...FREE, paidDailyLimit: 1 };
    const run = await runProfessionalVerification(subject("123456"), deps(config, { registryProviders: [spyPaid(calls)] }));
    expect(calls).toHaveBeenCalledTimes(1);
    expect(run.paidCalls).toBe(1);
    expect(run.decision.gates.find((gate) => gate.gate === "professional_registry")?.accepted).toBe(true);
    expect(run.decision.outcome).toBe("UNDER_REVIEW");
  });

  it("orcamento se esgota: a segunda consulta paga nao acontece", async () => {
    const calls = vi.fn();
    const shared = deps({ ...FREE, paidDailyLimit: 1 }, { registryProviders: [spyPaid(calls)], registryCache: new TtlCache(0) });
    await runProfessionalVerification(subject("123456"), shared);
    await runProfessionalVerification(subject("654381"), shared);
    expect(calls).toHaveBeenCalledTimes(1);
  });

  it("disjuntor abre depois de 3 falhas seguidas", async () => {
    const shared = deps(LOCAL, { registryCache: new TtlCache(0) });
    for (let i = 0; i < 3; i += 1) await runProfessionalVerification(subject("120006"), shared);
    const run = await runProfessionalVerification(subject("120001"), shared);
    expect(run.evidence.map((item) => `${item.provider}:${item.detail}`)).toContain("qa_fixture_registry:circuit_open");
  });
});

describe("formacao e XML", () => {
  it("e-MEC prova IES, nunca conclusao — e nao e gate", async () => {
    const reader = { activeSource: async () => "emec_open_data" as const, findInstitution: async () => ({ found: true, activeCourse: null }) };
    const run = await runProfessionalVerification(
      subject("123456", { education: [{ institution: "Universidade X", title: "Psicologia" }] }),
      deps(FREE, { educationProviders: [createEmecSnapshotProvider(reader, "emec_open_data")] }),
    );
    expect(run.evidence.find((item) => item.fact === "education")).toMatchObject({ status: "PASS", detail: "institution_registered" });
    expect(run.decision.gates.map((gate) => gate.gate)).not.toContain("education");
  });

  it("snapshot de QA nunca vira evidencia 'oficial'", async () => {
    const reader = { activeSource: async () => "qa_fixture" as const, findInstitution: async () => ({ found: true, activeCourse: null }) };
    const run = await runProfessionalVerification(
      subject("123456", { education: [{ institution: "Universidade X", title: "Psicologia" }] }),
      deps(FREE, { educationProviders: [createEmecSnapshotProvider(reader, "qa_fixture")] }),
    );
    expect(run.evidence.find((item) => item.fact === "education")).toMatchObject({ sourceType: "qa_fixture", provider: "qa_fixture_emec" });
  });

  it("e-MEC sem snapshot: indisponivel, sem evidencia", async () => {
    const run = await runProfessionalVerification(
      subject("123456", { education: [{ institution: "Universidade X", title: "Psicologia" }] }),
      deps(FREE, { educationProviders: [createEmecSnapshotProvider(null, null)] }),
    );
    expect(run.evidence.some((item) => item.fact === "education")).toBe(false);
  });

  const enc = (text: string) => new TextEncoder().encode(text);
  it("XML seguro: recusa XXE, DTD, bomba de entidades, PI, profundidade e tamanho", () => {
    expect(guardXml(enc('<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><d>&x;</d>'))).toEqual({ ok: false, reason: "doctype_forbidden" });
    expect(guardXml(enc('<!ENTITY a "aaaa"><d/>'))).toEqual({ ok: false, reason: "entity_forbidden" });
    expect(guardXml(enc('<?xml version="1.0"?><?xml-stylesheet href="x"?><d/>'))).toEqual({ ok: false, reason: "processing_instruction" });
    expect(guardXml(enc(`${"<a>".repeat(70)}${"</a>".repeat(70)}`))).toEqual({ ok: false, reason: "too_deep" });
    expect(guardXml(new Uint8Array(2 * 1024 * 1024 + 1))).toEqual({ ok: false, reason: "too_large" });
    expect(guardXml(new Uint8Array([0xff, 0xfe, 0x00]))).toEqual({ ok: false, reason: "not_utf8" });
    expect(guardXml(enc("<a><b></a>"))).toMatchObject({ ok: false });
    expect(guardXml(enc('<?xml version="1.0" encoding="UTF-8"?><Diploma><Nome>X</Nome><!-- c --><Vazio/></Diploma>'))).toEqual({ ok: true, elements: 3, depth: 2 });
  });
});

describe("executor (veltrix-service)", () => {
  function client() {
    const rpc = vi.fn(async () => ({ data: "pending", error: null }));
    return { rpc } as unknown as Parameters<typeof verifySubmission>[0] & { rpc: typeof rpc };
  }

  it("sem executor confiavel (sem chave): segue pela fila humana, sem erro", async () => {
    const c = client();
    const result = await verifySubmission(c, subject("120001"), { config: LOCAL, store: null });
    expect(result).toMatchObject({ verificationStatus: "pending", automated: false });
    expect(c.rpc).toHaveBeenCalledWith("record_professional_precheck", expect.objectContaining({ p_outcome: "manual_hold" }));
  });

  it("VERIFIED com prova: executa pelo executor confiavel", async () => {
    const store: TrustedVerificationStore = {
      recordEvidence: vi.fn(async () => {}),
      applyAutomated: vi.fn(async () => "verified"),
      emecReader: () => ({ activeSource: async () => null, findInstitution: async () => ({ found: false, activeCourse: null }) }),
    };
    const c = client();
    const result = await verifySubmission(c, subject("120001"), { config: LOCAL, store });
    expect(result).toMatchObject({ verificationStatus: "verified", automated: true });
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("banco recusa a prova: vira fila humana, sem erro de produto", async () => {
    const store: TrustedVerificationStore = {
      recordEvidence: vi.fn(async () => {}),
      applyAutomated: vi.fn(async () => {
        throw new Error("mandatory evidence not proven");
      }),
      emecReader: () => ({ activeSource: async () => null, findInstitution: async () => ({ found: false, activeCourse: null }) }),
    };
    const c = client();
    const result = await verifySubmission(c, subject("120001"), { config: LOCAL, store });
    expect(result).toMatchObject({ verificationStatus: "pending", automated: false });
  });

  it("correcao vai pela pre-checagem restrita com o motivo", async () => {
    const c = client();
    const result = await verifySubmission(c, subject("120005"), { config: LOCAL, store: null });
    expect(result.verificationStatus).toBe("needs_correction");
    expect(c.rpc).toHaveBeenCalledWith("record_professional_precheck", expect.objectContaining({ p_reason_code: "name_mismatch" }));
  });

  it("log de provider nao carrega nome nem registro", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    await runProfessionalVerification(subject("120006", { accountName: "Maria Sigilosa" }), deps(LOCAL));
    const lines = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(lines).toContain("elyra.verification_provider");
    expect(lines).not.toMatch(/Maria|Sigilosa|120006/);
  });
});
