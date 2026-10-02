import "server-only";

import { createHash } from "node:crypto";

import {
  decideFromEvidence,
  normalizePersonName,
  type DecisionV2,
  type Evidence,
} from "@/lib/professional/verification-decision";
import { registryFormatFact } from "@/lib/professional/verification-orchestrator";

import type { VerificationConfig } from "./config";
import type {
  EducationInput,
  EducationVerificationProvider,
  IdentityVerificationProvider,
  ProfessionalRegistryProvider,
  RegistryLookupInput,
  RegistryLookupResult,
} from "./providers/types";
import { CircuitBreaker, CostGuard, observe, ProviderTimeoutError, TtlCache, withTimeout } from "./runtime";

/**
 * VeltrixProfessionalVerificationService (ADR-0028).
 *
 *   collect evidence → normalize → cross-check → required gates → decision
 *
 * Prioridade de fonte: oficial gratuita → evidencia local → provider opcional
 * configurado → (nada conclusivo) fila humana. Provider pago so e chamado se
 * as fontes gratuitas nao foram conclusivas E a guarda de custo permitir.
 *
 * Este modulo NUNCA lanca para quem chama: fonte fora do ar, timeout, 5xx,
 * falta de saldo ou bug vira evidencia `SOURCE_UNAVAILABLE`/`NETWORK_ERROR` e,
 * no fim, UNDER_REVIEW. O nome devolvido por uma fonte e usado so em memoria
 * para comparar; o que fica e o resultado e um digest.
 */

export interface VerificationSubject {
  userId: string;
  submission: number;
  accountName: string;
  declaredTitularity: boolean;
  region: string;
  registrationNumber: string;
  education: EducationInput[];
}

export interface OrchestratorDeps {
  config: VerificationConfig;
  registryProviders: ProfessionalRegistryProvider[];
  identityProviders: IdentityVerificationProvider[];
  educationProviders: EducationVerificationProvider[];
  costGuard: CostGuard;
  breaker: CircuitBreaker;
  registryCache: TtlCache<RegistryLookupResult>;
  now?: () => number;
}

export interface VerificationRun {
  decision: DecisionV2;
  evidence: Evidence[];
  /** Quantas chamadas pagas foram de fato feitas nesta execucao. */
  paidCalls: number;
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

type Attempt<T> = { ok: true; value: T } | { ok: false; reason: string };

async function attempt<T>(
  provider: { id: string; billing: "free" | "paid"; availability(): { available: boolean; reason?: string } },
  operation: string,
  deps: OrchestratorDeps,
  work: (signal: AbortSignal) => Promise<T>,
  counters: { paid: number },
): Promise<Attempt<T>> {
  const availability = provider.availability();
  if (!availability.available) {
    return { ok: false, reason: `${provider.id}:${(availability.reason ?? "unavailable").toLowerCase()}` };
  }
  if (deps.breaker.isOpen(provider.id)) return { ok: false, reason: `${provider.id}:circuit_open` };
  if (provider.billing === "paid") {
    if (!deps.costGuard.tryConsume(provider.id)) return { ok: false, reason: `${provider.id}:budget_exhausted` };
    counters.paid += 1;
  }
  const started = Date.now();
  try {
    const value = await withTimeout(work, deps.config.timeoutMs);
    deps.breaker.success(provider.id);
    observe({ provider: provider.id, operation, result: "ok", latencyMs: Date.now() - started });
    return { ok: true, value };
  } catch (error) {
    deps.breaker.failure(provider.id);
    const category =
      error instanceof ProviderTimeoutError
        ? "timeout"
        : error && typeof error === "object" && "category" in error && typeof error.category === "string"
          ? error.category
          : "error";
    observe({ provider: provider.id, operation, result: "unavailable", latencyMs: Date.now() - started, errorCategory: category });
    return { ok: false, reason: `${provider.id}:${category}` };
  }
}

export async function runProfessionalVerification(
  subject: VerificationSubject,
  deps: OrchestratorDeps,
): Promise<VerificationRun> {
  const now = deps.now ?? Date.now;
  const checkedAt = new Date(now()).toISOString();
  const counters = { paid: 0 };
  const evidence: Evidence[] = [];
  const add = (item: Omit<Evidence, "checkedAt">) => evidence.push({ ...item, checkedAt });

  // 1. Evidencia local (sem terceiro).
  add({ fact: "auth_account", sourceType: "local_evidence", provider: "elyra_session", status: "PASS" });
  add({
    fact: "required_terms",
    sourceType: "local_evidence",
    provider: "elyra_onboarding",
    status: subject.declaredTitularity ? "PASS" : "FAIL",
  });
  const format = registryFormatFact(subject.registrationNumber);
  add({
    fact: "registry_format",
    sourceType: "local_evidence",
    provider: "elyra_onboarding",
    status: format.status === "PASS" ? "PASS" : format.status === "INSUFFICIENT" ? "INSUFFICIENT" : "FAIL",
    detail: format.detail,
  });

  const lookupInput: RegistryLookupInput = {
    council: "CRP",
    region: subject.region,
    number: subject.registrationNumber.toUpperCase().replace(/[^0-9A-Z]/g, ""),
  };

  // 2. Registro: primeira fonte conclusiva, na ordem de prioridade.
  let registry: RegistryLookupResult | null = null;
  const misses: string[] = [];
  if (format.status === "PASS") {
    const cacheKey = sha256(`${lookupInput.region}|${lookupInput.number}`);
    registry = deps.registryCache.get(cacheKey) ?? null;
    if (!registry) {
      for (const provider of deps.registryProviders) {
        const outcome = await attempt(provider, "registry_lookup", deps, (signal) => provider.lookup(lookupInput, signal), counters);
        if (outcome.ok) {
          registry = outcome.value;
          deps.registryCache.set(cacheKey, registry);
          break;
        }
        misses.push(outcome.reason);
      }
    }
  } else {
    misses.push("registry_format_not_valid");
  }

  const registrySource = registry?.source ?? "official_registry";
  const registryProvider = registry?.provider ?? "none";
  if (!registry) {
    // Uma linha por fonte tentada: o revisor ve o que aconteceu com cada uma
    // (contrato nao verificado, timeout, 5xx, sem saldo), nao so a primeira.
    const tried = misses.length ? misses : ["none:no_registry_source"];
    for (const miss of tried) {
      const [provider, ...rest] = miss.split(":");
      add({
        fact: "professional_registry",
        sourceType: "official_registry",
        provider: /^[a-z][a-z0-9_]{2,40}$/.test(provider ?? "") ? (provider as string) : "none",
        status: "SOURCE_UNAVAILABLE",
        detail: (rest.join(":") || provider || "unavailable").slice(0, 64),
      });
    }
    add({ fact: "registry_holder_match", sourceType: "official_registry", provider: "none", status: "UNKNOWN", detail: "depends_on_registry_source" });
    add({ fact: "registry_status", sourceType: "official_registry", provider: "none", status: "UNKNOWN", detail: "depends_on_registry_source" });
  } else if (registry.status === "NOT_FOUND" || registry.region !== lookupInput.region) {
    add({ fact: "professional_registry", sourceType: registrySource, provider: registryProvider, status: "FAIL", detail: "registry_not_found" });
    add({ fact: "registry_holder_match", sourceType: registrySource, provider: registryProvider, status: "UNKNOWN", detail: "registry_not_found" });
    add({ fact: "registry_status", sourceType: registrySource, provider: registryProvider, status: "UNKNOWN", detail: "registry_not_found" });
  } else {
    const holderMatches =
      registry.professionalName !== null &&
      normalizePersonName(registry.professionalName) === normalizePersonName(subject.accountName);
    add({
      fact: "professional_registry",
      sourceType: registrySource,
      provider: registryProvider,
      status: "PASS",
      confidence: registry.confidence,
      valueDigest: sha256(`${lookupInput.region}|${lookupInput.number}|${normalizePersonName(subject.accountName)}`),
    });
    add({
      fact: "registry_holder_match",
      sourceType: registrySource,
      provider: registryProvider,
      status: holderMatches ? "PASS" : "MISMATCH",
    });
    add({
      fact: "registry_status",
      sourceType: registrySource,
      provider: registryProvider,
      status: registry.status === "ACTIVE" ? "PASS" : "FAIL",
      detail: registry.status === "ACTIVE" ? undefined : "registry_inactive",
    });
  }

  // 3. Identidade: gratuitas primeiro; paga so se a gratuita nao bastou.
  let identity: Evidence | null = null;
  for (const provider of deps.identityProviders) {
    const outcome = await attempt(
      provider,
      "identity_verify",
      deps,
      (signal) =>
        provider.verify(
          {
            userId: subject.userId,
            accountName: subject.accountName,
            declaredTitularity: subject.declaredTitularity,
            registration: lookupInput,
          },
          signal,
        ),
      counters,
    );
    if (!outcome.ok) continue;
    const candidate: Evidence = {
      fact: "identity_match",
      sourceType: provider.sourceType,
      provider: provider.id,
      status: outcome.value.status,
      assurance: outcome.value.assurance,
      detail: outcome.value.detail,
      checkedAt,
    };
    if (!identity || candidate.status === "PASS") identity = candidate;
    if (candidate.status === "PASS") break;
  }
  evidence.push(
    identity ?? {
      fact: "identity_match",
      sourceType: "local_evidence",
      provider: "none",
      status: "UNVERIFIED",
      assurance: "authenticated",
      detail: "no_identity_source",
      checkedAt,
    },
  );

  // 4. Formacao (enriquece o perfil; nunca e gate).
  for (const course of subject.education.slice(0, 5)) {
    for (const provider of deps.educationProviders) {
      const outcome = await attempt(provider, "education_verify", deps, (signal) => provider.verify(course, signal), counters);
      if (!outcome.ok) continue;
      add({ fact: "education", sourceType: provider.sourceType, provider: provider.id, status: outcome.value.status, detail: outcome.value.detail });
      break;
    }
  }

  const decision = decideFromEvidence(evidence, { acceptFixtures: deps.config.fixturesEnabled, now: now() });
  return { decision, evidence, paidCalls: counters.paid };
}
