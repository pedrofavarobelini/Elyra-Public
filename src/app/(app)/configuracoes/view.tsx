"use client";

import {
  BadgeCheck,
  CalendarDays,
  GraduationCap,
  History,
  LockKeyhole,
  MessageSquareText,
  Target,
  Trash2,
  UserRoundCheck,
  UserRoundSearch,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { GlobalSettingsSections } from "@/components/settings/global-sections";
import { HubGroup, HubLink } from "@/components/settings/hub";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AccountFacts } from "@/lib/account";
import { PRIMARY_GOAL_LABEL } from "@/lib/contracts/identity";
import { useMockStore } from "@/mocks/store";



export interface SettingsSummary {
  /** `null` = leitura falhou (nunca zero). */
  notificationsInAppOn: number | null;
  inventoryTotal: number | null;
  activeConsents: number | null;
}

export function SettingsView({
  account,
  summary,
  version,
}: {
  account: AccountFacts;
  summary: SettingsSummary;
  version: string;
}) {
  const {
    cycle,
    periods,
    cycleRecords,
    user,
    preferences,
    enableCycle,
    disableCycle,
    deleteCycleData,
    sessionsEnabled,
    setSessionsEnabled,
  } = useMockStore();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cycleError, setCycleError] = useState<string | null>(null);
  const [cycleBusy, setCycleBusy] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionsBusy, setSessionsBusy] = useState(false);

  const cycleDataCount = periods.length + cycleRecords.length;
  const readable = (value: number | null, render: (n: number) => string) =>
    value === null ? "Não foi possível ler agora" : render(value);

  return (
    <div
      data-testid="settings-hub"
      data-settings-context="personal"
      className="grid gap-[var(--density-stack)] xl:grid-cols-2 xl:items-start"
    >
      <div data-testid="settings-column" className="flex min-w-0 flex-col gap-[var(--density-stack)]">
        <GlobalSettingsSections
          context="personal"
          account={account}
          identity={{ name: user.name, email: user.email }}
          summary={{ notificationsInAppOn: summary.notificationsInAppOn }}
          version={version}
        />

        {/*
          F1/F4: extra so da area pessoal. Leva a Area profissional (estado e
          cadastro), nunca direto ao portal: /pro so abre para VERIFIED.
        */}
        <HubGroup title="Área profissional" id="cfg-area-profissional">
          <HubLink
            href="/area-profissional"
            icon={<BadgeCheck />}
            title="Área profissional"
            status="Mesma conta. Cadastro, verificação do registro (CRP) e situação atual"
          />
        </HubGroup>
      </div>

      <div data-testid="settings-column" className="flex min-w-0 flex-col gap-[var(--density-stack)]">
        <HubGroup
          title="Acompanhamento"
          id="cfg-acompanhamento"
          description="Recursos opcionais. Nada é ativado sem a sua escolha explícita."
        >
          <div className="flex items-start justify-between gap-6 p-4">
            <div className="min-w-0">
              <Label htmlFor="cfg-cycle">Acompanhamento do ciclo</Label>
              <p className="mt-0.5 text-sm text-ink-muted">
                Ativa o registro de ciclo menstrual. Você pode desativar a
                qualquer momento e{" "}
                <strong className="font-medium text-ink">desativar não apaga</strong>{" "}
                seus registros.
              </p>
              {cycle.enabled ? (
                <Button asChild variant="link" size="sm" className="mt-1 px-0">
                  <Link href="/ciclo">Abrir o ciclo</Link>
                </Button>
              ) : null}
              {cycleError ? (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {cycleError}
                </p>
              ) : null}
            </div>
            <Switch
              id="cfg-cycle"
              checked={cycle.enabled}
              disabled={cycleBusy}
              onCheckedChange={(on) => {
                setCycleBusy(true);
                setCycleError(null);
                void (on ? enableCycle() : disableCycle())
                  .catch((caught) => {
                    setCycleError(
                      caught instanceof Error
                        ? caught.message
                        : "Não foi possível atualizar o acompanhamento.",
                    );
                  })
                  .finally(() => setCycleBusy(false));
              }}
            />
          </div>

          {cycleDataCount > 0 ? (
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Dados do ciclo</p>
                <p className="text-sm text-ink-muted">
                  Você tem {periods.length} períodos e {cycleRecords.length}{" "}
                  registros diários guardados. Excluir é diferente de desativar
                  e não pode ser desfeito.
                </p>
              </div>
              <Button
                variant="secondary"
                className="shrink-0 text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden="true" />
                Excluir dados do ciclo
              </Button>
            </div>
          ) : null}

          {/* Este controle governa **apenas a existencia** do modulo.
              Tela, camera e microfone sao permissoes de dispositivo e sao
              escolhidas uma a uma no preflight de cada sessao - ligar a feature
              nunca concede captura. */}
          <div className="flex items-start justify-between gap-6 p-4">
            <div className="min-w-0">
              <Label htmlFor="cfg-sessions">Sessões multimodais (Beta)</Label>
              <p className="mt-0.5 text-sm text-ink-muted">
                Habilita a área de sessões.{" "}
                <strong className="font-medium text-ink">
                  Nenhuma permissão de tela, câmera ou microfone é concedida
                  aqui
                </strong>{" "}
                - cada uma é escolhida separadamente ao preparar uma sessão.
              </p>
              {sessionsEnabled ? (
                <Button asChild variant="link" size="sm" className="mt-1 px-0">
                  <Link href="/sessoes">Preparar uma sessão</Link>
                </Button>
              ) : null}
              {sessionsError ? (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {sessionsError}
                </p>
              ) : null}
            </div>
            <Switch
              id="cfg-sessions"
              checked={sessionsEnabled}
              disabled={sessionsBusy}
              onCheckedChange={(on) => {
                setSessionsBusy(true);
                setSessionsError(null);
                void setSessionsEnabled(on)
                  .catch((caught) => {
                    setSessionsError(
                      caught instanceof Error
                        ? caught.message
                        : "Não foi possível atualizar as sessões.",
                    );
                  })
                  .finally(() => setSessionsBusy(false));
              }}
            />
          </div>

          <HubLink
            href="/perfil"
            icon={<Target />}
            title="Meu objetivo na Elyra"
            status={
              preferences.primaryGoal
                ? PRIMARY_GOAL_LABEL[preferences.primaryGoal]
                : "Nenhum objetivo escolhido"
            }
          />
        </HubGroup>

        <HubGroup
          title="Privacidade e consentimento"
          id="cfg-privacidade"
          description={
            <>
              Seu diário é privado por padrão e nunca aparece em registros do
              sistema. O compartilhamento com profissionais é granular por
              categoria e pode ser revogado a qualquer momento.
            </>
          }
        >
          <HubLink
            href="/configuracoes/privacidade#cfg-dados"
            icon={<LockKeyhole />}
            title="O que existe sobre você"
            status={readable(summary.inventoryTotal, (n) => `Total de ${n} registro(s)`)}
          />
          <HubLink
            href="/configuracoes/privacidade#cfg-consentimentos"
            icon={<History />}
            title="Histórico de consentimento"
            status={readable(summary.activeConsents, (n) =>
              n === 1 ? "1 autorização vigente" : `${n} autorizações vigentes`,
            )}
          />
          <HubLink
            href="/configuracoes/privacidade#cfg-profissional"
            icon={<UserRoundCheck />}
            title="Compartilhamento com profissional"
            status="Sem conexão aceita, todo acesso profissional é negado. Cada categoria é liberada por você."
          />
          {/* ADR-0029: tambem no menu (Sessoes). Atalho mantido no hub. */}
          <HubLink
            href="/agenda"
            icon={<CalendarDays />}
            title="Sessão com profissional"
            status="Pedidos de horário, próximas sessões e histórico com quem já acompanha você"
          />
          {/* ADR-0029: tambem no menu (Recados ao profissional). */}
          <HubLink
            href="/pedidos"
            icon={<MessageSquareText />}
            title="Recados ao profissional"
            status="Uma mensagem curta para quem acompanha você. Não é emergência e não tem prazo"
          />
          {/* Stage 29 / PRO-5: descoberta pertence ao contexto pessoal. */}
          <HubLink
            href="/profissionais"
            icon={<UserRoundSearch />}
            title="Encontrar profissional"
            status="Perfis com registro conferido que escolheram aparecer. Só fatos, sem ranking"
          />
          <HubLink
            href="/configuracoes/privacidade#cfg-aprendizado"
            icon={<GraduationCap />}
            title="Aprendizado da Elyra"
            status="Nenhum relatório é enviado para treino sem você ligar."
          />
        </HubGroup>


      </div>

      <Dialog
        open={confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(false)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir os dados do ciclo?</DialogTitle>
            <DialogDescription>
              Os {periods.length} períodos e {cycleRecords.length} registros
              diários serão removidos permanentemente. Esta ação não pode ser
              desfeita e é diferente de desativar o acompanhamento.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={cycleBusy}
              onClick={() => {
                setCycleBusy(true);
                setCycleError(null);
                void deleteCycleData()
                  .then(() => setConfirmDelete(false))
                  .catch((caught) => {
                    setCycleError(
                      caught instanceof Error
                        ? caught.message
                        : "Não foi possível excluir os dados do ciclo.",
                    );
                  })
                  .finally(() => setCycleBusy(false));
              }}
            >
              {cycleBusy ? "Excluindo..." : "Excluir em definitivo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
