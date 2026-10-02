import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { VERIFICATION_POLICY_VERSION_V2, type DecisionV2, type Evidence } from "@/lib/professional/verification-decision";
import type { Database } from "@/lib/supabase/database.types";
import { recordPrecheck } from "@/server/repositories/professional-onboarding-repository";

import { readVerificationConfig, type VerificationConfig } from "./config";
import { runProfessionalVerification, type OrchestratorDeps, type VerificationSubject } from "./orchestrator";
import { createEmecSnapshotProvider } from "./providers/education/emec-snapshot";
import { createDiplomaDigitalProvider } from "./providers/education/diploma-digital";
import { createFixtureIdentityProvider, createFixtureRegistryProvider } from "./providers/fixtures";
import { createDatavalidProvider } from "./providers/identity/datavalid";
import { createLocalIdentityProvider } from "./providers/identity/local-evidence";
import { createCfpOfficialProvider } from "./providers/registry/cfp-official";
import { createInfosimplesProvider } from "./providers/registry/infosimples";
import { CircuitBreaker, CostGuard, observe, TtlCache } from "./runtime";
import { createTrustedVerificationStore, type TrustedVerificationStore } from "./trusted-store";

type Client = SupabaseClient<Database>;

// Estado de processo: disjuntor, cache e orcamento pago sao por instancia.
const breaker = new CircuitBreaker();
const registryCache = new TtlCache<Awaited<ReturnType<OrchestratorDeps["registryProviders"][number]["lookup"]>>>(10 * 60_000);
let costGuard: CostGuard | null = null;

/** Providers na ordem de prioridade do contrato (oficial → local → opcional). */
export async function buildDeps(
  config: VerificationConfig,
  store: TrustedVerificationStore | null,
  accountName: string,
): Promise<OrchestratorDeps> {
  if (!costGuard) costGuard = new CostGuard(config.paidDailyLimit);
  const emec = store?.emecReader() ?? null;
  const rawSource = emec ? await emec.activeSource().catch(() => null) : null;
  // Snapshot de QA so conta com fixtures ligadas (ambiente local de QA).
  const emecSource = rawSource === "qa_fixture" && !config.fixturesEnabled ? null : rawSource;
  const fixtureRegistry = createFixtureRegistryProvider(config.fixturesEnabled, () => accountName);
  return {
    config,
    registryProviders: [
      createCfpOfficialProvider({ enabled: config.cfpOfficialEnabled }),
      createInfosimplesProvider(config.infosimples),
      fixtureRegistry,
    ],
    identityProviders: [
      createLocalIdentityProvider(),
      createFixtureIdentityProvider(config.fixturesEnabled),
      createDatavalidProvider(config.datavalid),
    ],
    educationProviders: [createEmecSnapshotProvider(emec, emecSource), createDiplomaDigitalProvider()],
    costGuard,
    breaker,
    registryCache,
  };
}

export interface ExecutedVerification {
  /** Status do perfil depois da execucao. */
  verificationStatus: "verified" | "rejected" | "needs_correction" | "pending";
  decision: DecisionV2;
  automated: boolean;
}

/**
 * Coleta, decide e executa. Nunca lanca: qualquer falha termina em `pending`
 * (fila humana). VERIFIED/REJECTED so via executor confiavel, e o banco
 * confere a prova de novo; sem executor, viram fila humana.
 */
export async function verifySubmission(
  client: Client,
  subject: VerificationSubject,
  options: { config?: VerificationConfig; store?: TrustedVerificationStore | null } = {},
): Promise<ExecutedVerification> {
  const config = options.config ?? readVerificationConfig();
  const store = options.store === undefined ? createTrustedVerificationStore() : options.store;

  let decision: DecisionV2;
  let evidence: Evidence[];
  try {
    const run = await runProfessionalVerification(subject, await buildDeps(config, store, subject.accountName));
    decision = run.decision;
    evidence = run.evidence;
  } catch {
    observe({ provider: "veltrix", operation: "orchestrate", result: "failed", latencyMs: 0, errorCategory: "unexpected" });
    decision = { outcome: "UNDER_REVIEW", reasons: ["orchestrator_error"], gates: [], policyVersion: VERIFICATION_POLICY_VERSION_V2 };
    evidence = [];
  }

  let recorded = false;
  if (store && evidence.length) {
    try {
      await store.recordEvidence(subject.userId, subject.submission, evidence, VERIFICATION_POLICY_VERSION_V2);
      recorded = true;
    } catch {
      observe({ provider: "veltrix", operation: "record_evidence", result: "failed", latencyMs: 0, errorCategory: "store" });
    }
  }

  if ((decision.outcome === "VERIFIED" || decision.outcome === "REJECTED") && store && recorded) {
    try {
      const status = await store.applyAutomated(subject.userId, subject.submission, decision.outcome, VERIFICATION_POLICY_VERSION_V2);
      observe({ provider: "veltrix", operation: "automated_decision", result: status, latencyMs: 0 });
      return { verificationStatus: status === "verified" ? "verified" : "rejected", decision, automated: true };
    } catch {
      // O banco nao viu prova suficiente (ou replay): fila humana, sem erro.
      observe({ provider: "veltrix", operation: "automated_decision", result: "refused", latencyMs: 0, errorCategory: "db_refused" });
    }
  }

  const correction = decision.outcome === "PENDING_CORRECTION";
  try {
    await recordPrecheck(client, {
      submission: subject.submission,
      outcome: correction ? "needs_correction" : "manual_hold",
      reasonCode: correction ? (decision.reasons[0] ?? "information_insufficient") : "automated_precheck_manual_hold",
    });
    return { verificationStatus: correction ? "needs_correction" : "pending", decision, automated: false };
  } catch {
    // Replay/estado ja mudou: o perfil continua na fila.
    return { verificationStatus: "pending", decision, automated: false };
  }
}
