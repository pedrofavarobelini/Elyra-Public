import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  SESSION_CONSENTS,
  professionalSessionDetailSchema,
  professionalSessionSummarySchema,
  sessionActionSchema,
  sessionConsentUpdateSchema,
  type ProfessionalSessionDetail,
  type ProfessionalSessionSummary,
  type SessionConsent,
} from "@/lib/contracts/professional-sessions";
import type { Database } from "@/lib/supabase/database.types";
import {
  SessionRuleError,
  completeSession,
  enterSession,
  getSession,
  leaveSession,
  listMySessions,
  readTranscriptAsProfessional,
  setConsent,
} from "@/server/repositories/professional-session-repository";
import { closeSessionMediaAfterAction } from "@/server/services/realtime-session-service";

type Client = SupabaseClient<Database>;

const idSchema = z.string().uuid("Sessão inválida.");

/**
 * Sessoes profissionais (PRO-7): UI -> rota -> este servico -> repositorio ->
 * RPC. O servico nunca decide acesso; ele traduz linhas e resultados.
 */

export async function getMySessions(client: Client): Promise<ProfessionalSessionSummary[]> {
  const rows = await listMySessions(client, null);
  return rows.map((row) =>
    professionalSessionSummarySchema.parse({
      id: row.id,
      appointmentId: row.appointment_id,
      role: row.role,
      counterpartName: row.counterpart_name ?? null,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timezone: row.timezone,
      modality: row.modality,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      status: row.status,
    }),
  );
}

export async function getSessionDetail(client: Client, rawId: string): Promise<ProfessionalSessionDetail | null> {
  const id = idSchema.parse(rawId);
  const row = await getSession(client, id);
  if (!row) return null;
  const consents = Object.fromEntries(
    SESSION_CONSENTS.map((consent) => [consent, row[consent] === true]),
  ) as Record<SessionConsent, boolean>;
  return professionalSessionDetailSchema.parse({
    id: row.id,
    appointmentId: row.appointment_id,
    role: row.role,
    counterpartName: row.counterpart_name ?? null,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    timezone: row.timezone,
    modality: row.modality,
    opensAt: row.opens_at,
    closesAt: row.closes_at,
    status: row.status,
    consents,
    mePresent: row.me_present === true,
    meEnteredCount: row.me_entered_count ?? 0,
    otherPresent: row.other_present === true,
    otherEnteredCount: row.other_entered_count ?? 0,
    captureCount: row.capture_count ?? 0,
    transcriptAvailable: row.transcript_available === true,
  });
}

export async function applySessionAction(client: Client, rawId: string, raw: unknown) {
  const id = idSchema.parse(rawId);
  const action = sessionActionSchema.parse(raw);
  if (action.action === "enter") {
    const outcome = await enterSession(client, id);
    if (outcome !== "entered") {
      throw new SessionRuleError(
        outcome === "credential_invalid" || outcome === "session_closed" || outcome === "not_found"
          ? outcome
          : "credential_invalid",
      );
    }
  } else if (action.action === "leave") {
    await leaveSession(client, id);
  } else {
    await completeSession(client, id);
    // PRO-7R: a midia cai junto, sem esperar o heartbeat do outro lado.
    await closeSessionMediaAfterAction(client, id);
  }
  return { id, action: action.action };
}

export async function updateSessionConsent(client: Client, rawId: string, raw: unknown) {
  const id = idSchema.parse(rawId);
  const input = sessionConsentUpdateSchema.parse(raw);
  await setConsent(client, id, input.consent, input.value);
  return getSessionDetail(client, id);
}

export async function getTranscriptForProfessional(client: Client, rawId: string) {
  const id = idSchema.parse(rawId);
  const row = await readTranscriptAsProfessional(client, id);
  if (!row) return null;
  return {
    outcome: row.outcome as "ok" | "not_allowed" | "not_available",
    content: row.content ?? null,
    wordCount: row.word_count ?? null,
    transcribedAt: row.transcribed_at ?? null,
  };
}
