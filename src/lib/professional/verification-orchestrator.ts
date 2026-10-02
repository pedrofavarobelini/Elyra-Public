

export const VERIFICATION_POLICY_VERSION = "stage29.f3.v1";

export const REQUIRED_FACTS = [
  "identity_confirmed",
  "registry_format",
  "registry_active",
  "registry_holder_name",
  "identity_document",
] as const;
export type RequiredFact = (typeof REQUIRED_FACTS)[number];

export const OPTIONAL_FACTS = ["education", "experience", "certification"] as const;
export type OptionalFact = (typeof OPTIONAL_FACTS)[number];

export type FactId = RequiredFact | OptionalFact;

export const FACT_STATUSES = [
  "PASS",
  // incompatibilidade objetiva, com fonte oficial
  "FAIL",
  "MISMATCH",
  "INSUFFICIENT",
  "UNKNOWN",
  "UNVERIFIED",
  "DECLARED_ONLY",
  "SOURCE_UNAVAILABLE",
  "NETWORK_ERROR",
  "CREDENTIAL_EXPIRED",
  "DOCUMENT_UNREADABLE",
  "UNSUPPORTED_FORMAT",
  "LOW_CONFIDENCE",
  "DUPLICATE",
  "TAMPERED",
  "REPLAY",
] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];

export interface FactResult {
  fact: FactId;
  status: FactStatus;
  /** Detalhe codificado, sem dado pessoal (ex.: `registry_inactive`). */
  detail?: string;
  /** 0..1, so para extracao; abaixo do limiar vira LOW_CONFIDENCE. */
  confidence?: number;
  /** A fonte e oficial (conselho). Sem isso, FAIL nunca vira recusa. */
  officialSource?: boolean;
}

export type CorrectionReason =
  | "registry_format_invalid"
  | "identity_unconfirmed"
  | "information_insufficient"
  | "name_mismatch"
  | "document_unreadable"
  | "registry_mismatch";

export type VerificationDecision =
  | { outcome: "AUTO_APPROVE"; reasons: [] }
  | { outcome: "REJECTED"; reasons: ["registry_inactive"] }
  | { outcome: "PENDING_CORRECTION"; reasons: CorrectionReason[] }
  | { outcome: "MANUAL_HOLD"; reasons: string[] };

export const MIN_EXTRACTION_CONFIDENCE = 0.9;

const SECURITY: FactStatus[] = ["REPLAY", "TAMPERED", "DUPLICATE"];

function normalized(result: FactResult): FactResult {
  if (
    result.status === "PASS" &&
    typeof result.confidence === "number" &&
    !(result.confidence >= MIN_EXTRACTION_CONFIDENCE)
  ) {
    return { ...result, status: "LOW_CONFIDENCE" };
  }
  return result;
}

function correctionFor(result: FactResult): CorrectionReason | null {
  switch (result.status) {
    case "MISMATCH":
      return result.fact === "registry_holder_name" || result.fact === "identity_document"
        ? "name_mismatch"
        : "registry_mismatch";
    case "INSUFFICIENT":
      return "information_insufficient";
    case "DOCUMENT_UNREADABLE":
    case "UNSUPPORTED_FORMAT":
      return "document_unreadable";
    case "FAIL":
      if (result.fact === "identity_confirmed") return "identity_unconfirmed";
      if (result.fact === "registry_format") return "registry_format_invalid";
      // "Nao encontrado" pode ser digitacao: correcao, nao recusa.
      if (result.fact === "registry_active" && result.detail === "registry_not_found") return "registry_mismatch";
      return null;
    default:
      return null;
  }
}

function isIncompatible(result: FactResult): boolean {
  return (
    result.fact === "registry_active" &&
    result.status === "FAIL" &&
    result.detail === "registry_inactive" &&
    result.officialSource === true
  );
}

export function decideVerification(input: FactResult[]): VerificationDecision {
  const facts = input.map(normalized);
  const byFact = new Map<FactId, FactResult>();
  for (const fact of facts) {
    // Fato repetido: vale o pior. Nunca deixar um PASS mascarar outro resultado.
    const previous = byFact.get(fact.fact);
    if (!previous || previous.status === "PASS") byFact.set(fact.fact, fact);
  }

  const security = facts.filter((f) => SECURITY.includes(f.status));
  if (security.length) {
    return { outcome: "MANUAL_HOLD", reasons: security.map((f) => `${f.fact}:${f.status.toLowerCase()}`) };
  }

  const required = REQUIRED_FACTS.map(
    (fact) => byFact.get(fact) ?? ({ fact, status: "UNKNOWN", detail: "not_collected" } satisfies FactResult),
  );

  if (required.some(isIncompatible)) {
    // Registro inativo, mas o nome tambem diverge? Pode ser o registro errado:
    // corrigir antes de recusar.
    const holder = byFact.get("registry_holder_name");
    if (holder?.status === "PASS") return { outcome: "REJECTED", reasons: ["registry_inactive"] };
  }

  const corrections = [...new Set(required.map(correctionFor).filter((r): r is CorrectionReason => r !== null))];
  if (corrections.length) return { outcome: "PENDING_CORRECTION", reasons: corrections };

  const pending = required.filter((f) => f.status !== "PASS");
  if (pending.length) {
    return {
      outcome: "MANUAL_HOLD",
      reasons: pending.map((f) => `${f.fact}:${(f.detail ?? f.status).toLowerCase()}`),
    };
  }
  return { outcome: "AUTO_APPROVE", reasons: [] };
}

/** O que a pre-checagem pode gravar no banco na V1. */
export type ExecutablePrecheck =
  | { outcome: "manual_hold"; reasonCode: "automated_precheck_manual_hold" }
  | { outcome: "needs_correction"; reasonCode: CorrectionReason };

export function executablePrecheck(decision: VerificationDecision): ExecutablePrecheck {
  if (decision.outcome === "PENDING_CORRECTION") {
    return { outcome: "needs_correction", reasonCode: decision.reasons[0] ?? "information_insufficient" };
  }
  // AUTO_APPROVE e REJECTED nao sao executaveis automaticamente na V1.
  return { outcome: "manual_hold", reasonCode: "automated_precheck_manual_hold" };
}

/** Numero do registro depois da normalizacao do banco (so A-Z0-9). */
export function registryFormatFact(registrationNumber: string | null | undefined): FactResult {
  const raw = (registrationNumber ?? "").trim();
  if (!raw) return { fact: "registry_format", status: "INSUFFICIENT" };
  const normalizedNumber = raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
  // CRP: digitos (a regiao pode vir prefixada, "06/123456"). Letras nao existem.
  return /^[0-9]{3,10}$/.test(normalizedNumber)
    ? { fact: "registry_format", status: "PASS" }
    : { fact: "registry_format", status: "FAIL", detail: "format" };
}


export function collectV1Facts(input: {
  identityConfirmed: boolean;
  registrationNumber: string | null;
}): FactResult[] {
  return [
    input.identityConfirmed
      ? { fact: "identity_confirmed", status: "PASS" }
      : { fact: "identity_confirmed", status: "FAIL" },
    registryFormatFact(input.registrationNumber),
    { fact: "registry_active", status: "SOURCE_UNAVAILABLE", detail: "no_automatable_official_source" },
    { fact: "registry_holder_name", status: "UNKNOWN", detail: "depends_on_registry_source" },
    { fact: "identity_document", status: "UNVERIFIED", detail: "document_not_collected" },
  ];
}
