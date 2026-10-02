import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  customCycleSymptomInputSchema,
  cycleDailyRecordInputSchema,
  cyclePeriodDeleteSchema,
  cyclePeriodInputSchema,
  cycleProfileSchema,
  cycleProfileUpdateSchema,
  cycleRecordDeleteSchema,
  type CycleDailyRecord,
  type CyclePeriod,
  type CycleSnapshot,
  type CycleSymptom,
} from "@/lib/contracts/cycle";
import { cycleRecordContent } from "@/lib/offline/contracts";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  createCustomCycleSymptom,
  deleteAllCycleData,
  findCyclePeriod,
  findCycleProfile,
  findCycleRecord,
  findCycleRecordByDate,
  listCycleDailySymptoms,
  listCyclePeriods,
  listCycleRecordsBefore,
  listCycleRecords,
  listCycleSymptoms,
  persistCyclePeriod,
  persistCycleRecord,
  removeCyclePeriod,
  removeCycleRecord,
  setCycleEnabled,
} from "@/server/repositories/cycle-repository";
import {
  assertNoOfflineConflict,
  readBaseFingerprint,
} from "@/server/services/offline-sync";

type Client = SupabaseClient<Database>;


export class CycleNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CycleNotFoundError";
  }
}

export class CycleServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CycleServiceError";
  }
}

function mapPeriod(
  row: Awaited<ReturnType<typeof listCyclePeriods>>[number],
): CyclePeriod {
  return { id: row.id, startDate: row.start_date, endDate: row.end_date };
}

function mapSymptom(
  row: Awaited<ReturnType<typeof listCycleSymptoms>>[number],
): CycleSymptom {
  return {
    id: row.id,
    label: row.label,
    origin: row.origin as CycleSymptom["origin"],
    ownerId: row.owner_user_id,
  };
}

function mapRecord(
  row: Awaited<ReturnType<typeof listCycleRecords>>[number],
  symptoms: CycleDailyRecord["symptoms"],
): CycleDailyRecord {
  return {
    id: row.id,
    date: row.record_date,
    flow: row.flow as CycleDailyRecord["flow"],
    note: row.note,
    symptoms,
  };
}


export async function getCycleSnapshot(
  client: Client,
  user: User,
  options: { since?: string } = {},
): Promise<CycleSnapshot> {
  const [profileRow, periodRows, recordRows, symptomRows] = await Promise.all([
    findCycleProfile(client, user.id),
    listCyclePeriods(client, user.id),
    listCycleRecords(client, user.id, options.since),
    listCycleSymptoms(client),
  ]);
  const links = await listCycleDailySymptoms(
    client,
    recordRows.map((record) => record.id),
  );
  const symptomsByRecord = new Map<string, CycleDailyRecord["symptoms"]>();
  for (const link of links) {
    const current = symptomsByRecord.get(link.record_id) ?? [];
    current.push({
      symptomId: link.symptom_id,
      severity: link.severity as CycleDailyRecord["symptoms"][number]["severity"],
    });
    symptomsByRecord.set(link.record_id, current);
  }

  return {
    profile: {
      enabled: profileRow?.enabled ?? false,
      optedInAt: profileRow?.opted_in_at ?? null,
    },
    periods: periodRows.map(mapPeriod),
    records: recordRows.map((row) =>
      mapRecord(row, symptomsByRecord.get(row.id) ?? []),
    ),
    symptoms: symptomRows.map(mapSymptom),
  };
}

export async function changeCycleEnabled(
  client: Client,
  rawInput: unknown,
) {
  const { enabled } = cycleProfileUpdateSchema.parse(rawInput);
  const raw = await setCycleEnabled(client, enabled);
  return cycleProfileSchema.parse({
    enabled: raw.enabled,
    optedInAt: raw.opted_in_at,
  });
}

export async function saveCyclePeriod(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = cyclePeriodInputSchema.parse(rawInput);
  const id = await persistCyclePeriod(client, {
    id: input.id ?? null,
    start_date: input.startDate,
    end_date: input.endDate,
  } satisfies Json);
  const row = await findCyclePeriod(client, user.id, id);
  if (!row) throw new CycleNotFoundError("Período não encontrado.");
  return mapPeriod(row);
}

export async function deleteCyclePeriod(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const { id } = cyclePeriodDeleteSchema.parse(rawInput);
  const removed = await removeCyclePeriod(client, user.id, id);
  if (!removed) throw new CycleNotFoundError("Período não encontrado.");
  return { id: removed };
}

export async function saveCycleDailyRecord(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = cycleDailyRecordInputSchema.parse(rawInput);
  const base = readBaseFingerprint(rawInput);
  if (base !== undefined) {
    const currentRow = await findCycleRecordByDate(client, user.id, input.date);
    const currentLinks = currentRow ? await listCycleDailySymptoms(client, [currentRow.id]) : [];
    const current = currentRow
      ? mapRecord(
          currentRow,
          currentLinks.map((link) => ({
            symptomId: link.symptom_id,
            severity: link.severity as CycleDailyRecord["symptoms"][number]["severity"],
          })),
        )
      : null;
    await assertNoOfflineConflict({
      base,
      currentContent: current ? cycleRecordContent(current) : null,
      currentEntity: current,
      nextContent: cycleRecordContent(input),
    });
  }
  const id = await persistCycleRecord(client, {
    record_date: input.date,
    flow: input.flow,
    note: input.note,
    symptoms: input.symptoms.map((symptom) => ({
      symptom_id: symptom.symptomId,
      severity: symptom.severity,
    })),
  } satisfies Json);
  const [row, links, periods] = await Promise.all([
    findCycleRecord(client, user.id, id),
    listCycleDailySymptoms(client, [id]),
    listCyclePeriods(client, user.id),
  ]);
  if (!row) throw new CycleNotFoundError("Registro do ciclo não encontrado.");
  return {
    record: mapRecord(
      row,
      links.map((link) => ({
        symptomId: link.symptom_id,
        severity:
          link.severity as CycleDailyRecord["symptoms"][number]["severity"],
      })),
    ),
    periods: periods.map(mapPeriod),
  };
}

export async function deleteCycleDailyRecord(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const { date } = cycleRecordDeleteSchema.parse(rawInput);
  const removed = await removeCycleRecord(client, user.id, date);
  if (!removed) throw new CycleNotFoundError("Registro do ciclo não encontrado.");
  return { id: removed, date };
}

export async function addCustomCycleSymptom(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const { label } = customCycleSymptomInputSchema.parse(rawInput);
  return mapSymptom(await createCustomCycleSymptom(client, user.id, label));
}

export async function permanentlyDeleteCycleData(client: Client) {
  return { deleted: await deleteAllCycleData(client) };
}


export async function getOlderCycleRecords(
  client: Client,
  user: User,
  before: string,
  limit: number,
) {
  const rows = await listCycleRecordsBefore(client, user.id, before, limit);
  const links = await listCycleDailySymptoms(
    client,
    rows.map((row) => row.id),
  );
  const symptomsByRecord = new Map<string, CycleDailyRecord["symptoms"]>();
  for (const link of links) {
    const current = symptomsByRecord.get(link.record_id) ?? [];
    current.push({
      symptomId: link.symptom_id,
      severity: link.severity as CycleDailyRecord["symptoms"][number]["severity"],
    });
    symptomsByRecord.set(link.record_id, current);
  }
  return rows.map((row) => mapRecord(row, symptomsByRecord.get(row.id) ?? []));
}
