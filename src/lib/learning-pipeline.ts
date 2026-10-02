import { createHash } from "node:crypto";

import {
  ELYRA_LEARNING_CONTRACT_VERSION,
  ELYRA_LEARNING_EXPORT_VERSION,
  ELYRA_LEARNING_INPUT_VERSION,
  ELYRA_LEARNING_POLICY_VERSION,
  MINIMUM_DAYS_WITH_DATA,
  MINIMUM_WINDOW_COMPLETENESS,
  QUALITY_CHECKS,
  SUBMIT_OPERATION,
  TRAINING_CONSENT_VERSION,
  elyraLearningSubmissionSchema,
  sanitizedLearningPayloadSchema,
  type ElyraLearningSubmission,
  type LearningAggregate,
  type QualityCheckName,
  type RejectionCode,
  type SanitizedLearningPayload,
} from "@/lib/contracts/learning";
import type { AnalyticsReportContract } from "@/lib/contracts/pedrocore";

/**
 * Pipeline de learning governado — etapas nomeadas e puras.
 *
 * `Eligibility -> Consent Gate -> Minimization -> Sanitization -> Provenance ->
 * Fingerprint -> Quality Gate -> Export`
 *
 * Cada etapa e uma funcao propria porque cada uma precisa ser testavel
 * isoladamente e negativamente. Esconder a governanca dentro de uma route
 * tornaria impossivel provar que ela recusa o que deve recusar.
 */

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface EligibilityInput {
  trainingConsentActive: boolean;
  report: AnalyticsReportContract;
}

export interface EligibilityResult {
  eligible: boolean;
  /** Inelegivel e resultado normal, nao erro tecnico: tem codigo proprio. */
  rejectionCode: RejectionCode | null;
}

/**
 * Decide se um snapshot pode virar candidato.
 *
 * Consentimento **nao** significa automaticamente elegivel: um relatorio quase
 * vazio consentido continua sendo um relatorio quase vazio. As duas condicoes
 * sao verificadas separadamente para que a recusa diga qual delas faltou.
 */
export function evaluateLearningEligibility(
  input: EligibilityInput,
): EligibilityResult {
  if (!input.trainingConsentActive) {
    return { eligible: false, rejectionCode: "training_consent_missing" };
  }

  const quality = input.report.dataQuality;
  const counts = [
    quality.daysWithMood,
    quality.daysWithAnxiety,
    quality.daysWithEnergy,
    quality.daysWithSleep,
  ];

  // Ao menos uma metrica precisa ter historico suficiente para ser defensavel.
  if (counts.every((count) => count < MINIMUM_DAYS_WITH_DATA)) {
    return { eligible: false, rejectionCode: "insufficient_data" };
  }

  const completeness =
    counts.reduce((sum, count) => sum + count, 0) /
    (counts.length * quality.daysInWindow);
  if (completeness < MINIMUM_WINDOW_COMPLETENESS) {
    return { eligible: false, rejectionCode: "insufficient_data" };
  }

  return { eligible: true, rejectionCode: null };
}

// ---------------------------------------------------------------------------
// Minimization
// ---------------------------------------------------------------------------

function toAggregate(
  comparison: AnalyticsReportContract["metrics"]["mood"],
  daysWithData: number,
): LearningAggregate {
  // Sem dia com registro nao existe media nem tendencia: ausencia nao e zero.
  if (daysWithData === 0 || comparison.currentSamples === 0) {
    return { mean: null, delta: null, trend: "insufficient_data", samples: 0 };
  }
  return {
    mean: comparison.current,
    delta: comparison.delta,
    trend: comparison.trend,
    samples: Math.min(comparison.currentSamples, daysWithData),
  };
}

/**
 * Reduz o snapshot ao minimo que um candidato precisa.
 *
 * O que **nao** atravessa, por construcao: serie diaria (cada ponto e uma data
 * identificavel), fuso, janelas, faixas menstruais registradas, associacoes
 * temporais e qualquer texto. O que sobra sao agregados e contagens.
 */
export function minimizeReport(
  report: AnalyticsReportContract,
): SanitizedLearningPayload {
  const quality = report.dataQuality;
  return sanitizedLearningPayloadSchema.parse({
    daysInWindow: quality.daysInWindow,
    mood: toAggregate(report.metrics.mood, quality.daysWithMood),
    anxiety: toAggregate(report.metrics.anxiety, quality.daysWithAnxiety),
    energy: toAggregate(report.metrics.energy, quality.daysWithEnergy),
    sleepDurationMinutes: toAggregate(
      report.metrics.sleepDurationMinutes,
      quality.daysWithSleep,
    ),
    daysWithMood: quality.daysWithMood,
    daysWithAnxiety: quality.daysWithAnxiety,
    daysWithEnergy: quality.daysWithEnergy,
    daysWithSleep: quality.daysWithSleep,
    // Somente o opt-in, nunca os dias ou as faixas registradas.
    cycleEnabled: report.cycle.enabled,
  });
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/** Chaves que denunciam conteudo bruto ou identificador direto. */
const FORBIDDEN_KEYS = new Set([
  "journal",
  "journalentries",
  "transcript",
  "rawtranscript",
  "audio",
  "video",
  "screenrecording",
  "media",
  "mediaassets",
  "storagepath",
  "storage_path",
  "signedurl",
  "userid",
  "user_id",
  "sessionid",
  "email",
  "name",
  "displayname",
  "professionalnote",
  "pedrocoreoutput",
  "rawprompt",
  "summary",
  "content",
  "text",
]);

export interface SanitizationFinding {
  path: string;
  reason: "forbidden_key" | "free_text";
}

/**
 * Varre o payload em busca de conteudo que nunca deveria estar ali.
 *
 * O schema ja impede o previsto — nao ha campo de texto declarado. Esta varredura
 * e a segunda barreira, para o caso de o payload ser montado por um caminho que
 * escape do tipo. Duas barreiras porque a primeira, sozinha, seria uma promessa.
 */
export function findSanitizationIssues(value: unknown): SanitizationFinding[] {
  const findings: SanitizationFinding[] = [];

  const walk = (node: unknown, path: string) => {
    if (typeof node === "string") {
      // Enum curto e esperado; frase nao.
      if (node.includes(" ") || node.length > 32) {
        findings.push({ path, reason: "free_text" });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [key, item] of Object.entries(node)) {
        const childPath = path ? `${path}.${key}` : key;
        if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
          findings.push({ path: childPath, reason: "forbidden_key" });
        }
        walk(item, childPath);
      }
    }
  };

  walk(value, "payload");
  return findings;
}

// ---------------------------------------------------------------------------
// Fingerprint
// ---------------------------------------------------------------------------

/**
 * JSON canonico: chaves ordenadas recursivamente e sem espaco.
 *
 * Espelha `json.dumps(..., sort_keys=True, separators=(",", ":"))` do PedroCore.
 * Ordem de chave nao pode mudar a identidade do conteudo governado.
 */
export function canonicalJson(value: unknown): string {
  const normalize = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(normalize);
    if (node !== null && typeof node === "object") {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(node as Record<string, unknown>).sort()) {
        sorted[key] = normalize((node as Record<string, unknown>)[key]);
      }
      return sorted;
    }
    return node;
  };
  return JSON.stringify(normalize(value));
}

/**
 * Fingerprint do payload canonico **sanitizado**.
 *
 * Nunca do texto bruto, nunca do JSON sem canonicalizacao e nunca incluindo
 * `correlationId` ou instante: correlacao muda a cada request, e um fingerprint
 * que muda a cada request nao deduplica nada.
 */
export function learningFingerprint(payload: SanitizedLearningPayload): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Quality Gate
// ---------------------------------------------------------------------------

export interface QualityGateResult {
  passed: boolean;
  checks: { name: QualityCheckName; passed: boolean }[];
  failed: QualityCheckName[];
}

/**
 * Gate deterministico. Nenhum LLM decide se um candidato e aceitavel.
 *
 * Cada gate e nomeado para que a recusa diga qual condicao faltou, em vez de
 * um "reprovado" opaco.
 */
export function runLearningQualityGate(
  payload: SanitizedLearningPayload,
): QualityGateResult {
  const counts = [
    payload.daysWithMood,
    payload.daysWithAnxiety,
    payload.daysWithEnergy,
    payload.daysWithSleep,
  ];
  const completeness =
    counts.reduce((sum, count) => sum + count, 0) /
    (counts.length * payload.daysInWindow);

  const aggregates = [
    payload.mood,
    payload.anxiety,
    payload.energy,
    payload.sleepDurationMinutes,
  ];
  const issues = findSanitizationIssues(payload);

  const results: Record<QualityCheckName, boolean> = {
    minimum_days_with_data: counts.some(
      (count) => count >= MINIMUM_DAYS_WITH_DATA,
    ),
    window_completeness: completeness >= MINIMUM_WINDOW_COMPLETENESS,
    no_free_text: !issues.some((issue) => issue.reason === "free_text"),
    no_direct_identifier: !issues.some(
      (issue) => issue.reason === "forbidden_key",
    ),
    value_domains: sanitizedLearningPayloadSchema.safeParse(payload).success
      // Agregado sem amostra nao pode carregar valor.
      && aggregates.every(
        (aggregate) =>
          aggregate.samples > 0 ||
          (aggregate.mean === null && aggregate.delta === null),
      ),
  };

  const checks = QUALITY_CHECKS.map((name) => ({
    name,
    passed: results[name],
  }));

  return {
    passed: checks.every((check) => check.passed),
    checks,
    failed: checks.filter((check) => !check.passed).map((check) => check.name),
  };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface SubmissionInput {
  report: AnalyticsReportContract;
  trainingConsentActive: boolean;
  trainingConsentGrantedAt: string;
  producedAt: string;
  evaluatedAt: string;
}

export type SubmissionOutcome =
  | { ok: true; submission: ElyraLearningSubmission; fingerprint: string }
  | { ok: false; rejectionCode: RejectionCode; failedChecks: QualityCheckName[] };

/**
 * Roda o pipeline inteiro e devolve a submissao pronta, ou a recusa nomeada.
 *
 * O retorno e uniao discriminada de proposito: quem chama nao consegue seguir em
 * frente sem tratar a recusa, e nao existe caminho em que um candidato viaje
 * sem ter passado por todas as etapas.
 */
export function buildLearningSubmission(
  input: SubmissionInput,
): SubmissionOutcome {
  const eligibility = evaluateLearningEligibility({
    trainingConsentActive: input.trainingConsentActive,
    report: input.report,
  });
  if (!eligibility.eligible) {
    return {
      ok: false,
      rejectionCode: eligibility.rejectionCode ?? "insufficient_data",
      failedChecks: [],
    };
  }

  let payload: SanitizedLearningPayload;
  try {
    payload = minimizeReport(input.report);
  } catch {
    return { ok: false, rejectionCode: "sanitization_failed", failedChecks: [] };
  }

  const issues = findSanitizationIssues(payload);
  if (issues.length > 0) {
    return { ok: false, rejectionCode: "sanitization_failed", failedChecks: [] };
  }

  const quality = runLearningQualityGate(payload);
  if (!quality.passed) {
    return {
      ok: false,
      rejectionCode: "quality_gate_failed",
      failedChecks: quality.failed,
    };
  }

  // O consentimento precisa existir antes de o dado ser exportado.
  if (Date.parse(input.trainingConsentGrantedAt) > Date.parse(input.producedAt)) {
    return { ok: false, rejectionCode: "provenance_invalid", failedChecks: [] };
  }

  const fingerprint = learningFingerprint(payload);
  const submission = elyraLearningSubmissionSchema.parse({
    contractVersion: ELYRA_LEARNING_CONTRACT_VERSION,
    inputSchemaVersion: ELYRA_LEARNING_INPUT_VERSION,
    operation: SUBMIT_OPERATION,
    eligibility: {
      eligible: true,
      policyVersion: ELYRA_LEARNING_POLICY_VERSION,
      evaluatedAt: input.evaluatedAt,
    },
    consent: {
      trainingConsentGranted: true,
      consentVersion: TRAINING_CONSENT_VERSION,
      grantedAt: input.trainingConsentGrantedAt,
    },
    provenance: {
      sourceKind: "report_snapshot",
      sourceSchemaVersion: "report_snapshot/v1",
      analyticsVersion: "elyra-analytics/v1",
      exportSchemaVersion: ELYRA_LEARNING_EXPORT_VERSION,
      producedAt: input.producedAt,
    },
    quality: {
      passed: true,
      checks: quality.checks.map((check) => ({
        name: check.name,
        passed: true as const,
      })),
    },
    fingerprint,
    payload,
  });

  return { ok: true, submission, fingerprint };
}
