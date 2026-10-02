import type { Metadata } from "next";

import { requireVerifiedProfessional } from "@/server/professional-gate";
import { getProfessionalPortal } from "@/server/services/professional-service";
import { SolicitacoesView } from "./view";
import { professionalInviteEnvironment } from "@/server/professional-invite-environment";

export const metadata: Metadata = { title: "Central de solicitações" };

export default async function ProSolicitacoesPage() {
  const { supabase, user } = await requireVerifiedProfessional();
  const portal = await getProfessionalPortal(supabase, user);
  return (
    <SolicitacoesView
      inviteEnvironment={professionalInviteEnvironment()}
      hasProfile={Boolean(portal.profile) || !portal.profileAvailable}
      verified={portal.profile?.effective_verification_status === "verified"}
      requests={portal.relationships
        .filter((relationship) => relationship.status === "pending")
        .map((relationship) => ({ id: relationship.id, invitedAt: relationship.invitedAt }))}
      requestsAvailable={portal.relationshipsAvailable}
      invites={portal.invites}
      acceptedNames={Object.fromEntries(
        portal.relationships
          .filter((relationship) => relationship.status === "active" && relationship.displayName)
          .map((relationship) => [relationship.id, relationship.displayName as string]),
      )}
      invitesAvailable={portal.invitesAvailable}
    />
  );
}
