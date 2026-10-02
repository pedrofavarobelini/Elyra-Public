import { describe, expect, it } from "vitest";

import {
  collectV1Facts,
  decideVerification,
  executablePrecheck,
  registryFormatFact,
  REQUIRED_FACTS,
  type FactResult,
} from "./verification-orchestrator";

const allPass = (): FactResult[] => REQUIRED_FACTS.map((fact) => ({ fact, status: "PASS", officialSource: true }));
const withFact = (override: FactResult): FactResult[] => [
  ...allPass().filter((f) => f.fact !== override.fact),
  override,
];

/** Matriz §46 do prompt mestre: cada linha e um caso, com o desfecho exigido. */
describe("orquestrador de verificacao — matriz §46", () => {
  it("valido em tudo → AUTO_APPROVE (motor), mas V1 executa manual hold", () => {
    const decision = decideVerification(allPass());
    expect(decision.outcome).toBe("AUTO_APPROVE");
    expect(executablePrecheck(decision)).toEqual({
      outcome: "manual_hold",
      reasonCode: "automated_precheck_manual_hold",
    });
  });

  it("documento ausente → nunca aprova (MANUAL_HOLD)", () => {
    const facts = allPass().filter((f) => f.fact !== "identity_document");
    expect(decideVerification(facts).outcome).toBe("MANUAL_HOLD");
  });

  it("documento ilegivel → PENDING_CORRECTION", () => {
    const d = decideVerification(withFact({ fact: "identity_document", status: "DOCUMENT_UNREADABLE" }));
    expect(d).toEqual({ outcome: "PENDING_CORRECTION", reasons: ["document_unreadable"] });
  });

  it("pessoa errada no documento → PENDING_CORRECTION (nome), nunca recusa", () => {
    const d = decideVerification(withFact({ fact: "identity_document", status: "MISMATCH" }));
    expect(d).toEqual({ outcome: "PENDING_CORRECTION", reasons: ["name_mismatch"] });
  });

  it("nome divergente do registro → PENDING_CORRECTION", () => {
    const d = decideVerification(withFact({ fact: "registry_holder_name", status: "MISMATCH" }));
    expect(d.outcome).toBe("PENDING_CORRECTION");
  });

  it("registro invalido (formato) → PENDING_CORRECTION", () => {
    const d = decideVerification(withFact(registryFormatFact("CRP-ABC")));
    expect(d).toEqual({ outcome: "PENDING_CORRECTION", reasons: ["registry_format_invalid"] });
  });

  it("registro nao encontrado na fonte oficial → correcao (pode ser digitacao)", () => {
    const d = decideVerification(
      withFact({ fact: "registry_active", status: "FAIL", detail: "registry_not_found", officialSource: true }),
    );
    expect(d).toEqual({ outcome: "PENDING_CORRECTION", reasons: ["registry_mismatch"] });
  });

  it("registro inativo, fonte oficial, mesmo titular → REJECTED (motor); V1 manda ao humano", () => {
    const d = decideVerification(
      withFact({ fact: "registry_active", status: "FAIL", detail: "registry_inactive", officialSource: true }),
    );
    expect(d.outcome).toBe("REJECTED");
    expect(executablePrecheck(d).outcome).toBe("manual_hold");
  });

  it("registro inativo por fonte NAO oficial → nunca recusa", () => {
    const d = decideVerification(
      withFact({ fact: "registry_active", status: "FAIL", detail: "registry_inactive", officialSource: false }),
    );
    expect(d.outcome).not.toBe("REJECTED");
  });

  it("registro inativo com nome divergente → corrigir antes de recusar", () => {
    const facts = allPass()
      .filter((f) => f.fact !== "registry_active" && f.fact !== "registry_holder_name")
      .concat([
        { fact: "registry_active", status: "FAIL", detail: "registry_inactive", officialSource: true },
        { fact: "registry_holder_name", status: "MISMATCH" },
      ]);
    expect(decideVerification(facts).outcome).toBe("PENDING_CORRECTION");
  });

  it.each([
    ["fonte indisponivel", "SOURCE_UNAVAILABLE"],
    ["erro de rede", "NETWORK_ERROR"],
    ["credencial da fonte expirada", "CREDENTIAL_EXPIRED"],
    ["desconhecido", "UNKNOWN"],
    ["nao verificado", "UNVERIFIED"],
  ] as const)("%s → MANUAL_HOLD", (_label, status) => {
    expect(decideVerification(withFact({ fact: "registry_active", status })).outcome).toBe("MANUAL_HOLD");
  });

  it("certificacao so declarada nao bloqueia nem aprova sozinha", () => {
    const d = decideVerification([...allPass(), { fact: "certification", status: "DECLARED_ONLY" }]);
    expect(d.outcome).toBe("AUTO_APPROVE");
    const partial = decideVerification([{ fact: "certification", status: "PASS" }]);
    expect(partial.outcome).toBe("MANUAL_HOLD");
  });

  it("documento duplicado (outra conta) → MANUAL_HOLD, nunca recusa automatica", () => {
    const d = decideVerification(withFact({ fact: "identity_document", status: "DUPLICATE" }));
    expect(d.outcome).toBe("MANUAL_HOLD");
  });

  it("replay → MANUAL_HOLD", () => {
    expect(decideVerification([...allPass(), { fact: "identity_document", status: "REPLAY" }]).outcome).toBe(
      "MANUAL_HOLD",
    );
  });

  it("anexo adulterado → MANUAL_HOLD mesmo com o resto PASS", () => {
    expect(decideVerification([...allPass(), { fact: "identity_document", status: "TAMPERED" }]).outcome).toBe(
      "MANUAL_HOLD",
    );
  });

  it("extracao de baixa confianca: PASS com confianca 0.6 vira LOW_CONFIDENCE → MANUAL_HOLD", () => {
    const d = decideVerification(withFact({ fact: "identity_document", status: "PASS", confidence: 0.6 }));
    expect(d.outcome).toBe("MANUAL_HOLD");
  });

  it("formato nao suportado → PENDING_CORRECTION (reenviar legivel)", () => {
    const d = decideVerification(withFact({ fact: "identity_document", status: "UNSUPPORTED_FORMAT" }));
    expect(d).toEqual({ outcome: "PENDING_CORRECTION", reasons: ["document_unreadable"] });
  });

  it("manual hold explicito: fato repetido — PASS nao mascara o pior resultado", () => {
    const facts = [...allPass(), { fact: "registry_active", status: "SOURCE_UNAVAILABLE" } as FactResult];
    expect(decideVerification(facts).outcome).toBe("MANUAL_HOLD");
  });

  it("reenvio de correcao: depois de corrigir, volta a decidir do zero", () => {
    const before = decideVerification(withFact(registryFormatFact("ABC")));
    const after = decideVerification(withFact(registryFormatFact("06/123456")));
    expect(before.outcome).toBe("PENDING_CORRECTION");
    expect(after.outcome).toBe("AUTO_APPROVE");
  });

  it("aprovacao eventual so humana: fatos da V1 nunca chegam a AUTO_APPROVE", () => {
    const d = decideVerification(collectV1Facts({ identityConfirmed: true, registrationNumber: "06/123456" }));
    expect(d.outcome).toBe("MANUAL_HOLD");
    expect(d.reasons).toContain("registry_active:no_automatable_official_source");
    expect(executablePrecheck(d).outcome).toBe("manual_hold");
  });

  it("fato obrigatorio ausente conta como UNKNOWN, nunca como PASS", () => {
    expect(decideVerification([]).outcome).toBe("MANUAL_HOLD");
  });

  it("V1: formato invalido vira pedido de correcao executavel", () => {
    const d = decideVerification(collectV1Facts({ identityConfirmed: true, registrationNumber: "abc/xyz" }));
    expect(executablePrecheck(d)).toEqual({ outcome: "needs_correction", reasonCode: "registry_format_invalid" });
  });
});
