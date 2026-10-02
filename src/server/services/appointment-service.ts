import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  appointmentActionSchema,
  appointmentRequestSchema,
  appointmentSchema,
  availabilityConflictSchema,
  availabilityExceptionInputSchema,
  availabilityExceptionSchema,
  availabilityInputSchema,
  schedulingProfessionalSchema,
  slotSchema,
  slotsQuerySchema,
  availabilityWeekQuerySchema,
  availabilityWeekInputSchema,
  availabilityWeekSchema,
  weekSlotsQuerySchema,
  weekSlotsSchema,
  type Appointment,
  type Availability,
  type AvailabilityExceptions,
  type AvailabilityRule,
  type SchedulingProfessional,
  type Slot,
} from "@/lib/contracts/scheduling";
import type { Database } from "@/lib/supabase/database.types";
import {
  cancelAppointment,
  closeAppointment,
  confirmAppointment,
  deleteAvailabilityException,
  directoryHasAvailability,
  listMyAppointments,
  listMyAvailabilityConflicts,
  listMySchedulingProfessionals,
  listOpenSlots,
  myActiveConnectionForDirectorySlug,
  readOwnAvailability,
  readOwnAvailabilityExceptions,
  requestAppointment,
  saveAvailability,
  saveAvailabilityException,
  readAvailabilityWeek,
  saveAvailabilityWeek,
  readWeekSlots,
} from "@/server/repositories/scheduling-repository";
import { closeMediaForAction } from "@/server/services/realtime-session-service";

type Client = SupabaseClient<Database>;

export async function getOwnAvailabilityWeek(client: Client, raw: unknown) {
  const query = availabilityWeekQuerySchema.parse(raw);
  return availabilityWeekSchema.parse(await readAvailabilityWeek(client, query.weekStart, query.timezone));
}
export async function updateOwnAvailabilityWeek(client: Client, raw: unknown) {
  const input = availabilityWeekInputSchema.parse(raw);
  return availabilityWeekSchema.parse(await saveAvailabilityWeek(client, input));
}
export async function getWeekSlots(client: Client, raw: unknown) {
  const query = weekSlotsQuerySchema.parse(raw);
  return weekSlotsSchema.parse(await readWeekSlots(client, query.professionalUserId, query.weekStart));
}

/**
 * Agenda com profissional (PRO-6) e excecoes da agenda (UX F6).
 *
 * UI -> rota -> este servico -> repositorio -> RPC. O servico valida forma
 * (Zod) e traduz linhas; conflito, grade, janela e transicao sao do banco,
 * dentro da mesma operacao que escreve. Nada aqui faz SELECT-then-INSERT.
 */

export async function getOwnAvailability(client: Client, userId: string): Promise<Availability> {
  const rows = await readOwnAvailability(client, userId);
  return {
    // Todas as regras compartilham o fuso (a RPC grava um so por chamada).
    timezone: rows[0]?.timezone ?? null,
    rules: rows.map(
      (row): AvailabilityRule => ({
        weekday: row.weekday,
        startMinute: row.start_minute,
        endMinute: row.end_minute,
        slotMinutes: row.slot_minutes as AvailabilityRule["slotMinutes"],
        modality: row.modality as AvailabilityRule["modality"],
      }),
    ),
  };
}

export async function updateOwnAvailability(client: Client, userId: string, raw: unknown) {
  const input = availabilityInputSchema.parse(raw);
  await saveAvailability(client, input);
  return getOwnAvailability(client, userId);
}

/**
 * Excecoes vigentes (terminam hoje ou depois) e conflitos com horarios ja
 * marcados. `today` e a data UTC menos um dia: o banco guarda datas locais do
 * fuso da agenda, e a margem evita esconder a excecao de hoje a oeste de UTC.
 */
export async function getOwnAvailabilityExceptions(
  client: Client,
  userId: string,
  now: Date = new Date(),
): Promise<AvailabilityExceptions> {
  const fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [rows, conflicts] = await Promise.all([
    readOwnAvailabilityExceptions(client, userId, fromDate),
    listMyAvailabilityConflicts(client),
  ]);
  return {
    exceptions: rows.map((row) =>
      availabilityExceptionSchema.parse({
        id: row.id,
        kind: row.kind,
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        startMinute: row.start_minute ?? null,
        endMinute: row.end_minute ?? null,
        slotMinutes: row.slot_minutes ?? null,
        modality: row.modality ?? null,
        timezone: row.timezone,
      }),
    ),
    conflicts: conflicts.map((row) =>
      availabilityConflictSchema.parse({
        exceptionId: row.exception_id,
        appointmentId: row.appointment_id,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        status: row.status,
      }),
    ),
  };
}

export async function createOwnAvailabilityException(client: Client, userId: string, raw: unknown) {
  const input = availabilityExceptionInputSchema.parse(raw);
  const id = await saveAvailabilityException(client, input);
  return { id, ...(await getOwnAvailabilityExceptions(client, userId)) };
}

export async function removeOwnAvailabilityException(client: Client, userId: string, id: string) {
  await deleteAvailabilityException(client, id);
  return getOwnAvailabilityExceptions(client, userId);
}

export async function getOpenSlots(client: Client, raw: unknown): Promise<Slot[]> {
  const query = slotsQuerySchema.parse(raw);
  const rows = await listOpenSlots(client, query.professionalUserId, query.from, query.to);
  return rows.map((row) =>
    slotSchema.parse({
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      modality: row.modality,
      timezone: row.timezone,
    }),
  );
}

export async function createAppointmentRequest(client: Client, raw: unknown) {
  const input = appointmentRequestSchema.parse(raw);
  const id = await requestAppointment(client, input);
  return { id };
}

export async function applyAppointmentAction(client: Client, id: string, raw: unknown) {
  const action = appointmentActionSchema.parse(raw);
  if (action.action === "confirm") await confirmAppointment(client, id);
  else if (action.action === "cancel") {
    await cancelAppointment(client, id, action.reason);
    await closeMediaForAction(client, { appointmentId: id });
  }
  else await closeAppointment(client, id, action.outcome);
  return { id, action: action.action };
}

export async function getMyAppointments(
  client: Client,
  since: string | null = null,
): Promise<Appointment[]> {
  const rows = await listMyAppointments(client, since);
  return rows.map((row) =>
    appointmentSchema.parse({
      id: row.id,
      connectionId: row.connection_id,
      role: row.role,
      counterpartUserId: row.counterpart_user_id,
      counterpartName: row.counterpart_name ?? null,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timezone: row.timezone,
      modality: row.modality,
      status: row.status,
      requestedAt: row.requested_at,
      confirmedAt: row.confirmed_at ?? null,
      cancelledAt: row.cancelled_at ?? null,
      cancelledByMe: row.cancelled_by_me ?? null,
      cancelReason: row.cancel_reason ?? null,
    }),
  );
}

export async function getMySchedulingProfessionals(
  client: Client,
): Promise<SchedulingProfessional[]> {
  const rows = await listMySchedulingProfessionals(client);
  return rows.map((row) =>
    schedulingProfessionalSchema.parse({
      connectionId: row.connection_id,
      professionalUserId: row.professional_user_id,
      professionalName: row.professional_name ?? null,
      hasAvailability: row.has_availability === true,
    }),
  );
}

/**
 * Agenda no perfil publico (PRO-5 + PRO-6): o fato "tem horarios" e, so com
 * vinculo ativo, o id do vinculo para o CTA. Sem vinculo, nenhum CTA morto.
 */
export async function getDirectoryScheduling(client: Client, slug: string) {
  const [hasAvailability, connectionId] = await Promise.all([
    directoryHasAvailability(client, slug),
    myActiveConnectionForDirectorySlug(client, slug),
  ]);
  return { hasAvailability, connectionId };
}
