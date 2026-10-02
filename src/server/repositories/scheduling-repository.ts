import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isSchedulingErrorCode,
  type AvailabilityExceptionInput,
  type AvailabilityInput,
  type AvailabilityWeekInput,
  type SchedulingErrorCode,
} from "@/lib/contracts/scheduling";
import type { Database } from "@/lib/supabase/database.types";

import { normalizarCausa, registrarFalhaDeRepositorio } from "./repository-error";

type Client = SupabaseClient<Database>;

export async function readAvailabilityWeek(client: Client, weekStart: string, timezone: string) {
  const { data, error } = await client.rpc("get_professional_availability_week", { p_week_start: weekStart, p_timezone: timezone });
  if (error) fail("read_availability_week", error);
  return data;
}
export async function saveAvailabilityWeek(client: Client, input: AvailabilityWeekInput) {
  const { data, error } = await client.rpc("save_professional_week_availability", {
    p_week_start: input.weekStart, p_timezone: input.timezone, p_expected_revision: input.revision,
    p_intervals: input.intervals.map((item) => ({ date: item.date, start_minute: item.startMinute, end_minute: item.endMinute, slot_minutes: item.slotMinutes, modality: item.modality })),
    p_blocks: input.blocks.map((item) => ({ date: item.date, start_minute: item.startMinute, end_minute: item.endMinute })),
  });
  if (error) fail("save_availability_week", error);
  return data;
}
export async function readWeekSlots(client: Client, professionalUserId: string, weekStart: string) {
  const { data, error } = await client.rpc("list_professional_week_slots", { p_professional_user_id: professionalUserId, p_week_start: weekStart });
  if (error) fail("list_week_slots", error);
  return data;
}

/**
 * Agenda (PRO-6). Toda escrita passa por RPC `SECURITY DEFINER`: a tabela nao
 * tem politica de escrita, entao nao ha `update` arbitrario de status a partir
 * daqui nem de lugar nenhum.
 */

/** Recusa de regra do banco (conflito, janela, transicao). Esperada: nao loga. */
export class SchedulingRuleError extends Error {
  constructor(public readonly code: SchedulingErrorCode) {
    super(code);
    this.name = "SchedulingRuleError";
  }
}

/** Falha inesperada. Loga `code`/`message`/`hint`, nunca `details`. */
export class SchedulingRepositoryError extends Error {
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de agenda: ${operation}.`);
    this.name = "SchedulingRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("agenda", operation, normalizada);
  }
}

function fail(operation: string, error: { code?: string; message?: string }): never {
  if (isSchedulingErrorCode(error.message)) throw new SchedulingRuleError(error.message);
  throw new SchedulingRepositoryError(operation, error);
}

export async function readOwnAvailability(client: Client, userId: string) {
  const { data, error } = await client
    .from("professional_availability_rules")
    .select("weekday,start_minute,end_minute,slot_minutes,timezone,modality")
    .eq("professional_user_id", userId)
    .order("weekday")
    .order("start_minute");
  if (error) fail("read_availability", error);
  return data ?? [];
}

export async function saveAvailability(client: Client, input: AvailabilityInput) {
  const { data, error } = await client.rpc("save_professional_availability", {
    p_timezone: input.timezone,
    p_rules: input.rules.map((rule) => ({
      weekday: rule.weekday,
      start_minute: rule.startMinute,
      end_minute: rule.endMinute,
      slot_minutes: rule.slotMinutes,
      modality: rule.modality,
    })),
  });
  if (error) fail("save_availability", error);
  return data;
}

export async function readOwnAvailabilityExceptions(client: Client, userId: string, fromDate: string) {
  const { data, error } = await client
    .from("professional_availability_exceptions")
    .select("id,kind,starts_on,ends_on,start_minute,end_minute,slot_minutes,modality,timezone")
    .eq("professional_user_id", userId)
    .gte("ends_on", fromDate)
    .order("starts_on")
    .order("start_minute", { nullsFirst: true });
  if (error) fail("read_availability_exceptions", error);
  return data ?? [];
}

export async function saveAvailabilityException(client: Client, input: AvailabilityExceptionInput) {
  const { data, error } = await client.rpc("save_professional_availability_exception", {
    p_timezone: input.timezone,
    p_exception: {
      kind: input.kind,
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      start_minute: input.startMinute,
      end_minute: input.endMinute,
      slot_minutes: input.slotMinutes,
      modality: input.modality,
    },
  });
  if (error) fail("save_availability_exception", error);
  return data as string;
}

export async function deleteAvailabilityException(client: Client, id: string) {
  const { error } = await client.rpc("delete_professional_availability_exception", { p_exception_id: id });
  if (error) fail("delete_availability_exception", error);
}

export async function listMyAvailabilityConflicts(client: Client) {
  const { data, error } = await client.rpc("list_my_availability_conflicts");
  if (error) fail("list_availability_conflicts", error);
  return data ?? [];
}

export async function listOpenSlots(
  client: Client,
  professionalUserId: string,
  from: string,
  to: string,
) {
  const { data, error } = await client.rpc("list_professional_open_slots", {
    p_professional_user_id: professionalUserId,
    p_from: from,
    p_to: to,
  });
  if (error) fail("list_open_slots", error);
  return data ?? [];
}

export async function requestAppointment(
  client: Client,
  input: { connectionId: string; startsAt: string; modality: string; idempotencyKey: string },
) {
  const { data, error } = await client.rpc("request_appointment", {
    p_connection_id: input.connectionId,
    p_starts_at: input.startsAt,
    p_modality: input.modality,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) fail("request_appointment", error);
  return data as string;
}

export async function confirmAppointment(client: Client, id: string) {
  const { error } = await client.rpc("confirm_appointment", { p_appointment_id: id });
  if (error) fail("confirm_appointment", error);
}

export async function cancelAppointment(client: Client, id: string, reason: string) {
  const { error } = await client.rpc("cancel_appointment", {
    p_appointment_id: id,
    p_reason: reason,
  });
  if (error) fail("cancel_appointment", error);
}

export async function closeAppointment(client: Client, id: string, outcome: string) {
  const { error } = await client.rpc("close_appointment", {
    p_appointment_id: id,
    p_outcome: outcome,
  });
  if (error) fail("close_appointment", error);
}

export async function listMyAppointments(client: Client, since: string | null) {
  // `null` e aceito pela RPC (padrao: ultimos 30 dias); o tipo gerado nao sabe disso.
  const { data, error } = await client.rpc("list_my_appointments", {
    p_since: since as string,
  });
  if (error) fail("list_my_appointments", error);
  return data ?? [];
}

export async function listMySchedulingProfessionals(client: Client) {
  const { data, error } = await client.rpc("list_my_scheduling_professionals");
  if (error) fail("list_scheduling_professionals", error);
  return data ?? [];
}

export async function directoryHasAvailability(client: Client, slug: string) {
  const { data, error } = await client.rpc("professional_directory_has_availability", {
    p_slug: slug,
  });
  if (error) fail("directory_has_availability", error);
  return data === true;
}

export async function myActiveConnectionForDirectorySlug(client: Client, slug: string) {
  const { data, error } = await client.rpc("my_active_connection_for_directory_slug", {
    p_slug: slug,
  });
  if (error) fail("directory_connection", error);
  return (data as string | null) ?? null;
}
