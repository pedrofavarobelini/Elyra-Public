import "server-only";

import type { Availability, ProfessionalRegistryProvider, RegistryLookupResult } from "../types";


export const CFP_OFFICIAL_INDIVIDUAL_LOOKUP = "UNVERIFIED" as const;

export function createCfpOfficialProvider(options: { enabled: boolean }): ProfessionalRegistryProvider {
  return {
    id: "cfp_official_open_data",
    kind: "registry",
    billing: "free",
    sourceType: "official_registry",
    productionAccepted: true,
    availability(): Availability {
      if (!options.enabled) return { available: false, reason: "DISABLED" };
      return { available: false, reason: "UNVERIFIED_CONTRACT" };
    },
    async lookup(): Promise<RegistryLookupResult> {
      throw new Error("cfp_official_contract_unverified");
    },
  };
}
