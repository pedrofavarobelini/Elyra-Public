"use client";

import {
  KeyRound,
  LaptopMinimal,
  MonitorSmartphone,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import { LogoutButton } from "@/components/layout/logout-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Disclosure } from "@/components/ui/disclosure";
import { IconPill } from "@/components/ui/icon-pill";
import {
  formatDateTime,
  providerLabel,
  usesPassword,
  type AccountFacts,
} from "@/lib/account";
import {
  signOutOtherSessionsAction,
  type OtherSessionsState,
} from "./actions";
import { MfaCard } from "./mfa-card";
import { PasskeyCard } from "./passkey-card";
import { AppLockCard } from "./app-lock-card";
import { CapabilityNotice } from "@/components/capability-notice";
import { APPLE_SIGN_IN_CAPABILITY } from "@/lib/capabilities";
import type { PasskeyInfo } from "@/app/passkey-actions";
import type { AppLockSummary } from "@/lib/app-lock/contracts";
import type { AppUser } from "@/lib/contracts/identity";


const NOT_AVAILABLE = [
  {
    icon: ShieldCheck,
    title: "Códigos de recuperação",
    body: "A verificação em duas etapas existe, mas o backend atual não fornece códigos próprios. A recuperação de senha não remove o fator TOTP.",
  },
  {
    icon: MonitorSmartphone,
    title: "Lista detalhada de aparelhos",
    body: "A Elyra mostra a sessão atual e permite sair daqui ou encerrar todas as outras, mas o backend não expõe uma lista confiável de dispositivos.",
  },
] as const;

export function SecurityView({
  account,
  mfaEnabled,
  passkeysAvailable,
  passkeys,
  passkeyOwner,
  appLock,
  appLockUserId,
}: {
  account: AccountFacts;
  mfaEnabled: boolean;
  passkeysAvailable: boolean;
  passkeys: PasskeyInfo[];
  passkeyOwner: AppUser;
  appLock: AppLockSummary;
  appLockUserId: string;
}) {
  const method = providerLabel(account.provider);
  const lastAccess = formatDateTime(account.lastSignInAt);
  const password = usesPassword(account.provider);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,1fr)] 2xl:grid-cols-[minmax(0,1.6fr)_minmax(24rem,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        {/* Resumo: o estado em uma leitura. */}
        <section
          aria-label="Resumo da segurança"
          className="grid gap-3 rounded-panel border border-line bg-gradient-to-br from-identity-50 via-surface to-brand-50 p-4 shadow-card sm:grid-cols-3 sm:p-5"
        >
          <SummaryItem
            icon={<KeyRound />}
            label="Forma de entrar"
            value={method ?? "Não identificada"}
          />
          <SummaryItem
            icon={<Smartphone />}
            label="Este aparelho"
            value="Conectado"
          />
          <SummaryItem
            icon={<LaptopMinimal />}
            label="Último acesso"
            value={lastAccess ?? "Não registrado"}
          />
        </section>

        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <IconPill tone="brand">
                <KeyRound />
              </IconPill>
              <div className="min-w-0">
                <CardTitle>Senha</CardTitle>
                <CardDescription>
                  {password
                    ? "A troca é feita por um link enviado ao seu e-mail."
                    : `Você entra pela ${method}. A senha é gerenciada lá, e não na Elyra.`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          {password ? (
            <CardContent className="flex flex-col gap-3">
              <p className="text-sm text-ink">
                Depois que você criar a nova senha,{" "}
                <strong className="font-medium">a antiga deixa de funcionar</strong>{" "}
                e será preciso entrar de novo.
              </p>
              <div>
                <Button asChild variant="secondary">
                  <Link href="/recuperar-senha">Redefinir senha por e-mail</Link>
                </Button>
              </div>
            </CardContent>
          ) : null}
        </Card>

        <MfaCard enabled={mfaEnabled} />

        <PasskeyCard
          available={passkeysAvailable}
          initialPasskeys={passkeys}
          owner={passkeyOwner}
        />

        <AppLockCard userId={appLockUserId} initial={appLock} />

        <SessionsCard />
      </div>

      <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-4 lg:self-start">
        <Card variant="muted">
          <CardHeader>
            <CardTitle>Limitações atuais</CardTitle>
            <CardDescription>
              O que o backend atual não oferece e quais alternativas continuam disponíveis.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col divide-y divide-line">
              {NOT_AVAILABLE.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                  <Icon className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{title}</p>
                    <p className="text-sm text-ink-muted">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <CapabilityNotice assessment={APPLE_SIGN_IN_CAPABILITY} className="mt-4" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Boas práticas</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-ink-muted">
            <p>Em aparelho compartilhado, saia ao terminar.</p>
            <p>A Elyra não pede sua senha por e-mail nem por mensagem.</p>
            <Disclosure summary="Como o acesso é protegido">
              <p className="mt-1">
                A sessão fica em cookies que o JavaScript da página não lê, e o
                servidor confere sua identidade a cada tela. Quem não entrou na
                conta não chega aos seus registros.
              </p>
            </Disclosure>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SummaryItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <IconPill tone="identity" size="sm">
        {icon}
      </IconPill>
      <div className="min-w-0">
        <p className="text-xs text-ink-subtle">{label}</p>
        <p className="truncate text-sm font-semibold text-ink">{value}</p>
      </div>
    </div>
  );
}

const IDLE: OtherSessionsState = { status: "idle" };

function SessionsCard() {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(
    async () => {
      const next = await signOutOtherSessionsAction();
      setConfirming(false);
      return next;
    },
    IDLE,
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <IconPill tone="identity">
            <MonitorSmartphone />
          </IconPill>
          <div className="min-w-0">
            <CardTitle>Sessões</CardTitle>
            <CardDescription>
              Onde sua conta fica aberta e como encerrar esse acesso.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-line">
        <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
              Este aparelho
              <Badge tone="positive">Sessão atual</Badge>
            </p>
            <p className="text-sm text-ink-muted">Sair encerra o acesso só aqui.</p>
          </div>
          <LogoutButton />
        </div>

        <div className="flex flex-col gap-3 pt-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Outros aparelhos</p>
            <p className="text-sm text-ink-muted">
              Encerra a conta em qualquer outro celular ou computador.{" "}
              <strong className="font-medium text-ink">
                Este aparelho continua conectado.
              </strong>
            </p>
          </div>
          {state.status !== "idle" ? (
            <p
              role={state.status === "error" ? "alert" : "status"}
              className={
                state.status === "error"
                  ? "text-sm text-destructive"
                  : "motion-pop text-sm text-positive"
              }
            >
              {state.message}
            </p>
          ) : null}
          <div>
            <Button variant="secondary" onClick={() => setConfirming(true)}>
              Sair dos outros aparelhos
            </Button>
          </div>
        </div>
      </CardContent>

      <Dialog open={confirming} onOpenChange={(open) => !pending && setConfirming(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sair dos outros aparelhos?</DialogTitle>
            <DialogDescription>
              Os outros aparelhos vão precisar entrar de novo com e-mail e senha
              ou Google. Este aparelho continua conectado.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-ink-muted">
            Um aparelho que estiver com a Elyra aberta agora pode levar até 1 hora
            para perder o acesso.
          </p>
          <form action={action}>
            <DialogFooter>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Encerrando..." : "Sair dos outros aparelhos"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
