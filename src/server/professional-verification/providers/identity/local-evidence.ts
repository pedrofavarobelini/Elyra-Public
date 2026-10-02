import "server-only";

import type { Availability, IdentityInput, IdentityResult, IdentityVerificationProvider } from "../types";

/**
 * Baseline gratuita de identidade: o que a Elyra sabe sem terceiro.
 *
 * - `authenticated`: a conta Elyra passou por login (senha, Google, passkey).
 *   Prova QUEM controla a conta, nao quem e o titular do CRP.
 * - `identity_declared`: a pessoa declarou ser a titular do registro.
 *
 * Nenhum dos dois prova titularidade. Por isso o gate `identity_match` fica
 * `UNVERIFIED` → fila humana, nunca PASS por esta via.
 */
export function createLocalIdentityProvider(): IdentityVerificationProvider {
  return {
    id: "elyra_local_identity",
    kind: "identity",
    billing: "free",
    sourceType: "local_evidence",
    productionAccepted: true,
    availability(): Availability {
      return { available: true };
    },
    async verify(input: IdentityInput): Promise<IdentityResult> {
      return input.declaredTitularity
        ? { status: "UNVERIFIED", assurance: "identity_declared", detail: "assurance_identity_declared" }
        : { status: "UNVERIFIED", assurance: "authenticated", detail: "assurance_authenticated_only" };
    },
  };
}
