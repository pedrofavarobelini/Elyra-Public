"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CANCEL_REASON_LABEL,
  CLIENT_CANCEL_REASONS,
  PROFESSIONAL_CANCEL_REASONS,
  type Appointment,
  type CancelReason,
} from "@/lib/contracts/scheduling";
import { formatDayHeading, formatTime } from "@/lib/scheduling/format";

/**
 * Cancelar com motivo de vocabulario fechado. Sem campo de texto: motivo livre
 * viraria dado clinico guardado numa agenda. Recusar um pedido e a acao
 * "Recusar" do profissional, e nao passa por aqui.
 */
export function CancelAppointmentDialog({
  appointment,
  role,
  busy,
  onCancel,
  onClose,
}: {
  appointment: Appointment | null;
  role: "client" | "professional";
  busy: boolean;
  onCancel: (appointment: Appointment, reason: CancelReason) => void;
  onClose: () => void;
}) {
  const reasons: readonly CancelReason[] =
    role === "professional" ? PROFESSIONAL_CANCEL_REASONS : CLIENT_CANCEL_REASONS;
  const [reason, setReason] = useState<CancelReason>(reasons[0] ?? "other");

  return (
    <Dialog open={appointment !== null} onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent>
        {appointment ? (
          <>
            <DialogHeader>
              <DialogTitle>Cancelar horário</DialogTitle>
              <DialogDescription>
                {formatDayHeading(appointment.startsAt, appointment.timezone)}, às{" "}
                {formatTime(appointment.startsAt, appointment.timezone)}. A outra pessoa é avisada; o
                horário fica no histórico como cancelado. Ele só volta a ser oferecido se houver
                disponibilidade publicada e nenhum bloqueio.
              </DialogDescription>
            </DialogHeader>
            <fieldset className="mt-4 flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium text-ink">Motivo</legend>
              {reasons.map((option) => (
                <label
                  key={option}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control border border-line px-3 text-sm text-ink has-[:checked]:border-brand-400 has-[:checked]:bg-surface-brand lg:min-h-10"
                >
                  <input
                    type="radio"
                    name="cancel-reason"
                    value={option}
                    checked={reason === option}
                    onChange={() => setReason(option)}
                    className="size-4 accent-[var(--color-brand-600)]"
                  />
                  {CANCEL_REASON_LABEL[option]}
                </label>
              ))}
            </fieldset>
            <DialogFooter className="mt-5">
              <Button variant="secondary" onClick={onClose} disabled={busy}>
                Manter horário
              </Button>
              <Button variant="destructive" onClick={() => onCancel(appointment, reason)} disabled={busy}>
                Cancelar horário
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
