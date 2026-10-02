import "server-only";

import type { PaidProviderConfig } from "../../config";
import type { Availability, ProfessionalRegistryProvider, RegistryLookupResult } from "../types";


export function createInfosimplesProvider(config: PaidProviderConfig): ProfessionalRegistryProvider {
  return {
    id: "infosimples_cfp",
    kind: "registry",
    billing: "paid",
    sourceType: "optional_provider",
    productionAccepted: true,
    availability(): Availability {
      if (!config.enabled) return { available: false, reason: "NOT_CONFIGURED" };
      return { available: false, reason: "UNVERIFIED_CONTRACT" };
    },
    async lookup(): Promise<RegistryLookupResult> {
      throw new Error("infosimples_contract_unverified");
    },
  };
}
