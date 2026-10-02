import type { Metadata } from "next";

import { PageHeader } from "@/components/journey/page-header";
import { accountFactsFrom } from "@/lib/account";
import { requireAuthenticatedUser } from "@/server/auth";
import { getConsentHistory } from "@/server/services/consent-service";
import { getDataInventory } from "@/server/services/data-inventory-service";
import { getNotificationPreferences } from "@/server/services/notification-preferences-service";
import { SettingsView } from "./view";
import { APP_VERSION } from "@/lib/app-version";

export const metadata: Metadata = { title: "Configurações" };


export default async function ConfiguracoesPage() {
  const { supabase, user } = await requireAuthenticatedUser();

  const [notifications, inventory, consents] = await Promise.all([
    getNotificationPreferences(supabase).catch(() => null),
    getDataInventory(supabase, user).catch(() => null),
    getConsentHistory(supabase).catch(() => null),
  ]);

  const inAppOn = notifications
    ? notifications.preferences.filter(
        (item) => item.channel === "in_app" && item.enabled,
      ).length
    : null;

  return (
    <>
      <PageHeader
        title="Configurações"
        description="Você controla o que a Elyra acompanha e o que compartilha."
      />
      <SettingsView
        account={accountFactsFrom(user)}
        summary={{
          notificationsInAppOn: inAppOn,
          inventoryTotal: inventory ? inventory.total : null,
          activeConsents: consents
            ? consents.purposes.filter((purpose) => purpose.active).length
            : null,
        }}
        version={APP_VERSION}
      />
    </>
  );
}
