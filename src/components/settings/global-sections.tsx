"use client";

import { Bell, BookLock, Download, ShieldCheck, Smartphone, Trash2, User } from "lucide-react";

import { PersonalizationHubCard } from "@/components/accessibility/personalization-center";
import { HubGroup, HubLink } from "@/components/settings/hub";
import { IconPill } from "@/components/ui/icon-pill";
import { NonClinicalNotice } from "@/components/ui/non-clinical-notice";
import { providerLabel, type AccountFacts } from "@/lib/account";
import { settingsPaths, type SettingsContext } from "@/lib/settings/settings-context";

export interface GlobalSettingsSummary {
  /** `null` = leitura falhou (nunca zero). */
  notificationsInAppOn: number | null;
}

/**
 * Secoes globais da conta (F4): as mesmas em `/configuracoes` e em
 * `/pro/configuracoes`. Um componente, uma fonte de caminhos, zero estado
 * duplicado — cada linha abre a mesma pagina, no shell do contexto atual.
 */
export function GlobalSettingsSections({
  context,
  account,
  identity,
  summary,
  version,
}: {
  context: SettingsContext;
  account: AccountFacts;
  identity: { name: string; email: string };
  summary: GlobalSettingsSummary;
  version: string;
}) {
  const paths = settingsPaths(context);
  const notifications =
    summary.notificationsInAppOn === null
      ? "Não foi possível ler agora"
      : summary.notificationsInAppOn === 0
        ? "Nenhum aviso ligado no aplicativo"
        : `${summary.notificationsInAppOn} ${summary.notificationsInAppOn === 1 ? "aviso ligado" : "avisos ligados"} no aplicativo`;

  return (
    <>
      <PersonalizationHubCard href={paths.personalization} />

      <HubGroup title="Conta e segurança" id="cfg-conta">
        <HubLink
          href={paths.identity}
          icon={<User />}
          title="Identidade da conta"
          status={`${identity.name} · ${identity.email}`}
        />
        <HubLink
          href={paths.security}
          icon={<ShieldCheck />}
          title="Segurança"
          status={`Forma de entrar: ${providerLabel(account.provider) ?? "não identificada"} · senha, recuperação, 2FA, passkeys e sessões`}
        />
        <HubLink href={paths.notifications} icon={<Bell />} title="Notificações" status={notifications} />
        <HubLink
          href={`${paths.security}#app-lock`}
          icon={<Smartphone />}
          title="App Lock e inatividade"
          status="PIN local deste aparelho e quando a Elyra volta a pedi-lo"
        />
      </HubGroup>

      <HubGroup title="Seus dados" id="cfg-direitos">
        <HubLink
          href={paths.data}
          icon={<Download />}
          title="Exportar meus dados"
          status="Um arquivo com tudo o que a Elyra guarda sobre você."
        />
        <HubLink
          href={paths.data}
          icon={<Trash2 />}
          title="Excluir conta"
          status="Permanente: apaga a conta e os registros, com confirmação."
          tone="destructive"
        />
      </HubGroup>

      <HubGroup title="Sobre" id="cfg-sobre">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-3">
            <IconPill tone="identity" size="sm">
              <BookLock />
            </IconPill>
            <p className="text-sm text-ink">
              Elyra <span className="tabular-nums text-ink-muted">versão {version}</span>
            </p>
          </div>
          <NonClinicalNotice context="insight" />
        </div>
      </HubGroup>
    </>
  );
}
