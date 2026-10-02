import type { Metadata } from "next";

import { SupportNetworkView } from "@/components/support-network/support-network-view";
import { requireConsentedUser } from "@/server/auth";
import { getSupportMunicipalities, getSupportProvenance } from "@/server/services/support-network-service";

export const metadata: Metadata = { title: "Rede de Apoio" };
// Dado institucional por snapshot; a pagina nunca e pre-renderizada com lista.
export const dynamic = "force-dynamic";

/**
 * Rede de Apoio (SUP-2, ADR-0032). O servidor entrega so a procedencia e o
 * catalogo de municipios (com centro aproximado); a busca por municipio vai
 * pela rota POST. Localizacao da pessoa nunca chega aqui.
 */
export default async function SupportNetworkPage() {
  const { supabase } = await requireConsentedUser();
  const [provenance, municipalities] = await Promise.allSettled([
    getSupportProvenance(supabase),
    getSupportMunicipalities(supabase),
  ]);
  return (
    <SupportNetworkView
      initialProvenance={provenance.status === "fulfilled" ? provenance.value : null}
      municipalities={municipalities.status === "fulfilled" ? municipalities.value : null}
    />
  );
}
