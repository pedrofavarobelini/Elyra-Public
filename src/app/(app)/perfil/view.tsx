"use client";

import {
  Bell,
  CalendarHeart,
  Check,
  ChevronRight,
  Clock3,
  Download,
  KeyRound,
  BriefcaseMedical,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatDateTime,
  formatMonthYear,
  providerLabel,
  usesPassword,
  type AccountFacts,
} from "@/lib/account";
import {
  PROFESSIONAL_STATE_POLICY,
  type ProfessionalState,
} from "@/lib/contracts/professional-state";
import {
  PRIMARY_GOALS,
  PRIMARY_GOAL_LABEL,
  type PrimaryGoal,
} from "@/lib/contracts/identity";
import { cn } from "@/lib/utils";
import { useMockStore } from "@/mocks/store";
import { ProfilePhotoEditor } from "./profile-photo";


export function ProfileView({
  account,
  initialHasPhoto,
  professionalState,
}: {
  account: AccountFacts;
  initialHasPhoto: boolean;
  /** F1: um CTA por estado; a mesma conta, nunca uma segunda identidade. */
  professionalState: ProfessionalState;
}) {
  const professionalCta = PROFESSIONAL_STATE_POLICY[professionalState].cta;
  const { user, checkins, journal, goals } = useMockStore();

  const activeJournal = journal.filter((e) => e.trashedAt === null).length;
  const activeGoals = goals.filter((g) => g.status === "active").length;
  const memberSince = formatMonthYear(account.createdAt);
  const lastAccess = formatDateTime(account.lastSignInAt);
  const method = providerLabel(account.provider);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,1fr)] 2xl:grid-cols-[minmax(0,1.6fr)_minmax(24rem,1fr)]">
      <div className="flex min-w-0 flex-col gap-5">
        {/* Identidade */}
        <section
          aria-label="Identidade"
          className="relative overflow-hidden rounded-panel border border-line bg-gradient-to-br from-brand-100 via-surface-brand to-identity-50 p-5 shadow-card sm:p-6"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 200 200"
            className="pointer-events-none absolute -right-10 -top-12 size-48 text-identity-600/10 sm:size-56"
          >
            <circle cx="100" cy="100" r="70" fill="none" stroke="currentColor" strokeWidth="10" />
            <circle cx="100" cy="100" r="40" fill="none" stroke="currentColor" strokeWidth="6" />
          </svg>
          <div className="relative flex flex-col items-start gap-4 sm:flex-row sm:items-start">
            <ProfilePhotoEditor initials={user.initials} initialHasPhoto={initialHasPhoto} />
            <div className="min-w-0">
              <p className="truncate text-xl font-semibold tracking-tight text-ink sm:text-2xl">
                {user.name}
              </p>
              <p className="truncate text-sm text-ink-muted">{user.email}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {method ? (
                  <Badge tone="identity">
                    <KeyRound className="size-3" aria-hidden="true" />
                    {method}
                  </Badge>
                ) : null}
                {memberSince ? (
                  <Badge tone="brand">
                    <CalendarHeart className="size-3" aria-hidden="true" />
                    Desde {memberSince}
                  </Badge>
                ) : null}
                {lastAccess ? (
                  <Badge tone="neutral">
                    <Clock3 className="size-3" aria-hidden="true" />
                    Último acesso {lastAccess}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <GoalCard />
        <AccountCard />
      </div>

      <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Acesso e sessão</CardTitle>
            <CardDescription>
              {lastAccess
                ? `Último acesso registrado: ${lastAccess}.`
                : "Seu acesso atual está ativo neste aparelho."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {usesPassword(account.provider) ? (
              <ShortcutLink href="/recuperar-senha" icon={KeyRound} label="Redefinir minha senha por e-mail" />
            ) : (
              <p className="py-2 text-sm text-ink-muted">
                O acesso é feito pela {method}; a senha é gerenciada lá.
              </p>
            )}
            <ShortcutLink href="/seguranca" icon={ShieldCheck} label="Segurança e sessões" />
            {professionalCta ? (
              <div data-testid="professional-access-cta" data-professional-state={professionalState}>
                <ShortcutLink href={professionalCta.href} icon={BriefcaseMedical} label={professionalCta.label} />
              </div>
            ) : null}
            <div className="mt-2 border-t border-line pt-3">
              <LogoutButton />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Seus registros</CardTitle>
            <CardDescription>Contagem simples, sem análise.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="flex flex-col-reverse rounded-control bg-surface-muted px-2 py-3">
                <dt className="text-xs text-ink-muted">Check-ins</dt>
                <dd className="text-xl font-semibold tabular-nums text-ink">{checkins.length}</dd>
              </div>
              <div className="flex flex-col-reverse rounded-control bg-surface-muted px-2 py-3">
                <dt className="text-xs text-ink-muted">Anotações no diário</dt>
                <dd className="text-xl font-semibold tabular-nums text-ink">{activeJournal}</dd>
              </div>
              <div className="flex flex-col-reverse rounded-control bg-surface-muted px-2 py-3">
                <dt className="text-xs text-ink-muted">Metas ativas</dt>
                <dd className="text-xl font-semibold tabular-nums text-ink">{activeGoals}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Privacidade e dados</CardTitle>
            <CardDescription>
              O que existe sobre você, quem pode ver e como levar ou apagar.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <ShortcutLink href="/configuracoes/privacidade" icon={LockKeyhole} label="O que existe sobre você" />
            <ShortcutLink href="/configuracoes/privacidade#cfg-profissional" icon={UserRoundCheck} label="Quem pode ver seus dados" />
            <ShortcutLink href="/configuracoes/dados" icon={Download} label="Exportar ou excluir a conta" />
            <ShortcutLink href="/notificacoes" icon={Bell} label="Notificações" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ShortcutLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof Bell;
  label: string;
}) {
  return (
    <Link
      href={href as Route}
      className="motion-press group flex min-h-11 items-center gap-3 rounded-control px-2 text-sm text-ink transition-colors hover:bg-surface-muted"
    >
      <Icon className="size-4 text-brand-600" aria-hidden="true" />
      <span className="flex-1">{label}</span>
      <ChevronRight
        className="size-4 text-ink-subtle transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

function GoalCard() {
  const { preferences, updatePreferences } = useMockStore();
  const [saving, setSaving] = useState<PrimaryGoal | "clear" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const current = preferences.primaryGoal;

  const save = async (goal: PrimaryGoal | null) => {
    setSaving(goal ?? "clear");
    setError(null);
    setMessage(null);
    try {
      await updatePreferences({ primaryGoal: goal });
      setMessage(goal ? "Objetivo salvo." : "Objetivo removido.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meu objetivo na Elyra</CardTitle>
        <CardDescription>
          O que você espera do aplicativo. É uma preferência sua:{" "}
          <strong className="font-medium text-ink">
            a Elyra não tira conclusões sobre você a partir dela.
          </strong>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div
          role="group"
          aria-label="Objetivo principal"
          className="grid gap-2 sm:grid-cols-2"
        >
          {PRIMARY_GOALS.map((goal) => {
            const selected = current === goal;
            return (
              <button
                key={goal}
                type="button"
                aria-pressed={selected}
                disabled={saving !== null}
                onClick={() => void save(goal)}
                className={cn(
                  "motion-press flex min-h-11 items-center justify-between gap-2 rounded-control border px-3.5 py-2 text-left text-sm transition-colors disabled:cursor-wait",
                  selected
                    ? "border-brand-400 bg-brand-100 font-medium text-brand-800"
                    : "border-line bg-surface text-ink hover:border-brand-200 hover:bg-surface-brand",
                )}
              >
                {PRIMARY_GOAL_LABEL[goal]}
                {selected ? (
                  <Check className="motion-pop size-4 shrink-0 text-brand-600" aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
          <p aria-live="polite" className="text-sm">
            {error ? (
              <span role="alert" className="text-destructive">{error}</span>
            ) : message ? (
              <span className="motion-pop text-positive">{message}</span>
            ) : current === null ? (
              <span className="text-ink-subtle">Nenhum objetivo escolhido.</span>
            ) : null}
          </p>
          {current !== null ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving !== null}
              onClick={() => void save(null)}
            >
              Remover escolha
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const { user, updateProfile } = useMockStore();
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Conta</CardTitle>
        <CardDescription>
          Como você aparece na Elyra. O e-mail identifica o acesso e não é
          alterado por aqui.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="p-name">Nome</Label>
            <Input
              id="p-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="p-email">E-mail</Label>
            <Input
              id="p-email"
              type="email"
              value={user.email}
              readOnly
              className="bg-surface-muted text-ink-muted"
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="motion-pop text-sm text-positive">
            {message}
          </p>
        ) : null}

        <div>
          <Button
            type="button"
            disabled={saving || name.trim() === user.name}
            onClick={async () => {
              setSaving(true);
              setError(null);
              setMessage(null);
              try {
                await updateProfile({ displayName: name });
                setMessage("Perfil atualizado.");
              } catch (caught) {
                setError(
                  caught instanceof Error ? caught.message : "Não foi possível salvar.",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Salvando..." : "Salvar alterações"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
