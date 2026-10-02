import type { Metadata, Route } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/journey/page-header";
import { EMPTY_CONSENT_HISTORY } from "@/lib/contracts/consent";
import { EMPTY_DATA_INVENTORY } from "@/lib/contracts/data-inventory";
import { resolveReturnTo } from "@/lib/navigation/return-to";
import { requireAuthenticatedUser } from "@/server/auth";
import { getConsentHistory } from "@/server/services/consent-service";
import { getDataInventory } from "@/server/services/data-inventory-service";
import { PrivacySettingsView } from "./view";

export const metadata: Metadata = { title: "Privacidade e consentimento" };


export default async function PrivacidadePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, user } = await requireAuthenticatedUser();
  // L-398: "Voltar" leva a origem (ex.: perfil do profissional), validada; sem ela, o hub.
  const back = resolveReturnTo((await searchParams).returnTo, {
    href: "/configuracoes",
    label: "Voltar para o hub de ajustes",
  });

  const [inventory, consents] = await Promise.all([
    getDataInventory(supabase, user)
      .then((value) => ({ value, unavailable: false }))
      .catch(() => ({ value: EMPTY_DATA_INVENTORY, unavailable: true })),
    getConsentHistory(supabase)
      .then((value) => ({ value, unavailable: false }))
      .catch(() => ({ value: EMPTY_CONSENT_HISTORY, unavailable: true })),
  ]);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={back.href as Route}
            data-testid="privacy-back"
            className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline lg:min-h-0"
          >
            ← {back.label}
          </Link>
        }
        title="Privacidade e consentimento"
        description="O que existe sobre você, quem pode ver e o que você autorizou."
      />
      <PrivacySettingsView
        inventory={inventory.value}
        inventoryUnavailable={inventory.unavailable}
        consents={consents.value}
        consentsUnavailable={consents.unavailable}
      />
    </>
  );
}
