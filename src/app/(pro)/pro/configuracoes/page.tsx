import type { Metadata } from "next";

import { PageHeader } from "@/components/journey/page-header";
import { accountFactsFrom } from "@/lib/account";
import { APP_VERSION } from "@/lib/app-version";
import { requireVerifiedProfessional } from "@/server/professional-gate";
import { getIdentitySnapshot } from "@/server/services/identity-service";
import { getNotificationPreferences } from "@/server/services/notification-preferences-service";
import { getProfessionalProfile } from "@/server/services/professional-service";
import { getMyPublicProfile } from "@/server/services/professional-directory-service";
import { ProSettingsView } from "./view";

export const metadata: Metadata = { title: "Configurações" };


export default async function ProConfiguracoesPage() {
  const { supabase, user } = await requireVerifiedProfessional();
  const [identity, notifications, profile, publicProfile] = await Promise.all([
    getIdentitySnapshot(supabase, user),
    getNotificationPreferences(supabase).catch(() => null),
    getProfessionalProfile(supabase, user).catch(() => null),
    getMyPublicProfile(supabase, user).catch(() => null),
  ]);

  return (
    <>
      <PageHeader
        title="Configurações"
        description="A sua conta e o seu trabalho profissional. Conta, segurança e dados são os mesmos da área pessoal."
      />
      <ProSettingsView
        account={accountFactsFrom(user)}
        identity={{ name: identity.user.name, email: user.email ?? "" }}
        notificationsInAppOn={
          notifications
            ? notifications.preferences.filter((item) => item.channel === "in_app" && item.enabled).length
            : null
        }
        registration={
          profile
            ? {
                label: `${profile.council} ${profile.council_region ?? "--"}/${profile.registration_number}`,
                reviewDueAt: profile.verification_review_due_at,
              }
            : null
        }
        publicListed={publicProfile ? publicProfile.visibility.visible : null}
        version={APP_VERSION}
      />
    </>
  );
}
