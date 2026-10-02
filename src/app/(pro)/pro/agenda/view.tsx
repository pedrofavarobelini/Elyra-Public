"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { PageHeader } from "@/components/journey/page-header";
import { BlockError } from "@/components/professional/portal-bits";
import { ProSessionsNav } from "@/components/professional-session/pro-sessions-nav";
import { RequiresConnection } from "@/components/offline/requires-connection";
import { schedulingFetch } from "@/components/scheduling/api";
import { AppointmentList } from "@/components/scheduling/appointment-list";
import { CancelAppointmentDialog } from "@/components/scheduling/cancel-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SCHEDULING_LEAD_COPY, MODALITY_LABEL, type Appointment, type AppointmentAction, type AvailabilityWeek } from "@/lib/contracts/scheduling";
import { addCivilDays, civilDateLabel, civilWeekLabel, civilWeekStart } from "@/lib/scheduling/calendar";
import { formatTime, localDayKey, minutesToClock, timezoneLabel } from "@/lib/scheduling/format";
import { WeeklyAvailabilityEditor } from "./weekly-availability-editor";

export function ProAgendaView({ now, hasProfile, verified, initialWeek, appointments, sessionByAppointment }: {
  now: string; hasProfile: boolean; verified: boolean; initialWeek: AvailabilityWeek | null;
  appointments: Appointment[] | null; sessionByAppointment: Record<string, string>;
}) {
  const router = useRouter(); const id = useId();
  const [week, setWeek] = useState(initialWeek);
  const [tab, setTab] = useState(initialWeek?.published ? "agenda" : "disponibilidade");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [destination, setDestination] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Appointment | null>(null);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string } | null>(null);
  const navigationBusy = loading || publishing || busyId !== null;
  const timezone = week?.timezone ?? "America/Sao_Paulo";
  const today = localDayKey(now, timezone);
  const weekStart = week?.weekStart ?? civilWeekStart(today);
  const days = Array.from({ length: 7 }, (_, i) => addCivilDays(weekStart, i));
  const list = appointments ?? [];
  const active = list.filter((item) => (item.status === "requested" || item.status === "confirmed") && days.includes(localDayKey(item.startsAt, item.timezone)));
  const history = list.filter((item) => item.status !== "requested" && item.status !== "confirmed");
  useEffect(() => {
    if (!dirty) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [dirty]);

  async function loadWeek(date: string) {
    setLoading(true); setFeedback(null);
    try {
      const params = new URLSearchParams({ week: date, timezone });
      const result = await schedulingFetch<AvailabilityWeek>("/api/scheduling/availability/week?" + params);
      setWeek(result); setEditorEpoch((value) => value + 1); setDirty(false); setDestination(null);
    } catch (caught) { setFeedback({ error: true, text: caught instanceof Error ? caught.message : "Não foi possível carregar a semana." }); }
    finally { setLoading(false); }
  }
  function navigate(date: string) { if (dirty) setDestination(date); else void loadWeek(date); }
  async function act(item: Appointment, action: AppointmentAction, text: string) {
    setBusyId(item.id); setFeedback(null);
    try {
      await schedulingFetch("/api/scheduling/appointments/" + item.id, { method: "PATCH", body: JSON.stringify(action) });
      setCancelling(null); if (!dirty) await loadWeek(weekStart); setFeedback({ error: false, text }); router.refresh();
    } catch (caught) { setFeedback({ error: true, text: caught instanceof Error ? caught.message : "Não foi possível concluir." }); }
    finally { setBusyId(null); }
  }
  function actions(item: Appointment) {
    const started = new Date(item.startsAt).getTime() <= new Date(now).getTime();
    return <RequiresConnection><div className="flex flex-wrap gap-2">
      {item.status === "requested" ? <>
        <Button size="sm" disabled={!verified || busyId !== null || publishing} onClick={() => void act(item, { action: "confirm" }, "Horário confirmado. A pessoa foi avisada.")}>Confirmar</Button>
        <Button size="sm" variant="secondary" disabled={busyId !== null || publishing} onClick={() => void act(item, { action: "cancel", reason: "declined" }, "Pedido recusado.")}>Recusar</Button>
      </> : <>
        {sessionByAppointment[item.id] ? <Button asChild size="sm"><Link href={`/pro/sessoes/${sessionByAppointment[item.id]}`}>Abrir sessão</Link></Button> : null}
        {started ? <>
          <Button size="sm" variant="secondary" disabled={busyId !== null || publishing} onClick={() => void act(item, { action: "close", outcome: "completed" }, "Registrado como realizado.")}>Realizado</Button>
          <Button size="sm" variant="ghost" disabled={busyId !== null || publishing} onClick={() => void act(item, { action: "close", outcome: "no_show" }, "Registrado como não compareceu.")}>Não compareceu</Button>
        </> : <Button size="sm" variant="secondary" disabled={busyId !== null || publishing} onClick={() => setCancelling(item)}>Cancelar atendimento…</Button>}
      </>}
    </div></RequiresConnection>;
  }
  if (!hasProfile) return <><PageHeader title="Agenda" /><p>Cadastre seu registro para abrir horários.</p><Button asChild><Link href="/area-profissional/cadastro">Cadastrar registro</Link></Button></>;
  return <>
    <PageHeader title="Agenda" description="Publique quando você atende e acompanhe os pedidos da semana." />
    <ProSessionsNav current="agenda" />
    <div className="mb-4 flex min-w-0 flex-col gap-3 rounded-control border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="secondary" aria-label="Semana anterior" disabled={navigationBusy} onClick={() => navigate(addCivilDays(weekStart, -7))}>‹</Button>
        <p className="min-w-0 text-center text-sm font-semibold text-ink" aria-live="polite" data-testid="week-heading">{civilWeekLabel(weekStart)}</p>
        <Button size="sm" variant="secondary" aria-label="Próxima semana" disabled={navigationBusy || addCivilDays(weekStart, 7) > addCivilDays(today, 60)} onClick={() => navigate(addCivilDays(weekStart, 7))}>›</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <Button size="sm" variant="ghost" disabled={navigationBusy} onClick={() => navigate(civilWeekStart(today))}>Hoje</Button>
        <div className="min-w-0"><Label htmlFor={id + "-date"}>Ir para uma data</Label><input id={id + "-date"} type="date" max={addCivilDays(today, 60)} className="block min-h-11 min-w-0 rounded-control border border-line bg-surface px-2 text-sm" disabled={navigationBusy} value={weekStart} onChange={(e) => { if (e.target.value) navigate(civilWeekStart(e.target.value)); }} /></div>
        <p className="text-xs text-ink-muted">{timezoneLabel(timezone)} · {dirty ? "Alterada / não salva" : week?.published ? "Publicada" : "Não publicada"}{loading ? " · Carregando…" : ""}</p>
      </div>
    </div>
    {feedback ? <p role={feedback.error ? "alert" : "status"} className={"mb-4 rounded-control p-3 text-sm " + (feedback.error ? "bg-destructive-soft text-destructive" : "bg-positive-soft text-positive")}>{feedback.text}</p> : null}
    {week === null ? <><BlockError what="a disponibilidade da semana" /><Button variant="secondary" onClick={() => void loadWeek(weekStart)}>Tentar de novo</Button></> : <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label="Agenda"><TabsTrigger value="agenda">Agenda</TabsTrigger><TabsTrigger value="disponibilidade">Disponibilidade</TabsTrigger></TabsList>
      <TabsContent value="agenda">
        <p className="mb-4 text-xs leading-5 text-ink-muted" data-testid="agenda-lead">{SCHEDULING_LEAD_COPY}</p>
        {appointments === null ? <BlockError what="os atendimentos" /> : <div className="flex flex-col gap-4" data-testid="agenda-week">
          {days.map((date) => <Card key={date}><CardHeader><CardTitle as="h2" className="capitalize">{civilDateLabel(date)}</CardTitle></CardHeader><CardContent>
            <AppointmentList appointments={active.filter((item) => localDayKey(item.startsAt, item.timezone) === date)} counterpartFallback="Pessoa acompanhada" renderActions={actions} testId="agenda-day-appointments" />
            <ul className="mt-2 flex flex-wrap gap-2">{week.slots.filter((slot) => localDayKey(slot.startsAt, slot.timezone) === date).map((slot) => <li key={slot.startsAt + "-" + slot.modality} className="rounded-control bg-surface-muted px-3 py-2 text-sm">Livre · {formatTime(slot.startsAt, slot.timezone)} · {MODALITY_LABEL[slot.modality]}</li>)}</ul>
            {week.blocks.filter((block) => block.date === date).map((block, i) => <p key={i} className="mt-2 text-sm text-ink-muted">Bloqueado · {block.startMinute === null ? "Dia inteiro" : minutesToClock(block.startMinute) + "–" + minutesToClock(block.endMinute!)}</p>)}
            {!active.some((item) => localDayKey(item.startsAt, item.timezone) === date) && !week.slots.some((slot) => localDayKey(slot.startsAt, slot.timezone) === date) ? <p className="text-sm text-ink-muted">Sem horários livres.</p> : null}
          </CardContent></Card>)}
        </div>}
        {history.length ? <Disclosure summary={"Histórico recente (" + history.length + ")"} tone="boxed"><AppointmentList appointments={history} counterpartFallback="Pessoa acompanhada" testId="agenda-history" now={now} /></Disclosure> : null}
      </TabsContent>
      <TabsContent value="disponibilidade" forceMount className="data-[state=inactive]:hidden">
        <div aria-live="polite" className="mb-3 rounded-control border border-line p-3 text-sm" data-testid="availability-conflicts">
          {week.conflicts.length ? <>
            <p>Há {week.conflicts.filter((item) => item.status === "confirmed").length} horário(s) confirmado(s) e {week.conflicts.filter((item) => item.status === "requested").length} pedido(s) neste período fora da disponibilidade. O bloqueio ou a remoção não cancela esses atendimentos.</p>
            {week.conflicts.map((conflict) => { const item = list.find((a) => a.id === conflict.appointmentId); return <div key={conflict.appointmentId} className="mt-2 flex flex-wrap items-center gap-2">
              <span>{civilDateLabel(localDayKey(conflict.startsAt, timezone))} · {formatTime(conflict.startsAt, timezone)} · {conflict.status === "confirmed" ? "Confirmado" : "Pedido"}</span>
              <Button size="sm" variant="secondary" onClick={() => setTab("agenda")}>Ver atendimento</Button>
              {item ? <Button size="sm" variant="ghost" onClick={() => setCancelling(item)}>Cancelar atendimento…</Button> : null}
            </div>; })}
          </> : <p>Remover disponibilidade deixa de oferecer vagas. Atendimentos existentes são preservados e têm cancelamento separado.</p>}
        </div>
        <WeeklyAvailabilityEditor key={week.weekStart + "-" + week.revision + "-" + editorEpoch} initial={week} now={now} verified={verified} externalBusy={loading || busyId !== null} onBusy={setPublishing} onDirty={setDirty} onSaved={(result) => { setWeek(result); setEditorEpoch((value) => value + 1); setDirty(false); setFeedback({ error: false, text: "Disponibilidade da semana salva." }); router.refresh(); }} />
      </TabsContent>
    </Tabs>}
    <Dialog open={destination !== null} onOpenChange={(open) => { if (!open) setDestination(null); }}><DialogContent><DialogHeader><DialogTitle>Alterações não salvas</DialogTitle><DialogDescription>Esta semana tem alterações não salvas. Você pode continuar editando ou descartá-las para mudar de semana.</DialogDescription></DialogHeader><DialogFooter><Button variant="secondary" onClick={() => setDestination(null)}>Continuar editando</Button><Button disabled={loading} onClick={() => { if (destination) void loadWeek(destination); }}>Descartar e mudar de semana</Button></DialogFooter></DialogContent></Dialog>
    <CancelAppointmentDialog appointment={cancelling} role="professional" busy={busyId !== null || publishing} onClose={() => setCancelling(null)} onCancel={(item, reason) => void act(item, { action: "cancel", reason: reason as "unavailable" | "schedule_change" | "other" }, "Horário cancelado. A pessoa foi avisada.")} />
  </>;
}
