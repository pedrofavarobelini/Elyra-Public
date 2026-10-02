import "server-only";

import type { PaidProviderConfig } from "../../config";
import type { Availability, IdentityResult, IdentityVerificationProvider } from "../types";

/**
 * Datavalid (Serpro) — provider OPCIONAL e PAGO de identidade. Desligado.
 *
 * Fronteira apenas: liga so com `ELYRA_DATAVALID_ENABLED=true` + credenciais +
 * orcamento > 0, e mesmo assim devolve `UNVERIFIED_CONTRACT` (contrato,
 * biometria e base legal nao avaliados). Nunca e requisito: a ausencia dele
 * deixa a identidade na baseline gratuita, sem aprovar e sem recusar.
 */
export function createDatavalidProvider(config: PaidProviderConfig): IdentityVerificationProvider {
  return {
    id: "datavalid_identity",
    kind: "identity",
    billing: "paid",
    sourceType: "optional_provider",
    productionAccepted: true,
    availability(): Availability {
      if (!config.enabled) return { available: false, reason: "NOT_CONFIGURED" };
      return { available: false, reason: "UNVERIFIED_CONTRACT" };
    },
    async verify(): Promise<IdentityResult> {
      throw new Error("datavalid_contract_unverified");
    },
  };
}
