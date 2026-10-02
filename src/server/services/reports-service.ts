import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  liveReportRequestSchema,
  reportRequestSchema,
} from "@/lib/contracts/reports";
import type { Database, Json } from "@/lib/supabase/database.types";
import { buildAnalyticsReport } from "@/lib/reports";
import { insertReportSnapshot } from "@/server/repositories/reports-repository";
import { getCycleSnapshot } from "@/server/services/cycle-service";
import { getEmotionalSnapshot } from "@/server/services/emotional-service";

type Client = SupabaseClient<Database>;

export async function buildLiveReport(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = liveReportRequestSchema.parse(rawInput);
  const [emotional, cycle] = await Promise.all([
    getEmotionalSnapshot(client, user),
    getCycleSnapshot(client, user),
  ]);
  return buildAnalyticsReport({
    referenceDate: input.referenceDate,
    days: input.days,
    timeZone: input.timeZone,
    checkins: emotional.checkins,
    sleep: emotional.sleep,
    periods: cycle.periods,
    cycleEnabled: cycle.profile.enabled,
  });
}

export async function createReportSnapshot(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  // Valida com o schema **estreito** antes de persistir: o snapshot e o unico

  // parte do contrato de la. Recusar aqui e o que torna isso impossivel por
  // construcao, em vez de por disciplina.
  reportRequestSchema.parse(rawInput);
  const report = await buildLiveReport(client, user, rawInput);
  const row = await insertReportSnapshot(client, {
    user_id: user.id,
    schema_version: report.schemaVersion,
    analytics_version: report.analyticsVersion,
    cycle_heuristic_version: report.cycleHeuristicVersion,
    time_zone: report.timeZone,
    period_start: report.window.from,
    period_end: report.window.to,
    range_days: report.dataQuality.daysInWindow,
    payload: report as unknown as Json,
  });
  return {
    id: row.id,
    createdAt: row.created_at,
    payload: report,
  };
}
