import type { ReactNode } from "react";

import { AccessibilityPreferenceScope } from "@/components/accessibility/accessibility-preferences";
import { AppShell } from "@/components/layout/app-shell";
import { EMPTY_NOTIFICATION_SNAPSHOT } from "@/lib/contracts/notifications";
import { requireVerifiedProfessional } from "@/server/professional-gate";
import { getIdentitySnapshot } from "@/server/services/identity-service";
import { getNotificationsSnapshot } from "@/server/services/notifications-service";
import { AppLockCoordinator } from "@/components/security/app-lock-coordinator";


/*
  A area profissional usa o mesmo `terms_privacy`: verificado que o produto tem
  uma unica finalidade de termos, sem documento profissional paralelo. Fundir
  contratos distintos em silencio seria pior que exigir o mesmo de todos.
*/
export default async function ProLayout({ children }: { children: ReactNode }) {
  const { supabase, user, appLock } = await requireVerifiedProfessional();
  const [identity, notificationState] = await Promise.all([
    getIdentitySnapshot(supabase, user),
    getNotificationsSnapshot(supabase)
      .then((snapshot) => ({ snapshot, unavailable: false }))
      .catch(() => ({
        snapshot: EMPTY_NOTIFICATION_SNAPSHOT,
        unavailable: true,
      })),
  ]);

  return (
    <>
      {/*
        Stage 29 / PRO-4 (L-265): sem este escopo, o contexto profissional
        ignorava tema, densidade, cards e navegacao escolhidos pela conta - a
        mesma pessoa via a Elyra de um jeito em /dashboard e de outro em /pro.
      */}
      <AccessibilityPreferenceScope userId={user.id} />
      <AppLockCoordinator userId={user.id} initial={appLock} />
      <AppShell
        context="professional"
        notificationSnapshot={notificationState.snapshot}
        notificationsInitiallyUnavailable={notificationState.unavailable}
        userInitials={identity.user.initials}
        // Na area profissional o caminho de volta para a pessoal e sempre visivel.
        showContextSwitcher
      >
        {children}
      </AppShell>
    </>
  );
}
