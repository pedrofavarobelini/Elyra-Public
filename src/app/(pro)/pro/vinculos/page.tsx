import type { Metadata } from "next";

import { requireVerifiedProfessional } from "@/server/professional-gate";
import { getProfessionalPortal } from "@/server/services/professional-service";
import { VinculosView } from "./view";

export const metadata: Metadata = { title: "Vínculos e acessos" };

export default async function ProVinculosPage() {
  const { supabase, user } = await requireVerifiedProfessional();
  const portal = await getProfessionalPortal(supabase, user);
  return (
    <VinculosView
      hasProfile={Boolean(portal.profile) || !portal.profileAvailable}
      relationships={portal.relationships.filter((relationship) => relationship.status !== "pending")}
      available={portal.relationshipsAvailable}
      now={portal.now}
    />
  );
}
