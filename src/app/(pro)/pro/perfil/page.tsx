import type { Metadata } from "next";

import { requireVerifiedProfessional } from "@/server/professional-gate";
import {
  getMyVerificationHistory,
  getProfessionalProfile,
} from "@/server/services/professional-service";
import { getMyPublicProfile } from "@/server/services/professional-directory-service";
import { listOwnCredentials } from "@/server/repositories/professional-onboarding-repository";
import { ProfessionalProfileView } from "./view";

export const metadata: Metadata = { title: "Perfil profissional" };

export default async function ProPerfilPage() {
  const { supabase, user } = await requireVerifiedProfessional();
  const profile = await getProfessionalProfile(supabase, user);
  // Historico falhando nao impede editar o registro: o bloco mostra o erro.
  const history = profile
    ? await getMyVerificationHistory(supabase, user).then(
        (rows) => ({ rows, available: true }),
        () => ({ rows: [], available: false }),
      )
    : { rows: [], available: true };

  const publicProfile = profile ? await getMyPublicProfile(supabase, user).catch(() => null) : null;
  // F6: credenciais declaradas/verificadas; falha mostra o proprio erro.
  const credentials = await listOwnCredentials(supabase, user.id).then(
    (rows) => ({ available: true, rows }),
    () => ({ available: false, rows: [] }),
  );
  return (
    <ProfessionalProfileView
      initialProfile={profile}
      history={history.rows}
      historyAvailable={history.available}
      publicProfile={publicProfile}
      credentials={credentials.rows.map((row) => ({
        id: row.id,
        kind: row.kind as "education" | "experience" | "certification",
        title: row.title,
        institution: row.institution,
        startYear: row.start_year,
        endYear: row.end_year,
        expiresOn: row.expires_on,
        trustState: row.trust_state as "declared" | "verified",
      }))}
      credentialsAvailable={credentials.available}
    />
  );
}
