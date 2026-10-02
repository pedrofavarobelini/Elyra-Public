"use client";

import { BadgeCheck, CalendarClock, Eye, IdCard, SlidersHorizontal } from "lucide-react";

import { GlobalSettingsSections } from "@/components/settings/global-sections";
import { HubGroup, HubLink } from "@/components/settings/hub";
import type { AccountFacts } from "@/lib/account";
import { formatDate } from "@/lib/professional/portal";
import { settingsPaths } from "@/lib/settings/settings-context";

/**
 * Hub profissional (F4). Coluna 1: o que so existe no trabalho profissional
 * (e o motivo de abrir este hub; no celular vem primeiro). Coluna 2: secoes
 * globais (as mesmas do pessoal). Ordem do DOM = ordem visual.
 */
export function ProSettingsView({
  account,
  identity,
  notificationsInAppOn,
  registration,
  publicListed,
  version,
}: {
  account: AccountFacts;
  identity: { name: string; email: string };
  notificationsInAppOn: number | null;
  registration: { label: string; reviewDueAt: string | null } | null;
  publicListed: boolean | null;
  version: string;
}) {
  return (
    <div data-testid="settings-hub" data-settings-context="professional" className="grid gap-[var(--density-stack)] xl:grid-cols-2 xl:items-start">
      <div data-testid="settings-column" className="flex min-w-0 flex-col gap-[var(--density-stack)]">
        <HubGroup
          title="Trabalho profissional"
          id="cfg-profissional"
          description="O que só existe no seu trabalho como profissional. Nada aqui muda a sua área pessoal."
        >
          <HubLink
            href="/pro/perfil"
            icon={<IdCard />}
            title="Perfil profissional"
            status="Registro, área de atuação e histórico da verificação"
          />
          <HubLink
            href="/pro/perfil#verificacao"
            icon={<BadgeCheck />}
            title="Registro e verificação"
            status={
              registration
                ? `${registration.label}${registration.reviewDueAt ? ` · conferência válida até ${formatDate(registration.reviewDueAt)}` : ""}`
                : "Não foi possível ler agora"
            }
          />
          <HubLink
            href="/pro/perfil#perfil-publico"
            icon={<Eye />}
            title="Perfil público"
            status={
              publicListed === null
                ? "Não foi possível ler agora"
                : publicListed
                  ? "Aparece na descoberta"
                  : "Não aparece na descoberta"
            }
          />
          <HubLink
            href="/pro/agenda#disponibilidade"
            icon={<CalendarClock />}
            title="Disponibilidade"
            status="Dias e horários em que você aceita pedidos"
          />
          <HubLink
            href={`${settingsPaths("professional").notifications}`}
            icon={<SlidersHorizontal />}
            title="Preferências profissionais"
            status="Avisos de pedidos de horário, solicitações, sessões e verificação"
          />
        </HubGroup>
      </div>
      <div data-testid="settings-column" className="flex min-w-0 flex-col gap-[var(--density-stack)]">
        <GlobalSettingsSections
          context="professional"
          account={account}
          identity={identity}
          summary={{ notificationsInAppOn }}
          version={version}
        />
      </div>

    </div>
  );
}
