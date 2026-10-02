import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { canonicalJson } from "@/lib/canonical-json";
import {
  ELYRA_TEXTUAL_CONTRACT_VERSION,
  ELYRA_TEXTUAL_OPERATION,
  ELYRA_TEXTUAL_OUTPUT_VERSION,
  analyticsReportSchema,
  elyraTextualOutputSchema,
  insightRequestSchema,
  veltrixProviderIdSchema,
  type ElyraTextualOutput,
  type VeltrixProviderId,
} from "@/lib/contracts/pedrocore";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  AiInsightsRepositoryError,
  findInsightByIdempotency,
  findOwnedReportSnapshot,
  insertAiInsight,
  setAiInferenceConsent,
} from "@/server/repositories/ai-insights-repository";
import { appendAudit } from "@/server/repositories/identity-repository";
import {
  ElyraPedroCoreClient,
  PedroCoreBlockedError,
  PedroCoreConfigurationError,
  PedroCoreContractError,
  PedroCoreTimeoutError,
  PedroCoreUnavailableError,
  createElyraTextualInput,
  pedroCoreConfigFromEnvironment,
} from "@/server/pedrocore/client";

type Client = SupabaseClient<Database>;

export type AiInsightErrorCode =
  | "AI_INFERENCE_CONSENT_REQUIRED"
  | "REPORT_SNAPSHOT_NOT_FOUND"
  | "ELYRA_IDEMPOTENCY_CONFLICT"
  | "PEDROCORE_UNAVAILABLE"
  | "PEDROCORE_TIMEOUT"
  | "PEDROCORE_INVALID_OUTPUT"
  | "PEDROCORE_BLOCKED"
  | "AI_INSIGHT_PERSISTENCE_FAILURE";

export class AiInsightServiceError extends Error {
  constructor(
    public readonly code: AiInsightErrorCode,
    public readonly status: number,
  ) {
    super(code);
    this.name = "AiInsightServiceError";
  }
}

export interface AiInsightResult {
  id: string;
  reportSnapshotId: string;
  correlationId: string;
  providerUsed: VeltrixProviderId;
  model: string;
  fallbackUsed: false;
  output: ElyraTextualOutput;
  createdAt: string;
  idempotencyReplayed: boolean;
}

interface Dependencies {
  createPedroCoreClient: () => ElyraPedroCoreClient;
}

const defaultDependencies: Dependencies = {
  createPedroCoreClient: () =>
    new ElyraPedroCoreClient(pedroCoreConfigFromEnvironment()),
};

function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function mapInsightRow(row: {
  id: string;
  report_snapshot_id: string;
  correlation_id: string;
  provider_used: string;
  model: string;
  fallback_used: boolean;
  output: Json;
  created_at: string;
}, replayed: boolean): AiInsightResult {
  const output = elyraTextualOutputSchema.parse(row.output);
  const providerUsed = veltrixProviderIdSchema.safeParse(row.provider_used);
  if (
    row.fallback_used ||
    output.correlationId !== row.correlation_id ||
    !providerUsed.success
  ) {
    throw new AiInsightServiceError("PEDROCORE_INVALID_OUTPUT", 502);
  }
  return {
    id: row.id,
    reportSnapshotId: row.report_snapshot_id,
    correlationId: row.correlation_id,
    providerUsed: providerUsed.data,
    model: row.model,
    fallbackUsed: false,
    output,
    createdAt: row.created_at,
    idempotencyReplayed: replayed,
  };
}

async function auditFailure(
  client: Client,
  userId: string,
  snapshotId: string,
  correlationId: string,
  outcome: "denied" | "failure",
) {
  try {
    await appendAudit(client, {
      actorUserId: userId,
      action: outcome === "denied" ? "ai_insight.denied" : "ai_insight.failed",
      entityType: "report_snapshot",
      entityId: snapshotId,
      correlationId,
      outcome,
    });
  } catch {
    // A falha de audit nao pode expor payload nem transformar uma falha em sucesso.
  }
}

export async function createAiInsight(
  client: Client,
  user: User,
  rawInput: unknown,
  dependencies: Dependencies = defaultDependencies,
): Promise<AiInsightResult> {
  const input = insightRequestSchema.parse(rawInput);
  const correlationId = crypto.randomUUID();

  if (!input.aiInferenceConsent) {
    await auditFailure(
      client,
      user.id,
      input.reportSnapshotId,
      correlationId,
      "denied",
    );
    throw new AiInsightServiceError("AI_INFERENCE_CONSENT_REQUIRED", 403);
  }

  const snapshot = await findOwnedReportSnapshot(
    client,
    user.id,
    input.reportSnapshotId,
  );
  if (!snapshot) {
    throw new AiInsightServiceError("REPORT_SNAPSHOT_NOT_FOUND", 404);
  }

  const report = analyticsReportSchema.parse(snapshot.payload);
  const idempotencyFingerprint = fingerprint(input.idempotencyKey);
  const requestFingerprint = fingerprint(
    canonicalJson({
      contractVersion: ELYRA_TEXTUAL_CONTRACT_VERSION,
      operation: ELYRA_TEXTUAL_OPERATION,
      reportSnapshotId: snapshot.id,
      report,
    }),
  );
  const existing = await findInsightByIdempotency(
    client,
    user.id,
    idempotencyFingerprint,
  );
  if (existing) {
    if (existing.request_fingerprint !== requestFingerprint) {
      throw new AiInsightServiceError("ELYRA_IDEMPOTENCY_CONFLICT", 409);
    }
    return mapInsightRow(existing, true);
  }

  await setAiInferenceConsent(client, true);
  const textualInput = createElyraTextualInput(report);

  let outcome;
  try {
    const pedroCore = dependencies.createPedroCoreClient();
    outcome = await pedroCore.interpretDeterministicReport(
      textualInput,
      correlationId,
      input.idempotencyKey,
    );
  } catch (error) {
    await auditFailure(
      client,
      user.id,
      snapshot.id,
      correlationId,
      "failure",
    );
    if (
      error instanceof PedroCoreConfigurationError ||
      error instanceof PedroCoreUnavailableError
    ) {
      throw new AiInsightServiceError("PEDROCORE_UNAVAILABLE", 503);
    }
    if (error instanceof PedroCoreTimeoutError) {
      throw new AiInsightServiceError("PEDROCORE_TIMEOUT", 504);
    }
    if (error instanceof PedroCoreContractError) {
      throw new AiInsightServiceError("PEDROCORE_INVALID_OUTPUT", 502);
    }
    if (error instanceof PedroCoreBlockedError) {
      throw new AiInsightServiceError("PEDROCORE_BLOCKED", 502);
    }
    throw error;
  }

  try {
    const row = await insertAiInsight(client, {
      user_id: user.id,
      report_snapshot_id: snapshot.id,
      contract_version: ELYRA_TEXTUAL_CONTRACT_VERSION,
      output_schema_version: ELYRA_TEXTUAL_OUTPUT_VERSION,
      operation: ELYRA_TEXTUAL_OPERATION,
      correlation_id: correlationId,
      idempotency_key_fingerprint: idempotencyFingerprint,
      request_fingerprint: requestFingerprint,
      provider_used: outcome.provider_used,
      model: outcome.model,
      fallback_used: false,
      output: outcome.elyra as unknown as Json,
    });
    return mapInsightRow(row, false);
  } catch (error) {
    if (
      error instanceof AiInsightsRepositoryError &&
      error.code === "23505"
    ) {
      const raced = await findInsightByIdempotency(
        client,
        user.id,
        idempotencyFingerprint,
      );
      if (raced?.request_fingerprint === requestFingerprint) {
        return mapInsightRow(raced, true);
      }
      throw new AiInsightServiceError("ELYRA_IDEMPOTENCY_CONFLICT", 409);
    }
    await auditFailure(
      client,
      user.id,
      snapshot.id,
      correlationId,
      "failure",
    );
    throw new AiInsightServiceError("AI_INSIGHT_PERSISTENCE_FAILURE", 500);
  }
}
