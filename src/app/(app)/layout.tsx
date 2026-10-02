import type { ReactNode } from "react";

import { AccessibilityPreferenceScope } from "@/components/accessibility/accessibility-preferences";
import { AppShell } from "@/components/layout/app-shell";
import { EMPTY_NOTIFICATION_SNAPSHOT } from "@/lib/contracts/notifications";
import { OfflineMockProvider } from "@/components/offline/offline-mock-provider";
import { AppLockCoordinator } from "@/components/security/app-lock-coordinator";
import { requireConsentedUser } from "@/server/auth";
import { getProfessionalCapability } from "@/server/auth-context";
import { personalWindowStart } from "@/lib/contracts/personal-window";
import { getCycleSnapshot } from "@/server/services/cycle-service";
import { getEmotionalSnapshot } from "@/server/services/emotional-service";
import { getGoalsSnapshot } from "@/server/services/goals-service";
import { getIdentitySnapshot } from "@/server/services/identity-service";
import { getJournalSnapshot } from "@/server/services/journal-service";
import { getPersonalWindow } from "@/server/services/personal-window-service";
import { getNotificationsSnapshot } from "@/server/services/notifications-service";


/*
  `requireConsentedUser`, e nao `requireAuthenticatedUser`: estar autenticado nao
  e estar autorizado. Um usuario criado por OAuth nunca passou pelo formulario de
  cadastro e chega aqui sem aceite nenhum — o portao vive no layout, e nao apenas
  no callback, porque so o layout cobre a URL digitada direto.
*/
export default async function AppLayout({ children }: { children: ReactNode }) {
  const { supabase, user, appLock } = await requireConsentedUser();

  const since = personalWindowStart();
  const [identity, emotional, journal, goals, cycle, notificationState, personalWindow, professionalCapability] = await Promise.all([
    getIdentitySnapshot(supabase, user),
    getEmotionalSnapshot(supabase, user, { since }),
    getJournalSnapshot(supabase, user, { since }),
    getGoalsSnapshot(supabase, user, { since }),
    getCycleSnapshot(supabase, user, { since }),
    getNotificationsSnapshot(supabase)
      .then((snapshot) => ({ snapshot, unavailable: false }))
      .catch(() => ({
        snapshot: EMPTY_NOTIFICATION_SNAPSHOT,
        unavailable: true,
      })),
    getPersonalWindow(supabase, user),

    getProfessionalCapability(supabase, user.id),
  ]);

  return (
    <OfflineMockProvider
      initialUser={identity.user}
      initialPreferences={identity.preferences}
      initialEmotional={emotional}
      initialJournal={journal}
      initialGoals={goals}
      initialCycle={cycle}
      initialWindow={personalWindow}
    >
      <AccessibilityPreferenceScope userId={user.id} />
      <AppLockCoordinator userId={user.id} initial={appLock} />
      <AppShell
        notificationSnapshot={notificationState.snapshot}
        notificationsInitiallyUnavailable={notificationState.unavailable}
        userInitials={identity.user.initials}
        showContextSwitcher={professionalCapability === "VERIFIED"}
      >
        {children}
      </AppShell>
    </OfflineMockProvider>
  );
}
