import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { parseOnboardingStep, type OnboardingStep } from "@/lib/contracts/professional-onboarding";
import { requireConsentedUser } from "@/server/auth";
import { getIdentitySnapshot } from "@/server/services/identity-service";
import { getProfessionalArea, missingForSubmission } from "@/server/services/professional-onboarding-service";
import { OnboardingWizard } from "./wizard";

export const metadata: Metadata = { title: "Cadastro profissional" };
export const dynamic = "force-dynamic";


export default async function ProfessionalOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user } = await requireConsentedUser();
  const area = await getProfessionalArea(supabase, user);

  // Verificado edita pelo Perfil profissional; suspenso nao edita.
  if (area.state === "VERIFIED") redirect("/pro/perfil");
  if (area.state === "SUSPENDED") redirect("/area-profissional");

  const params = await searchParams;
  const requested = parseOnboardingStep(Array.isArray(params.etapa) ? params.etapa[0] : params.etapa);
  const resumed = parseOnboardingStep(area.onboarding?.current_step);
  const step: OnboardingStep = requested ?? resumed ?? "inicio";
  const identity = await getIdentitySnapshot(supabase, user);
  const draft = (area.onboarding?.draft_public_profile ?? {}) as Record<string, unknown>;

  return (
    <OnboardingWizard
      key={step}
      step={step}
      state={area.state}
      accountName={identity.user.name}
      completed={area.onboarding?.completed_steps ?? []}
      identityConfirmed={Boolean(area.onboarding?.identity_confirmed_at)}
      registry={{
        councilRegion: area.onboarding?.draft_council_region ?? area.profile?.council_region ?? "",
        registrationNumber: area.onboarding?.draft_registration_number ?? area.profile?.registration_number ?? "",
        specialty: area.onboarding?.draft_specialty ?? area.profile?.specialty ?? "",
      }}
      publicDraft={{
        displayName: typeof draft.displayName === "string" ? draft.displayName : null,
        bio: typeof draft.bio === "string" ? draft.bio : null,
        city: typeof draft.city === "string" ? draft.city : null,
        state: typeof draft.state === "string" ? draft.state : null,
        modalities: Array.isArray(draft.modalities) ? (draft.modalities as string[]) : [],
        areas: Array.isArray(draft.areas) ? (draft.areas as string[]) : [],
        languages: Array.isArray(draft.languages) ? (draft.languages as string[]) : [],
      }}
      credentials={area.credentials.map((row) => ({
        id: row.id,
        kind: row.kind as "education" | "experience" | "certification",
        title: row.title,
        institution: row.institution,
        startYear: row.start_year,
        endYear: row.end_year,
        expiresOn: row.expires_on,
        trustState: row.trust_state as "declared" | "verified",
      }))}
      missing={missingForSubmission(area.onboarding)}
      lastReason={area.history.rows[0]?.reason_code ?? null}
      submittedAt={area.onboarding?.submitted_at ?? null}
    />
  );
}
