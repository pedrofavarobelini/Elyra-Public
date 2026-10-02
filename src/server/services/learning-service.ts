import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";

import {
  ELYRA_LEARNING_CONTRACT_VERSION,
  ELYRA_LEARNING_EXPORT_VERSION,
  ELYRA_LEARNING_INPUT_VERSION,
  ELYRA_LEARNING_POLICY_VERSION,
  REVOKE_OPERATION,
  elyraLearningRevocationSchema,
  type CandidateLifecycle,
  type RejectionCode,
  type RevocationReason,
} from "@/lib/contracts/learning";
import { analyticsReportSchema } from "@/lib/contracts/pedrocore";
import { buildLearningSubmission } from "@/lib/learning-pipeline";
import type { Database } from "@/lib/supabase/database.types";
import {
  ElyraPedroCoreClient,
  PedroCoreBlockedError,
  pedroCoreConfigFromEnvironment,
} from "@/server/pedrocore/client";
import {
  findExportByFingerprint,
  findOwnedSnapshot,
  insertExport,
  isTrainingConsentActive,
  listExports,
  setTrainingConsent,
  updateExport,
  type LearningExportRow,
} from "@/server/repositories/learning-repository";

type Client = SupabaseClient<Database>;

/**
 * Servico de learning governado.
 *
 * Ordem deliberada: a Elyra decide **antes** de falar com o PedroCore. Um
 * candidato inelegivel, sem consentimento ou reprovado no quality gate nunca
 * chega a atravessar a fronteira — ele e registrado como recusa local.
 */

export class LearningServiceError extends Error {
  constructor(
    public readonly reason: string,
    public readonly rejectionCode?: RejectionCode,
  ) {
    super(`Falha no learning governado: ${reason}.`);
    this.name = "LearningServiceError";
  }
}

export interface LearningExportResult {
  status: LearningExportRow["status"];
  fingerprint: string;
  candidateId: string | null;
  candidateLifecycle: CandidateLifecycle | null;
  rejectionCode: RejectionCode | null;
  replayed: boolean;
}

function toResult(
  row: LearningExportRow,
  replayed: boolean,
): LearningExportResult {
  return {
    status: row.status as LearningExportRow["status"],
    fingerprint: row.fingerprint,
    candidateId: row.candidate_id,
    candidateLifecycle: row.candidate_lifecycle as CandidateLifecycle | null,
    rejectionCode: row.rejection_code as RejectionCode | null,
    replayed,
  };
}

export async function getTrainingConsent(client: Client, user: User) {
  return isTrainingConsentActive(client, user.id);
}

export async function updateTrainingConsent(client: Client, enabled: boolean) {
  return setTrainingConsent(client, enabled);
}

export async function listLearningExports(client: Client, user: User) {
  return listExports(client, user.id);
}

/**
 * Exporta um `report_snapshot` como candidato governado.
 *
 * Fluxo: consentimento -> snapshot do proprio dono -> pipeline (elegibilidade,
 * minimizacao, sanitizacao, proveniencia, fingerprint, quality gate) ->
 * `learning_export` -> PedroCore -> referencia do Candidate.
 */
export async function exportSnapshotForLearning(
  client: Client,
  user: User,
  snapshotId: string,
  factory: (config: ReturnType<typeof pedroCoreConfigFromEnvironment>) =>
    ElyraPedroCoreClient = (config) => new ElyraPedroCoreClient(config),
): Promise<LearningExportResult> {
  const consentActive = await isTrainingConsentActive(client, user.id);

  const snapshot = await findOwnedSnapshot(client, user.id, snapshotId);
  if (!snapshot) throw new LearningServiceError("snapshot_not_found");

  const report = analyticsReportSchema.safeParse(snapshot.payload);
  if (!report.success) {
    throw new LearningServiceError("snapshot_invalid", "provenance_invalid");
  }

  const producedAt = snapshot.created_at;
  const outcome = buildLearningSubmission({
    report: report.data,
    trainingConsentActive: consentActive,
    // Sem consentimento vigente nao ha instante de concessao; o pipeline ja
    // recusa antes de olhar para esta data.
    trainingConsentGrantedAt: producedAt,
    producedAt,
    evaluatedAt: new Date().toISOString(),
  });

  const correlationId = `elyra-learning-${randomUUID()}`;

  // Recusa e resultado normal: vira registro de governanca, nao excecao.
  if (!outcome.ok) {
    if (!consentActive) {
      throw new LearningServiceError(
        "training_consent_missing",
        outcome.rejectionCode,
      );
    }
    const rejected = await insertExport(client, {
      user_id: user.id,
      report_snapshot_id: snapshotId,
      fingerprint: rejectionFingerprint(snapshotId),
      status: "rejected",
      rejection_code: outcome.rejectionCode,
      quality_passed: false,
      correlation_id: correlationId,
      produced_at: producedAt,
    });
    if (!rejected) {
      const existing = await findExportByFingerprint(
        client,
        user.id,
        rejectionFingerprint(snapshotId),
      );
      if (!existing) throw new LearningServiceError("rejection_conflict");
      return toResult(existing, true);
    }
    return toResult(rejected, false);
  }

  const { submission, fingerprint } = outcome;

  // Idempotencia duravel: o mesmo conteudo governado nao exporta duas vezes.
  const existing = await findExportByFingerprint(client, user.id, fingerprint);
  if (existing) return toResult(existing, true);

  const created = await insertExport(client, {
    user_id: user.id,
    report_snapshot_id: snapshotId,
    contract_version: ELYRA_LEARNING_CONTRACT_VERSION,
    export_schema_version: ELYRA_LEARNING_EXPORT_VERSION,
    policy_version: ELYRA_LEARNING_POLICY_VERSION,
    fingerprint,
    status: "eligible",
    quality_passed: true,
    correlation_id: correlationId,
    produced_at: producedAt,
  });
  if (!created) {
    const concurrent = await findExportByFingerprint(client, user.id, fingerprint);
    if (!concurrent) throw new LearningServiceError("export_conflict");
    return toResult(concurrent, true);
  }

  const pedroCore = factory(pedroCoreConfigFromEnvironment());
  let receipt;
  try {
    receipt = await pedroCore.submitLearningCandidate(
      submission,
      correlationId,
      `elyra-learning-key-${fingerprint.slice(0, 32)}`,
    );
  } catch (error) {
    // A fronteira recusou: o export fica registrado como recusa, e nao some.
    const denied = await updateExport(client, created.id, user.id, {
      status: "rejected",
      rejection_code: "pedrocore_denied",
      quality_passed: false,
    });
    if (error instanceof PedroCoreBlockedError) return toResult(denied, false);
    throw error;
  }

  const exported = await updateExport(client, created.id, user.id, {
    status: "exported",
    candidate_id: receipt.candidateId,
    candidate_lifecycle: receipt.lifecycle,
    exported_at: new Date().toISOString(),
  });
  return toResult(exported, receipt.duplicate);
}

/**
 * Fingerprint estavel para uma recusa.
 *
 * Uma recusa nao tem payload sanitizado — ela existe porque o payload nao pode
 * ser produzido. Mas a coluna e obrigatoria e unica, entao a recusa recebe um
 * digest derivado do snapshot: reavaliar o mesmo snapshot inelegivel nao cria
 * um segundo registro de recusa.
 */
function rejectionFingerprint(snapshotId: string): string {
  return createHash("sha256")
    .update(`rejected:${ELYRA_LEARNING_POLICY_VERSION}:${snapshotId}`, "utf8")
    .digest("hex");
}

/**
 * Revoga um export ja realizado, propagando ao PedroCore.
 *
 * Dois casos, e a diferenca importa:
 *   - export que nunca virou Candidate: basta marcar revogado localmente;
 *   - export com Candidate: o PedroCore precisa saber, senao o candidato
 *     continuaria elegivel do outro lado da fronteira.
 */
export async function revokeLearningExport(
  client: Client,
  user: User,
  fingerprint: string,
  reason: RevocationReason,
  factory: (config: ReturnType<typeof pedroCoreConfigFromEnvironment>) =>
    ElyraPedroCoreClient = (config) => new ElyraPedroCoreClient(config),
): Promise<LearningExportResult> {
  const existing = await findExportByFingerprint(client, user.id, fingerprint);
  if (!existing) throw new LearningServiceError("export_not_found");

  // Revogar de novo nao e erro: e replay de uma decisao ja tomada.
  if (existing.status === "revoked") return toResult(existing, true);

  let lifecycle: CandidateLifecycle | null = existing.candidate_lifecycle as
    | CandidateLifecycle
    | null;

  if (existing.candidate_id) {
    const correlationId = `elyra-learning-revoke-${randomUUID()}`;
    const revocation = elyraLearningRevocationSchema.parse({
      contractVersion: ELYRA_LEARNING_CONTRACT_VERSION,
      inputSchemaVersion: ELYRA_LEARNING_INPUT_VERSION,
      operation: REVOKE_OPERATION,
      fingerprint,
      reasonCode: reason,
      revokedAt: new Date().toISOString(),
    });
    const pedroCore = factory(pedroCoreConfigFromEnvironment());
    const receipt = await pedroCore.revokeLearningCandidate(
      revocation,
      correlationId,
      `elyra-learning-revoke-key-${fingerprint.slice(0, 24)}`,
    );
    lifecycle = receipt.lifecycle;
  }

  const revoked = await updateExport(client, existing.id, user.id, {
    status: "revoked",
    revoked_at: new Date().toISOString(),
    revocation_reason: reason,
    candidate_lifecycle: lifecycle,
  });
  return toResult(revoked, false);
}
