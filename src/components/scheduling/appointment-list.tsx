"use client";

import { CalendarCheck2, CalendarClock, CalendarX2, CircleCheck, UserX } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import {
  APPOINTMENT_STATUS_LABEL,
  CANCEL_REASON_LABEL,
  MODALITY_LABEL,
  type Appointment,
  type AppointmentStatus,
} from "@/lib/contracts/scheduling";
import {
  browserTimezone,
  differsFromViewer,
  formatDayHeading,
  formatTime,
  groupByLocalDay,
  timezoneLabel,
} from "@/lib/scheduling/format";

/**
 * Lista de horarios agrupada por dia (PRO-6).
 *
 * A hora abre cada linha, em numerais tabulares e com o fuso por extenso: e o
 * fato que a pessoa procura. Estado sempre com texto e icone, nunca so cor.
 */

const STATUS_TONE: Record<AppointmentStatus, "brand" | "positive" | "neutral" | "attention"> = {
  requested: "brand",
  confirmed: "positive",
  cancelled: "neutral",
  completed: "neutral",
  no_show: "attention",
};

const STATUS_ICON: Record<AppointmentStatus, ReactNode> = {
  requested: <CalendarClock aria-hidden="true" className="size-3.5" />,
  confirmed: <CalendarCheck2 aria-hidden="true" className="size-3.5" />,
  cancelled: <CalendarX2 aria-hidden="true" className="size-3.5" />,
  completed: <CircleCheck aria-hidden="true" className="size-3.5" />,
  no_show: <UserX aria-hidden="true" className="size-3.5" />,
};

export function AppointmentStatusBadge({
  status,
  lapsed = false,
}: {
  status: AppointmentStatus;
  /** Pedido cujo horario passou sem resposta: o banco nao muda o estado, a tela diz o fato. */
  lapsed?: boolean;
}) {
  if (lapsed && status === "requested") {
    return (
      <Badge tone="neutral" data-appointment-status="requested-lapsed">
        {STATUS_ICON.cancelled}
        Passou sem resposta
      </Badge>
    );
  }
  return (
    <Badge tone={STATUS_TONE[status]} data-appointment-status={status}>
      {STATUS_ICON[status]}
      {APPOINTMENT_STATUS_LABEL[status]}
    </Badge>
  );
}

const noSubscription = () => () => {};

/** Fuso do navegador so depois da hidratacao (o servidor nao sabe: `null`). */
export function useViewerTimezone() {
  return useSyncExternalStore(noSubscription, browserTimezone, () => null);
}

export function describeCancellation(appointment: Appointment): string | null {
  if (appointment.status !== "cancelled") return null;
  const reason = appointment.cancelReason ? CANCEL_REASON_LABEL[appointment.cancelReason] : null;
  const who =
    appointment.cancelReason === "relationship_ended"
      ? "Cancelado porque o acompanhamento terminou"
      : appointment.cancelledByMe
        ? "Cancelado por você"
        : "Cancelado pela outra pessoa";
  return reason && appointment.cancelReason !== "relationship_ended" ? `${who} · ${reason}` : who;
}

export function AppointmentList({
  appointments,
  counterpartFallback,
  renderActions,
  testId,
  now,
}: {
  now?: string;
  appointments: Appointment[];
  counterpartFallback: string;
  renderActions?: (appointment: Appointment) => ReactNode;
  testId?: string;
}) {
  const viewer = useViewerTimezone();
  const groups = groupByLocalDay(appointments);
  return (
    <div className="flex flex-col gap-5" data-testid={testId}>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.heading}>
          <h3 className="mb-2 text-sm font-semibold text-ink">{group.heading}</h3>
          <ul className="flex flex-col divide-y divide-line">
            {group.items.map((appointment) => {
              const actions = renderActions?.(appointment);
              const cancellation = describeCancellation(appointment);
              return (
                <li
                  key={appointment.id}
                  className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto]"
                  data-appointment-id={appointment.id}
                >
                  <div>
                    <p className="text-lg font-semibold tabular-nums leading-6 text-ink">
                      {formatTime(appointment.startsAt, appointment.timezone)}
                    </p>
                    <p className="text-xs leading-4 text-ink-muted">
                      até {formatTime(appointment.endsAt, appointment.timezone)}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {appointment.counterpartName ?? counterpartFallback}
                    </p>
                    <p className="text-sm text-ink-muted">
                      {MODALITY_LABEL[appointment.modality]} · {timezoneLabel(appointment.timezone)}
                    </p>
                    {differsFromViewer(appointment.startsAt, appointment.timezone, viewer) ? (
                      <p className="text-xs text-ink-muted">
                        No seu fuso: {formatDayHeading(appointment.startsAt, viewer ?? appointment.timezone)},{" "}
                        {formatTime(appointment.startsAt, viewer ?? appointment.timezone)}
                      </p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <AppointmentStatusBadge
                        status={appointment.status}
                        lapsed={now ? new Date(appointment.startsAt) <= new Date(now) : false}
                      />
                      {cancellation ? (
                        <span className="text-xs text-ink-muted">{cancellation}</span>
                      ) : null}
                    </div>
                  </div>
                  {actions ? (
                    <div className="col-span-2 flex flex-wrap items-start gap-2 sm:col-span-1 sm:justify-end">
                      {actions}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
