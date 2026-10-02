import type { Metadata } from "next";

import { requireConsentedUser } from "@/server/auth";
import { getProfessionalArea } from "@/server/services/professional-onboarding-service";
import { ProfessionalAreaView } from "./view";

export const metadata: Metadata = { title: "Área profissional" };
export const dynamic = "force-dynamic";


export default async function ProfessionalAreaPage() {
  const { supabase, user } = await requireConsentedUser();
  const area = await getProfessionalArea(supabase, user);
  return (
    <ProfessionalAreaView
      state={area.state}
      registration={
        area.profile
          ? {
              council: area.profile.council,
              region: area.profile.council_region,
              number: area.profile.registration_number,
              reviewedAt: area.profile.verification_reviewed_at,
              reviewDueAt: area.profile.verification_review_due_at,
            }
          : null
      }
      progress={{
        completed: area.onboarding?.completed_steps ?? [],
        currentStep: area.onboarding?.current_step ?? null,
        submittedAt: area.onboarding?.submitted_at ?? null,
      }}
      history={area.history.rows}
      historyAvailable={area.history.available}
    />
  );
}
