import type { Metadata } from "next";

import { requireVerifiedProfessional } from "@/server/professional-gate";
import { getProfessionalPortal } from "@/server/services/professional-service";
import { AcompanhamentosView } from "./view";

export const metadata: Metadata = { title: "Acompanhamentos" };

export default async function ProAcompanhamentosPage() {
  const { supabase, user } = await requireVerifiedProfessional();
  const portal = await getProfessionalPortal(supabase, user);
  return (
    <AcompanhamentosView
      hasProfile={Boolean(portal.profile) || !portal.profileAvailable}
      verified={portal.profile?.effective_verification_status === "verified"}
      relationships={portal.relationships}
      available={portal.relationshipsAvailable}
      now={portal.now}
    />
  );
}
