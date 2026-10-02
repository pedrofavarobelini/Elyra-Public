"use client";

import { NonClinicalNotice } from "@/components/ui/non-clinical-notice";
import type { ConsentHistory } from "@/lib/contracts/consent";
import type { DataInventory } from "@/lib/contracts/data-inventory";
import { useMockStore } from "@/mocks/store";
import { PrivacyPanel } from "../privacy-panel";
import { ProfessionalSharing } from "../professional-sharing";
import { TrainingConsent } from "../training-consent";


export function PrivacySettingsView({
  inventory,
  inventoryUnavailable,
  consents,
  consentsUnavailable,
}: {
  inventory: DataInventory;
  inventoryUnavailable: boolean;
  consents: ConsentHistory;
  consentsUnavailable: boolean;
}) {
  const { user, journal } = useMockStore();

  return (
    <div className="flex flex-col gap-5 2xl:gap-8">
      <section id="cfg-profissional" aria-label="Compartilhamento" className="flex min-w-0 scroll-mt-20 flex-col gap-5">
        <ProfessionalSharing
          currentUserId={user.id}
          journalEntries={journal
            .filter((entry) => entry.status === "saved")
            .map((entry) => ({ id: entry.id, title: entry.title }))}
        />
      </section>

      <section
        id="cfg-dados"
        aria-label="Seus dados e consentimentos"
        className="grid min-w-0 scroll-mt-20 gap-5 xl:grid-cols-2 xl:items-start 2xl:gap-8"
      >
        <PrivacyPanel
          inventory={inventory}
          consents={consents}
          inventoryUnavailable={inventoryUnavailable}
          consentsUnavailable={consentsUnavailable}
        />
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start 2xl:gap-8">
        <section id="cfg-aprendizado" aria-label="Aprendizado" className="flex min-w-0 scroll-mt-20 flex-col gap-5">
          <TrainingConsent />
        </section>
        <NonClinicalNotice context="insight" />
      </div>
    </div>
  );
}
