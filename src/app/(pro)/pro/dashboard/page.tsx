import {
  Activity,
  BadgeCheck,
  ChevronRight,
  Inbox,
  Link2,
  PauseCircle,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/journey/page-header";
import {
  BlockError,
  PersonCell,
  RelationshipStatusBadge,
} from "@/components/professional/portal-bits";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import {
  VERIFICATION_DESCRIPTION,
  VERIFICATION_LABEL,
} from "@/lib/contracts/professional-verification";
import { SHARING_SCOPE_LABEL } from "@/lib/contracts/sharing";
import {
  buildCockpit,
  currentScopeCount,
  formatDate,
  formatDateTime,
  lastKnownChange,
} from "@/lib/professional/portal";
import { cn } from "@/lib/utils";
import { requireVerifiedProfessional } from "@/server/professional-gate";
import {
  getProfessionalPortal,
  portalVerification,
} from "@/server/services/professional-service";

export const metadata: Metadata = { title: "Dashboard profissional" };


export default async function ProDashboardPage() {
  const { supabase, user } = await requireVerifiedProfessional();
  const portal = await getProfessionalPortal(supabase, user);

  if (portal.profileAvailable && !portal.profile) {
    return (
      <>
        <PageHeader title="Dashboard" description="O que precisa da sua atenção agora." />
        <Card>
          <CardContent>
            <EmptyState
              title="Cadastre seu registro profissional"
              description="O portal começa pelo registro no conselho. Uma pessoa confere o registro na fonte oficial antes de qualquer acesso."
              action={
                <Button asChild>
                  <Link href="/area-profissional/cadastro">Cadastrar registro</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </>
    );
  }

  const verification = portalVerification(portal);
  const cockpit = buildCockpit({
    verification,
    relationships: portal.relationships,
    invites: portal.invites,
    scopeLabel: (scope) => SHARING_SCOPE_LABEL[scope],
    now: portal.now,
  });
  const verified = verification?.status === "verified";

  const numbers = [
    {
      label: "Acompanhamentos ativos",
      value: cockpit.counts.active,
      icon: Users,
      tone: "brand" as const,
      href: "/pro/acompanhamentos" as const,
      available: portal.relationshipsAvailable,
    },
    {
      label: "Pausados pela pessoa",
      value: cockpit.counts.paused,
      icon: PauseCircle,
      tone: "attention" as const,
      href: "/pro/vinculos" as const,
      available: portal.relationshipsAvailable,
    },
    {
      label: "Convites em aberto",
      value: cockpit.counts.liveInvites,
      icon: Link2,
      tone: "identity" as const,
      href: "/pro/solicitacoes" as const,
      available: portal.invitesAvailable,
    },
    {
      label: "Solicitações de acompanhamento",
      value: cockpit.counts.pendingRequests,
      icon: Inbox,
      tone: "neutral" as const,
      href: "/pro/solicitacoes" as const,
      available: portal.relationshipsAvailable,
    },
  ];

  return (
    <>
      <PageHeader title="Dashboard" description="O que precisa da sua atenção agora." />

      {/*
        A unica ousadia da tela: o estado da verificacao em destaque. E ele que
        decide se o profissional acessa qualquer coisa.
      */}
      <Card variant="hero" className="mb-5 overflow-hidden lg:mb-6" data-cockpit-block="summary">
        <div className="grid gap-5 bg-gradient-to-br from-identity-50 via-surface to-brand-50 p-5 sm:p-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:items-center 2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1.9fr)]">
          <div className="min-w-0">
            {verification ? (
              <>
                <p className="flex items-center gap-2 text-sm font-medium text-identity-700">
                  {verified ? (
                    <ShieldCheck className="size-4" aria-hidden="true" />
                  ) : (
                    <ShieldAlert className="size-4" aria-hidden="true" />
                  )}
                  {VERIFICATION_LABEL[verification.status]}
                </p>
                <p className="mt-1 text-lg font-semibold tracking-tight text-ink">
                  CRP-{verification.councilRegion ?? "--"} {verification.registrationNumber}
                </p>
                <p className="mt-1 max-w-md text-sm text-ink-muted">
                  {verified && verification.reviewDueAt
                    ? `Conferido na fonte oficial do conselho. Válido até ${formatDate(verification.reviewDueAt)}.`
                    : VERIFICATION_DESCRIPTION[verification.status]}
                </p>
              </>
            ) : (
              <BlockError what="o estado da sua verificação" />
            )}
            {/*
              Atalhos: a acao principal do contexto e dois destinos que nao
              o owner pediu no cockpit. Fora de um card proprio: uma coluna
              de links repetindo o menu seria ruido, e deixava a lateral mais
              alta que a coluna principal.
            */}
            <nav aria-label="Atalhos" className="mt-4 flex flex-wrap gap-2" data-cockpit-block="shortcuts">
              {verified ? (
                <Button asChild size="sm">
                  <Link href="/pro/solicitacoes">
                    <Link2 aria-hidden="true" />
                    Gerar convite
                  </Link>
                </Button>
              ) : (
                <Button asChild size="sm">
                  <Link href="/pro/perfil">
                    <BadgeCheck aria-hidden="true" />
                    Ver verificação
                  </Link>
                </Button>
              )}
              <Button asChild size="sm" variant="secondary">
                <Link href="/pro/acompanhamentos">Acompanhamentos</Link>
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link href="/pro/solicitacoes">Solicitações</Link>
              </Button>
              {verified ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href="/pro/perfil">Perfil</Link>
                </Button>
              ) : null}
            </nav>
          </div>

          <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
            {numbers.map(({ label, value, icon: Icon, tone, href, available }) => (
              <li key={label} className="@container">
                <Link
                  href={href}
                  className="motion-lift flex h-full flex-col items-start gap-2 rounded-card border border-line bg-surface p-3.5 shadow-card transition-colors hover:border-brand-200 @min-[11.5rem]:flex-row @min-[11.5rem]:items-center @min-[11.5rem]:gap-3"
                >
                  <IconPill tone={tone} size="sm">
                    <Icon />
                  </IconPill>
                  <span className="min-w-0">
                    <span className="block text-xl font-semibold tabular-nums text-ink">
                      {available ? value : "—"}
                    </span>
                    <span data-word-guard className="block hyphens-auto break-words text-xs leading-4 text-ink-muted">
                      {available ? label : `${label} indisponível`}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <div
        className="grid items-start gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]"
        data-layout="columns"
      >
        <div className="flex min-w-0 flex-col gap-5 lg:gap-6" data-layout-column="main">
          <Card data-cockpit-block="attention">
            <CardContent>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-base font-semibold text-ink lg:text-lg">
                  Precisa da sua atenção
                </h2>
                {cockpit.attentionTotal > cockpit.attention.length ? (
                  <Link href="/pro/solicitacoes" className="text-sm font-medium text-brand-600 hover:underline">
                    Ver todas ({cockpit.attentionTotal})
                  </Link>
                ) : null}
              </div>
              {!portal.relationshipsAvailable || !portal.invitesAvailable ? (
                <BlockError what="parte das pendências" />
              ) : null}
              {cockpit.attention.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={<BadgeCheck />}
                  title="Nada pendente agora"
                  description="Solicitações, convites a expirar e acessos que terminam em breve aparecem aqui."
                />
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {cockpit.attention.map((item) => (
                    <li
                      key={item.key}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "size-2 shrink-0 rounded-pill",
                          item.kind === "verification" ? "bg-attention" : "bg-brand-500",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">{item.title}</p>
                        <p className="text-sm text-ink-muted">{item.detail}</p>
                      </div>
                      <Button asChild size="sm" variant="secondary">
                        <Link href={item.href}>{item.actionLabel}</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card data-cockpit-block="recent">
            <CardContent>
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <h2 className="text-base font-semibold text-ink lg:text-lg">
                  Acompanhamentos recentes
                </h2>
                {cockpit.recent.length > 0 ? (
                  <Link href="/pro/acompanhamentos" className="text-sm font-medium text-brand-600 hover:underline">
                    Ver todos
                  </Link>
                ) : null}
              </div>
              {!portal.relationshipsAvailable ? (
                <BlockError what="os acompanhamentos" />
              ) : cockpit.recent.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={<Users />}
                  title="Nenhum acompanhamento ativo"
                  description={
                    verified
                      ? "Quando uma pessoa aceitar seu convite, ela aparece aqui."
                      : "Acompanhamentos começam depois da verificação do seu registro."
                  }
                  action={
                    verified ? (
                      <Button asChild size="sm">
                        <Link href="/pro/solicitacoes">Gerar convite</Link>
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {cockpit.recent.map((relationship) => {
                    const scopes = currentScopeCount(relationship, portal.now);
                    return (
                      <li
                        key={relationship.id}
                        className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                      >
                        <PersonCell
                          className="mr-auto"
                          name={relationship.displayName}
                          caption={`${scopes === 0 ? "Nada compartilhado ainda" : scopes === 1 ? "1 escopo compartilhado" : `${scopes} escopos compartilhados`} · atualizado em ${formatDate(lastKnownChange(relationship))}`}
                        />
                        <RelationshipStatusBadge status={relationship.status} />
                        {relationship.status === "active" ? (
                          <Button asChild size="sm" variant="secondary">
                            <Link href={`/pro/acompanhamentos/${relationship.clientUserId}`}>
                              Abrir dossiê
                              <ChevronRight aria-hidden="true" />
                            </Link>
                          </Button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:gap-6" data-layout-column="side">

          <Card data-cockpit-block="activity">
            <CardContent>
              <h2 className="mb-3 text-base font-semibold text-ink lg:text-lg">
                Atividade recente
              </h2>
              {!portal.relationshipsAvailable || !portal.invitesAvailable ? (
                <BlockError what="parte da atividade" />
              ) : null}
              {cockpit.activity.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={<Activity />}
                  title="Sem atividade ainda"
                  description="Convites, vínculos e mudanças de acesso aparecem aqui."
                />
              ) : (
                <ol className="flex flex-col gap-3">
                  {cockpit.activity.map((item) => (
                    <li key={item.key} className="flex gap-3">
                      <span
                        aria-hidden="true"
                        className="mt-1.5 size-2 shrink-0 rounded-pill bg-identity-500"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink">{item.title}</p>
                        <p className="truncate text-xs text-ink-muted">
                          {item.detail} · <time dateTime={item.at}>{formatDateTime(item.at)}</time>
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
