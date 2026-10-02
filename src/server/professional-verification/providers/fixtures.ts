import "server-only";

import type {
  Availability,
  IdentityVerificationProvider,
  ProfessionalRegistryProvider,
  RegistryLookupInput,
  RegistryLookupResult,
} from "./types";

/**
 * Providers DETERMINISTICOS de QA local. Nunca verificacao real:
 * - so existem com `ELYRA_VERIFICATION_FIXTURES=local`, fora de producao e
 *   com Supabase em 127.0.0.1/localhost (config.ts);
 * - gravam evidencia `qa_fixture`, que o banco so aceita com o interruptor
 *   local `accept_fixture_evidence` ligado (default: desligado).
 *
 * O cenario sai dos 4 ultimos digitos do registro:
 *   0001 ativo, mesmo titular      0002 inativo, mesmo titular
 *   0003 nao encontrado            0004 timeout da fonte
 *   0005 ativo, outro titular      0006 erro 5xx da fonte
 *   0007 sem saldo (quota)         demais: nao encontrado
 */
export class FixtureSourceError extends Error {
  constructor(public readonly category: "http_5xx" | "quota_exhausted") {
    super(category);
    this.name = "FixtureSourceError";
  }
}

const suffix = (input: RegistryLookupInput) => input.number.replace(/\D/g, "").slice(-4);

function result(input: RegistryLookupInput, provider: string, status: RegistryLookupResult["status"], name: string | null): RegistryLookupResult {
  return {
    source: "qa_fixture",
    provider,
    registryNumber: input.number,
    region: input.region,
    professionalName: name,
    status,
    specialty: status === "NOT_FOUND" ? null : "Psicologia",
    checkedAt: new Date().toISOString(),
    confidence: 1,
    evidenceLevel: "fixture",
  };
}

export function createFixtureRegistryProvider(
  enabled: boolean,
  holderNameFor: (input: RegistryLookupInput) => string,
  options: { id?: string; billing?: "free" | "paid" } = {},
): ProfessionalRegistryProvider {
  const id = options.id ?? "qa_fixture_registry";
  return {
    id,
    kind: "registry",
    billing: options.billing ?? "free",
    sourceType: "qa_fixture",
    productionAccepted: false,
    availability(): Availability {
      return enabled ? { available: true } : { available: false, reason: "LOCAL_ONLY" };
    },
    async lookup(input, signal) {
      switch (suffix(input)) {
        case "0001":
          return result(input, id, "ACTIVE", holderNameFor(input));
        case "0002":
          return result(input, id, "INACTIVE", holderNameFor(input));
        case "0004":
          // Nunca responde: o runtime corta pelo timeout.
          return new Promise<RegistryLookupResult>((_, reject) =>
            signal.addEventListener("abort", () => reject(new Error("aborted"))),
          );
        case "0005":
          return result(input, id, "ACTIVE", "Outra Pessoa Titular");
        case "0006":
          throw new FixtureSourceError("http_5xx");
        case "0007":
          throw new FixtureSourceError("quota_exhausted");
        default:
          return result(input, id, "NOT_FOUND", null);
      }
    },
  };
}

/** Identidade de QA: "documento conferido" so no cenario 0001/0002/0005. */
export function createFixtureIdentityProvider(enabled: boolean): IdentityVerificationProvider {
  return {
    id: "qa_fixture_identity",
    kind: "identity",
    billing: "free",
    sourceType: "qa_fixture",
    productionAccepted: false,
    availability(): Availability {
      return enabled ? { available: true } : { available: false, reason: "LOCAL_ONLY" };
    },
    async verify(input) {
      const tail = input.registration.number.replace(/\D/g, "").slice(-4);
      return ["0001", "0002", "0005"].includes(tail) && input.declaredTitularity
        ? { status: "PASS", assurance: "identity_document_crosschecked", detail: "qa_fixture_document" }
        : { status: "UNVERIFIED", assurance: "identity_declared", detail: "assurance_identity_declared" };
    },
  };
}
