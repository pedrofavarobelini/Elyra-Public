"use client";

import { CalendarOff, CalendarPlus, Trash2, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";

import { schedulingFetch } from "@/components/scheduling/api";
import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  APPOINTMENT_STATUS_LABEL,
  MODALITIES,
  MODALITY_LABEL,
  SLOT_MINUTES,
  availabilityExceptionInputSchema,
  type Appointment,
  type AvailabilityException,
  type AvailabilityExceptionKind,
  type AvailabilityExceptions,
} from "@/lib/contracts/scheduling";
import { clockToMinutes, formatDayHeading, formatTime } from "@/lib/scheduling/format";
import { addDaysToKey, describeException } from "./agenda-dates";

const FIELD =
  "flex min-h-11 w-full min-w-0 rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-60 lg:min-h-10";

/**
 * Excecoes da agenda (UX F6): abrir uma data, bloquear um dia ou um periodo.
 * Bloquear nunca cancela horario marcado (D-UX-5): o conflito aparece aqui e a
 * decisao — manter ou cancelar com motivo — e sempre explicita.
 */
export function AvailabilityExceptionsEditor({
  initial,
  timezone,
  todayKey,
  verified,
  appointments,
  onChanged,
  onCancelAppointment,
}: {
  initial: AvailabilityExceptions;
  timezone: string;
  /** Hoje (AAAA-MM-DD) no fuso da agenda. */
  todayKey: string;
  verified: boolean;
  appointments: Appointment[];
  onChanged: () => void;
  onCancelAppointment: (appointment: Appointment) => void;
}) {
  const baseId = useId();
  const [data, setData] = useState(initial);
  const [kind, setKind] = useState<AvailabilityExceptionKind>("block");
  const [startsOn, setStartsOn] = useState(addDaysToKey(todayKey, 1));
  const [endsOn, setEndsOn] = useState(addDaysToKey(todayKey, 1));
  const [wholeDay, setWholeDay] = useState(true);
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("12:00");
  const [slotMinutes, setSlotMinutes] = useState(60);
  const [modality, setModality] = useState<string>("online");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const disabled = !verified || busy !== null;
  const byId = new Map(appointments.map((item) => [item.id, item]));
  const conflictsByException = new Map<string, number>();
  for (const conflict of data.conflicts) {
    conflictsByException.set(conflict.exceptionId, (conflictsByException.get(conflict.exceptionId) ?? 0) + 1);
  }
  const conflictAppointments = [...new Set(data.conflicts.map((item) => item.appointmentId))];

  function draft() {
    const timed = kind === "open" || !wholeDay;
    return availabilityExceptionInputSchema.safeParse({
      timezone,
      kind,
      startsOn,
      endsOn: endsOn || startsOn,
      startMinute: timed ? (clockToMinutes(start) ?? -1) : null,
      endMinute: timed ? (clockToMinutes(end, { isEnd: true }) ?? -1) : null,
      slotMinutes: kind === "open" ? slotMinutes : null,
      modality: kind === "open" ? modality : null,
    });
  }

  async function save() {
    const parsed = draft();
    if (!parsed.success) {
      setMessage({ kind: "error", text: parsed.error.issues[0]?.message ?? "Revise a exceção." });
      return;
    }
    setBusy("save");
    setMessage(null);
    try {
      const saved = await schedulingFetch<AvailabilityExceptions & { id: string }>(
        "/api/scheduling/availability/exceptions",
        { method: "POST", body: JSON.stringify(parsed.data) },
      );
      setData({ exceptions: saved.exceptions, conflicts: saved.conflicts });
      const conflicts = saved.conflicts.filter((item) => item.exceptionId === saved.id).length;
      setMessage({
        kind: "ok",
        text:
          kind === "open"
            ? "Abertura salva. Os novos horários já aparecem para quem você acompanha."
            : conflicts > 0
              ? `Bloqueio salvo. ${conflicts} horário(s) marcado(s) caem nele e continuam valendo até você decidir.`
              : "Bloqueio salvo. Ninguém consegue pedir horário nesse período.",
      });
      onChanged();
    } catch (caught) {
      setMessage({ kind: "error", text: caught instanceof Error ? caught.message : "Não foi possível salvar." });
    } finally {
      setBusy(null);
    }
  }

  async function remove(item: AvailabilityException) {
    setBusy(item.id);
    setMessage(null);
    try {
      const next = await schedulingFetch<AvailabilityExceptions>(
        `/api/scheduling/availability/exceptions/${item.id}`,
        { method: "DELETE" },
      );
      setData(next);
      setMessage({ kind: "ok", text: "Exceção removida. A agenda volta a seguir a semana recorrente nessas datas." });
      onChanged();
    } catch (caught) {
      setMessage({ kind: "error", text: caught instanceof Error ? caught.message : "Não foi possível remover." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card data-testid="availability-exceptions">
      <CardHeader>
        <CardTitle as="h2">Exceções</CardTitle>
        <CardDescription>
          Abra horários numa data fora da semana recorrente ou bloqueie um dia, uma faixa ou um período
          (férias). Bloquear não cancela horários já marcados.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {conflictAppointments.length > 0 ? (
          <section
            aria-labelledby={`${baseId}-conflicts`}
            className="rounded-control border border-attention/40 bg-attention-soft p-3.5"
            data-testid="availability-conflicts"
          >
            <h3 id={`${baseId}-conflicts`} className="flex items-center gap-2 text-sm font-semibold text-ink">
              <TriangleAlert aria-hidden="true" className="size-4 text-attention" />
              {conflictAppointments.length === 1
                ? "1 horário marcado cai num bloqueio"
                : `${conflictAppointments.length} horários marcados caem num bloqueio`}
            </h3>
            <p className="mt-1 text-sm text-ink-muted">
              Nada foi cancelado. Mantenha o horário ou cancele com motivo; a pessoa é avisada só se você cancelar.
            </p>
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {conflictAppointments.map((id) => {
                const conflict = data.conflicts.find((item) => item.appointmentId === id)!;
                const appointment = byId.get(id);
                return (
                  <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5 first:pt-0 last:pb-0">
                    <p className="mr-auto min-w-0 text-sm text-ink">
                      <span className="font-medium tabular-nums">
                        {formatDayHeading(conflict.startsAt, timezone)}, {formatTime(conflict.startsAt, timezone)}
                      </span>{" "}
                      · {appointment?.counterpartName ?? "Pessoa acompanhada"} · {APPOINTMENT_STATUS_LABEL[conflict.status]}
                    </p>
                    {appointment ? (
                      <Button size="sm" variant="secondary" disabled={!verified} onClick={() => onCancelAppointment(appointment)}>
                        Cancelar horário…
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {data.exceptions.length === 0 ? (
          <EmptyState
            size="compact"
            icon={<CalendarOff />}
            title="Nenhuma exceção"
            description="A agenda segue só a semana recorrente."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-line" aria-label="Exceções da agenda">
            {data.exceptions.map((item) => {
              const conflicts = conflictsByException.get(item.id) ?? 0;
              const label = describeException(item);
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0" data-exception-kind={item.kind}>
                  <Badge tone={item.kind === "open" ? "positive" : "neutral"}>
                    {item.kind === "open" ? "Abertura" : "Bloqueio"}
                  </Badge>
                  <p className="mr-auto min-w-0 text-sm text-ink">{label}</p>
                  {conflicts > 0 ? <Badge tone="attention">{conflicts} em conflito</Badge> : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => void remove(item)}
                    aria-label={`Remover ${item.kind === "open" ? "abertura" : "bloqueio"}: ${label}`}
                  >
                    <Trash2 aria-hidden="true" />
                    Remover
                  </Button>
                </li>
              );
            })}
          </ul>
        )}

        <fieldset className="flex flex-col gap-3 rounded-control border border-line p-3.5" disabled={disabled}>
          <legend className="px-1 text-sm font-semibold text-ink">Nova exceção</legend>
          <div role="radiogroup" aria-label="Tipo de exceção" className="flex w-fit gap-1 rounded-control bg-surface-muted p-1">
            {(
              [
                ["block", "Bloquear"],
                ["open", "Abrir horários"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={kind === value}
                onClick={() => {
                  setKind(value);
                  setMessage(null);
                  if (value === "open") setEndsOn(startsOn);
                }}
                className={
                  kind === value
                    ? "inline-flex min-h-11 items-center rounded-[0.625rem] bg-surface px-3.5 text-sm font-medium text-brand-700 shadow-card lg:min-h-10"
                    : "inline-flex min-h-11 items-center rounded-[0.625rem] px-3.5 text-sm font-medium text-ink-muted hover:text-ink lg:min-h-10"
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label htmlFor={`${baseId}-from`}>De</Label>
              <input
                id={`${baseId}-from`}
                type="date"
                min={todayKey}
                value={startsOn}
                onChange={(event) => {
                  setStartsOn(event.target.value);
                  if (!endsOn || endsOn < event.target.value) setEndsOn(event.target.value);
                  setMessage(null);
                }}
                className={`mt-1 ${FIELD}`}
              />
            </div>
            <div>
              <Label htmlFor={`${baseId}-to`}>Até</Label>
              <input
                id={`${baseId}-to`}
                type="date"
                min={startsOn || todayKey}
                value={endsOn}
                onChange={(event) => {
                  setEndsOn(event.target.value);
                  setMessage(null);
                }}
                className={`mt-1 ${FIELD}`}
              />
            </div>
            {kind === "block" ? (
              <label className="col-span-2 flex min-h-11 items-center gap-2 self-end text-sm text-ink lg:min-h-10">
                <input
                  type="checkbox"
                  checked={wholeDay}
                  onChange={(event) => setWholeDay(event.target.checked)}
                  className="size-4 accent-brand-600"
                />
                Dia inteiro
              </label>
            ) : null}
          </div>
          {kind === "open" || !wholeDay ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <Label htmlFor={`${baseId}-start`}>Início</Label>
                <input
                  id={`${baseId}-start`}
                  type="time"
                  step={300}
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  className={`mt-1 ${FIELD}`}
                />
              </div>
              <div>
                <Label htmlFor={`${baseId}-end`}>Fim</Label>
                <input
                  id={`${baseId}-end`}
                  type="time"
                  step={300}
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  className={`mt-1 ${FIELD}`}
                />
              </div>
              {kind === "open" ? (
                <>
                  <div>
                    <Label htmlFor={`${baseId}-slot`}>Duração</Label>
                    <select
                      id={`${baseId}-slot`}
                      value={slotMinutes}
                      onChange={(event) => setSlotMinutes(Number(event.target.value))}
                      className={`mt-1 ${FIELD}`}
                    >
                      {SLOT_MINUTES.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} min
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`${baseId}-mode`}>Modalidade</Label>
                    <select
                      id={`${baseId}-mode`}
                      value={modality}
                      onChange={(event) => setModality(event.target.value)}
                      className={`mt-1 ${FIELD}`}
                    >
                      {MODALITIES.map((value) => (
                        <option key={value} value={value}>
                          {MODALITY_LABEL[value]}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}
          <p className="text-xs text-ink-muted">
            {kind === "open"
              ? `Aberturas valem até 60 dias à frente e não podem cruzar um intervalo semanal do mesmo dia. Horário no fuso da agenda (${timezone.replace(/_/g, " ")}).`
              : "Bloqueios valem até 1 ano à frente, para qualquer duração e modalidade. Quem já tem horário marcado não é avisado."}
          </p>
          <div>
            <Button onClick={() => void save()} disabled={disabled}>
              {kind === "open" ? <CalendarPlus aria-hidden="true" /> : <CalendarOff aria-hidden="true" />}
              {busy === "save" ? "Salvando…" : kind === "open" ? "Salvar abertura" : "Salvar bloqueio"}
            </Button>
          </div>
        </fieldset>
        <div aria-live="polite">
          {message ? (
            <p
              role={message.kind === "error" ? "alert" : "status"}
              className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-positive"}
            >
              {message.text}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
