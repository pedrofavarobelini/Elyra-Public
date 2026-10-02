/**
 * Motor de decisao da verificacao profissional V2 (ADR-0028, "Veltrix").
 *
 * Puro e deterministico: recebe EVIDENCIA ja coletada (nunca "aprova esse
 * cara") e devolve decisao + estado de cada gate. Nao chama rede, LLM nem
 * banco. O banco confere tudo de novo em `apply_automated_verification_for`;
 * este arquivo e o espelho que decide o que PEDIR ao banco.
 *
 * Gates obrigatorios (so eles liberam capacidade profissional):
 *   auth_account · required_terms · registry_format · identity_match ·
 *   professional_registry · registry_holder_match · registry_status
 *
 * Nenhum gate nomeia provider. "Registro" pode vir do CFP oficial hoje e de
 * outra fonte amanha sem mudar o dominio; provider pago nunca e requisito.
 *
 * Ordem das regras:
 * 1. Sinal de seguranca (replay, adulteracao, duplicidade) → UNDER_REVIEW.
 * 2. Incompatibilidade PROVADA (registro inativo + mesmo titular, fonte
 *    aceita) → REJECTED.
 * 3. Algo que o profissional corrige → PENDING_CORRECTION.
 * 4. Todo gate PASS por fonte aceita → VERIFIED.
 * 5. Qualquer outra coisa (fonte indisponivel, identidade so declarada,
 *    provider nao configurado) → UNDER_REVIEW.
 *
 * Incerteza nunca vira aprovacao; ausencia de provider nunca vira recusa.
 */

export const VERIFICATION_POLICY_VERSION_V2 = "stage29.v2";

export const MANDATORY_GATES = [
  "auth_account",
  "required_terms",
  "registry_format",
  "identity_match",
  "professional_registry",
  "registry_holder_match",
  "registry_status",
] as const;
export type MandatoryGate = (typeof MANDATORY_GATES)[number];

export const ENRICHMENT_FACTS = ["education", "experience", "certification"] as const;
export type EvidenceFact = MandatoryGate | (typeof ENRICHMENT_FACTS)[number];

export const SOURCE_TYPES = [
  "official_registry",
  "official_open_data",
  "local_evidence",
  "optional_provider",
  "human_review",
  "demo_local",
  "qa_fixture",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Do mais fraco ao mais forte. Nada chega a "strongly" sem prova forte. */
export const ASSURANCE_LEVELS = [
  "authenticated",
  "identity_declared",
  "identity_document_crosschecked",
  "identity_strongly_verified",
] as const;
export type Assurance = (typeof ASSURANCE_LEVELS)[number];

export const EVIDENCE_STATUSES = [
  "PASS",
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
  "NOT_CONFIGURED",
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export interface Evidence {
  fact: EvidenceFact;
  sourceType: SourceType;
  /** Codigo interno do provider. Nunca aparece para o usuario. */
  provider: string;
  status: EvidenceStatus;
  /** Codigo curto (`registry_inactive`), nunca texto livre nem dado pessoal. */
  detail?: string;
  assurance?: Assurance;
  valueDigest?: string;
  confidence?: number;
  checkedAt: string;
  expiresAt?: string;
}

export type CorrectionReason =
  | "registry_format_invalid"
  | "identity_unconfirmed"
  | "information_insufficient"
  | "name_mismatch"
  | "document_unreadable"
  | "registry_mismatch";

export type VerificationOutcome = "VERIFIED" | "PENDING_CORRECTION" | "UNDER_REVIEW" | "REJECTED";

export interface GateState {
  gate: MandatoryGate;
  status: EvidenceStatus;
  accepted: boolean;
}

export interface DecisionV2 {
  outcome: VerificationOutcome;
  reasons: string[];
  gates: GateState[];
  policyVersion: typeof VERIFICATION_POLICY_VERSION_V2;
}

export const MIN_CONFIDENCE = 0.9;
export const MAX_EVIDENCE_AGE_MS = 24 * 60 * 60 * 1000;
const SECURITY: EvidenceStatus[] = ["REPLAY", "TAMPERED", "DUPLICATE"];
const STRONG_IDENTITY: Assurance[] = ["identity_document_crosschecked", "identity_strongly_verified"];

/** Espelho de `public.verification_evidence_accepted` (migration V2). */
export function evidenceAccepted(evidence: Evidence, options: { acceptFixtures: boolean }): boolean {
  const { fact, sourceType, assurance } = evidence;
  if (sourceType === "qa_fixture" || sourceType === "demo_local") {
    return options.acceptFixtures && (fact !== "identity_match" || STRONG_IDENTITY.includes(assurance as Assurance));
  }
  switch (fact) {
    case "professional_registry":
    case "registry_holder_match":
    case "registry_status":
      return sourceType === "official_registry" || sourceType === "optional_provider";
    case "identity_match":
      return (
        ["official_registry", "optional_provider", "local_evidence", "human_review"].includes(sourceType) &&
        STRONG_IDENTITY.includes(assurance as Assurance)
      );
    case "auth_account":
    case "required_terms":
    case "registry_format":
      return sourceType === "local_evidence";
    default:
      return false;
  }
}

/** Ranking de gravidade: o pior vence quando o mesmo fato tem varias evidencias. */
function severity(status: EvidenceStatus): number {
  if (SECURITY.includes(status)) return 5;
  if (status === "FAIL" || status === "MISMATCH") return 4;
  if (status === "DOCUMENT_UNREADABLE" || status === "UNSUPPORTED_FORMAT" || status === "INSUFFICIENT") return 3;
  if (status === "PASS") return 0;
  return 2;
}

function normalized(evidence: Evidence, now: number): Evidence {
  if (evidence.status !== "PASS") return evidence;
  if (typeof evidence.confidence === "number" && !(evidence.confidence >= MIN_CONFIDENCE)) {
    return { ...evidence, status: "LOW_CONFIDENCE" };
  }
  const checked = Date.parse(evidence.checkedAt);
  if (!Number.isFinite(checked) || now - checked > MAX_EVIDENCE_AGE_MS) {
    return { ...evidence, status: "UNVERIFIED", detail: "evidence_stale" };
  }
  if (evidence.expiresAt && Date.parse(evidence.expiresAt) <= now) {
    return { ...evidence, status: "UNVERIFIED", detail: "evidence_expired" };
  }
  return evidence;
}

function correctionFor(gate: MandatoryGate, evidence: Evidence | undefined): CorrectionReason | null {
  if (!evidence) return null;
  switch (evidence.status) {
    case "MISMATCH":
      return gate === "registry_holder_match" || gate === "identity_match" ? "name_mismatch" : "registry_mismatch";
    case "INSUFFICIENT":
      return "information_insufficient";
    case "DOCUMENT_UNREADABLE":
    case "UNSUPPORTED_FORMAT":
      return "document_unreadable";
    case "FAIL":
      if (gate === "required_terms") return "identity_unconfirmed";
      if (gate === "registry_format") return "registry_format_invalid";
      // "Nao encontrado" pode ser digitacao: correcao, nunca recusa.
      if (gate === "professional_registry" && evidence.detail === "registry_not_found") return "registry_mismatch";
      return null;
    default:
      return null;
  }
}

export function decideFromEvidence(
  input: readonly Evidence[],
  options: { acceptFixtures: boolean; now?: number } = { acceptFixtures: false },
): DecisionV2 {
  const now = options.now ?? Date.now();
  const items = input.map((item) => normalized(item, now));
  const worst = new Map<EvidenceFact, Evidence>();
  for (const item of items) {
    const previous = worst.get(item.fact);
    if (!previous || severity(item.status) > severity(previous.status)) worst.set(item.fact, item);
  }

  const gates: GateState[] = MANDATORY_GATES.map((gate) => {
    const evidence = worst.get(gate);
    const status: EvidenceStatus = evidence?.status ?? "UNKNOWN";
    return {
      gate,
      status,
      accepted: Boolean(evidence && status === "PASS" && evidenceAccepted(evidence, options)),
    };
  });
  const result = (outcome: VerificationOutcome, reasons: string[]): DecisionV2 => ({
    outcome,
    reasons,
    gates,
    policyVersion: VERIFICATION_POLICY_VERSION_V2,
  });

  const security = items.filter((item) => SECURITY.includes(item.status));
  if (security.length) {
    return result("UNDER_REVIEW", security.map((item) => `${item.fact}:${item.status.toLowerCase()}`));
  }

  const status = worst.get("registry_status");
  const holder = worst.get("registry_holder_match");
  if (
    status?.status === "FAIL" &&
    status.detail === "registry_inactive" &&
    evidenceAccepted(status, options) &&
    holder?.status === "PASS" &&
    evidenceAccepted(holder, options)
  ) {
    return result("REJECTED", ["registry_inactive"]);
  }

  const corrections = [
    ...new Set(
      MANDATORY_GATES.map((gate) => correctionFor(gate, worst.get(gate))).filter(
        (reason): reason is CorrectionReason => reason !== null,
      ),
    ),
  ];
  if (corrections.length) return result("PENDING_CORRECTION", corrections);

  if (gates.every((gate) => gate.accepted)) return result("VERIFIED", []);

  return result(
    "UNDER_REVIEW",
    gates
      .filter((gate) => !gate.accepted)
      .map((gate) => {
        const evidence = worst.get(gate.gate);
        const why = gate.status === "PASS" ? "source_not_accepted" : (evidence?.detail ?? gate.status.toLowerCase());
        return `${gate.gate}:${why}`;
      }),
  );
}

/** Nome comparavel: sem acento, caixa, pontuacao e espaco duplicado. */
export function normalizePersonName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
