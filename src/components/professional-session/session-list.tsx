import { Video } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/journey/page-header";
import { BlockError } from "@/components/professional/portal-bits";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProfessionalSessionSummary } from "@/lib/contracts/professional-sessions";
import { MODALITY_LABEL } from "@/lib/contracts/scheduling";
import { formatDayHeading, formatTime, timezoneLabel } from "@/lib/scheduling/format";
import { ProSessionsNav } from "./pro-sessions-nav";
import { SessionStatusBadge } from "./session-room";

/** Lista de sessoes do profissional: abertas agora, proximas e recentes. */
export function SessionListView({
  now,
  sessions,
  basePath,
}: {
  now: string;
  sessions: ProfessionalSessionSummary[] | null;
  basePath: "/pro/sessoes";
}) {
  const open = (sessions ?? []).filter((item) => item.status === "ready" || item.status === "active");
  const upcoming = (sessions ?? []).filter((item) => item.status === "scheduled");
  const past = (sessions ?? [])
    .filter((item) => !open.includes(item) && !upcoming.includes(item))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  return (
    <>
      <PageHeader
        title="Sessões"
        description="Cada horário confirmado vira uma sessão. A entrada abre 10 minutos antes; a chamada não é gravada e o que a pessoa registrar depende das permissões dela."
      />
      <ProSessionsNav current="proximas" />
      {sessions === null ? (
        <BlockError what="as sessões" />
      ) : sessions.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<Video />}
              title="Nenhuma sessão ainda"
              description="Sessões nascem quando você confirma um horário na Agenda."
              action={
                <Button asChild variant="secondary">
                  <Link href="/pro/agenda">Abrir agenda</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid items-start gap-5 lg:gap-6 xl:grid-cols-2" data-layout="columns" data-now={now}>
          <Section title="Abertas agora" empty="Nenhuma sessão com a entrada aberta agora." items={open} basePath={basePath} />
          <Section title="Próximas" empty="Nenhuma sessão agendada." items={upcoming} basePath={basePath} />
          <div id="historico" className="scroll-mt-24 xl:col-span-2">
            <Section title="Histórico" empty="Nenhuma sessão encerrada ainda." items={past} basePath={basePath} />
          </div>
        </div>
      )}
    </>
  );
}

function Section({
  title,
  empty,
  items,
  basePath,
}: {
  title: string;
  empty: string;
  items: ProfessionalSessionSummary[];
  basePath: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{title}</CardTitle>
        {items.length === 0 ? <CardDescription>{empty}</CardDescription> : null}
      </CardHeader>
      {items.length > 0 ? (
        <CardContent>
          <ul className="flex flex-col divide-y divide-line">
            {items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="w-[4.5rem] shrink-0">
                  <p className="text-lg font-semibold tabular-nums leading-6 text-ink">{formatTime(item.startsAt, item.timezone)}</p>
                  <p className="text-xs text-ink-muted">até {formatTime(item.endsAt, item.timezone)}</p>
                </div>
                <div className="mr-auto min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{item.counterpartName ?? "Pessoa acompanhada"}</p>
                  <p className="text-sm text-ink-muted">
                    {formatDayHeading(item.startsAt, item.timezone)} · {MODALITY_LABEL[item.modality]} · {timezoneLabel(item.timezone)}
                  </p>
                  <div className="mt-1.5">
                    <SessionStatusBadge status={item.status} />
                  </div>
                </div>
                <Button asChild size="sm" variant={item.status === "ready" || item.status === "active" ? "primary" : "secondary"}>
                  <Link href={`${basePath}/${item.id}` as Route}>Abrir sessão</Link>
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  );
}
