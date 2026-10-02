"use client";

import { BriefcaseBusiness, CalendarDays, MessageSquareText, ShieldCheck, UserRoundSearch } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/journey/page-header";
import { schedulingFetch } from "@/components/scheduling/api";
import { AppointmentList } from "@/components/scheduling/appointment-list";
import { CancelAppointmentDialog } from "@/components/scheduling/cancel-dialog";
import { EmptyState, ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { Appointment, CancelReason, SchedulingProfessional } from "@/lib/contracts/scheduling";
import { RequestPanel } from "./request-panel";

export function PersonAgendaView({
  now,
  professionals,
  appointments,
  hasProfessionalRole,
  preselectedConnectionId,
  sessionByAppointment,
}: {
  /** PRO-7: sessao nascida de cada horario confirmado. */
  sessionByAppointment: Record<string, string>;
  now: string;
  professionals: SchedulingProfessional[] | null;
  appointments: Appointment[] | null;
  hasProfessionalRole: boolean;
  preselectedConnectionId: string | null;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const nowMs = new Date(now).getTime();
  const list = appointments ?? [];
  const upcoming = list.filter(
    (item) =>
      (item.status === "requested" || item.status === "confirmed") &&
      new Date(item.endsAt).getTime() > nowMs,
  );
  const history = list
    .filter((item) => !upcoming.includes(item))
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  // Aba inicial pelo contexto: link com vinculo ou nada marcado → Agendar.
  const [tab, setTab] = useState<"proximas" | "agendar" | "historico">(
    preselectedConnectionId || (upcoming.length === 0 && (professionals?.length ?? 0) > 0) ? "agendar" : "proximas",
  );
  const [schedulingFor, setSchedulingFor] = useState<string | null>(preselectedConnectionId);

  async function cancel(item: Appointment, reason: CancelReason) {
    setBusyId(item.id);
    setFeedback(null);
    try {
      await schedulingFetch(`/api/scheduling/appointments/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel", reason }),
      });
      setCancelling(null);
      setFeedback({ kind: "ok", text: "Horário cancelado. O profissional foi avisado." });
      router.refresh();
    } catch (caught) {
      setFeedback({ kind: "error", text: caught instanceof Error ? caught.message : "Não foi possível cancelar." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/sessoes" className="text-brand-700 underline-offset-4 hover:underline">
            Sessões
          </Link>
        }
        title="Sessão com profissional"
        description="Chamadas e horários com quem já acompanha você. Só vocês dois veem estes horários; a chamada não é gravada."
      />

      {hasProfessionalRole ? (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <BriefcaseBusiness aria-hidden="true" className="size-4" />
          Os horários em que você atende ficam na agenda profissional.
          <Link href="/pro/agenda" className="font-medium text-brand-700 underline-offset-4 hover:underline">
            Abrir agenda profissional
          </Link>
        </p>
      ) : null}

      <section aria-labelledby="agenda-professionals-title" className="mb-5 lg:mb-6" data-testid="agenda-professionals">
        <h2 id="agenda-professionals-title" className="mb-2 text-sm font-medium text-ink-muted">
          Seus profissionais
        </h2>
        {professionals === null ? (
          <ErrorState title="Não foi possível carregar seus profissionais" description="Recarregue a página em instantes." />
        ) : professionals.length === 0 ? (
          <EmptyState
            size="compact"
            icon={<UserRoundSearch />}
            title="Você ainda não tem acompanhamento"
            description="Para marcar uma sessão, primeiro conecte-se a um profissional. Conectar-se não compartilha nenhum dado."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button asChild size="sm">
                  <Link href="/profissionais">Encontrar profissional</Link>
                </Button>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/convite?returnTo=%2Fagenda">Tenho um código de convite</Link>
                </Button>
              </div>
            }
          />
        ) : (

          <ul className={cn("grid gap-3", professionals.length > 1 && "md:grid-cols-2 2xl:grid-cols-3")}>
            {professionals.map((pro) => (
              <li
                key={pro.connectionId}
                className={cn(
                  "flex flex-col gap-3 rounded-card border border-line bg-surface p-4",
                  professionals.length === 1 && "md:flex-row md:items-center md:justify-between",
                )}
                data-testid="agenda-professional"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 font-medium text-ink">{pro.professionalName ?? "Profissional"}</p>
                  <Badge tone={pro.hasAvailability ? "positive" : "neutral"}>
                    {pro.hasAvailability ? "Com horários abertos" : "Sem horários abertos"}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      setSchedulingFor(pro.connectionId);
                      setTab("agendar");
                    }}
                  >
                    Pedir horário
                  </Button>
                  <Button asChild size="sm" variant="secondary">
                    <Link href="/pedidos">
                      <MessageSquareText aria-hidden="true" />
                      Recado
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link href="/configuracoes/privacidade#cfg-profissional">
                      <ShieldCheck aria-hidden="true" />
                      Compartilhamento
                    </Link>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div aria-live="polite" className="mb-4 empty:hidden">
        {feedback ? (
          <p
            role={feedback.kind === "error" ? "alert" : "status"}
            className={
              feedback.kind === "error"
                ? "rounded-control bg-destructive-soft px-3 py-2 text-sm text-destructive"
                : "rounded-control bg-positive-soft px-3 py-2 text-sm text-positive"
            }
          >
            {feedback.text}
          </p>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
        <TabsList aria-label="Sessão com profissional">
          <TabsTrigger value="proximas">
            Próximas{upcoming.length ? <Badge tone="brand">{upcoming.length}</Badge> : null}
          </TabsTrigger>
          <TabsTrigger value="agendar">Agendar</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="proximas">
          <Card data-testid="agenda-mine">
            <CardHeader>
              <CardTitle as="h2">Próximas sessões</CardTitle>
              <CardDescription>
                Pedidos de horário aguardando resposta e horários confirmados. A entrada da sessão abre perto do horário.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {appointments === null ? (
                <ErrorState title="Não foi possível carregar seus horários" description="Recarregue a página em instantes." />
              ) : upcoming.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={<CalendarDays />}
                  title="Nenhum horário marcado"
                  description="Quando você pedir um horário, ele aparece aqui até acontecer."
                  action={
                    professionals?.length ? (
                      <Button size="sm" variant="secondary" onClick={() => setTab("agendar")}>
                        Pedir um horário
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <AppointmentList
                  appointments={upcoming}
                  counterpartFallback="Profissional"
                  renderActions={(item) => (
                    <>
                      {item.status === "confirmed" && sessionByAppointment[item.id] ? (
                        <Button asChild size="sm">
                          <Link href={`/agenda/sessao/${sessionByAppointment[item.id]}`}>Abrir sessão</Link>
                        </Button>
                      ) : null}
                      {new Date(item.startsAt).getTime() > nowMs ? (
                        <Button size="sm" variant="secondary" disabled={busyId === item.id} onClick={() => setCancelling(item)}>
                          Cancelar
                        </Button>
                      ) : null}
                    </>
                  )}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agendar">
          {professionals === null ? (
            <ErrorState title="Não foi possível carregar seus profissionais" description="Recarregue a página em instantes." />
          ) : (
            <RequestPanel
              key={schedulingFor ?? "default"}
              now={now}
              professionals={professionals}
              preselectedConnectionId={schedulingFor}
              onRequested={(text) => {
                setFeedback({ kind: "ok", text });
                setTab("proximas");
                router.refresh();
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="historico">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Histórico</CardTitle>
              <CardDescription>
                Horários que já aconteceram ou foram cancelados. O que você registrou durante uma sessão fica nas suas{" "}
                <Link href="/sessoes#particular" className="font-medium text-brand-700 underline-offset-4 hover:underline">
                  sessões particulares
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-ink-muted">Nada por aqui ainda.</p>
              ) : (
                <AppointmentList appointments={history} counterpartFallback="Profissional" testId="agenda-history" now={now} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <CancelAppointmentDialog
        appointment={cancelling}
        role="client"
        busy={busyId !== null}
        onClose={() => setCancelling(null)}
        onCancel={(item, reason) => void cancel(item, reason)}
      />
    </>
  );
}
