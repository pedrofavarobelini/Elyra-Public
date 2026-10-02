import type { Metadata } from "next";

import { PageHeader } from "@/components/journey/page-header";
import {
  EMPTY_NOTIFICATION_PREFERENCES,
  EMPTY_NOTIFICATION_SNAPSHOT,
} from "@/lib/contracts/notifications";
import { requireAuthenticatedUser } from "@/server/auth";
import { getNotificationPreferences } from "@/server/services/notification-preferences-service";
import { getNotificationsSnapshot } from "@/server/services/notifications-service";
import { NotificationsView } from "./view";

export const metadata: Metadata = { title: "Notificações" };


export default async function NotificacoesPage() {
  const { supabase } = await requireAuthenticatedUser();

  const [inbox, preferences] = await Promise.all([
    getNotificationsSnapshot(supabase)
      .then((snapshot) => ({ snapshot, unavailable: false }))
      .catch(() => ({ snapshot: EMPTY_NOTIFICATION_SNAPSHOT, unavailable: true })),
    getNotificationPreferences(supabase)
      .then((value) => ({ value, unavailable: false }))
      .catch(() => ({ value: EMPTY_NOTIFICATION_PREFERENCES, unavailable: true })),
  ]);

  return (
    <>
      <PageHeader
        title="Notificações"
        description="Seus avisos da Elyra e como você quer recebê-los."
      />
      <NotificationsView
        initialSnapshot={inbox.snapshot}
        inboxUnavailable={inbox.unavailable}
        initialPreferences={preferences.value}
        preferencesUnavailable={preferences.unavailable}
      />
    </>
  );
}
