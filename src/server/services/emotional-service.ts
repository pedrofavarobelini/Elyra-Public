import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  customFactorInputSchema,
  emotionalCheckinCreateSchema,
  emotionalCheckinUpdateSchema,
  sleepRecordInputSchema,
  type EmotionalCheckin,
  type EmotionalFactor,
  type EmotionalSnapshot,
  type PrimaryFeeling,
  type SleepRecord,
} from "@/lib/contracts/emotional";
import { sleepContent } from "@/lib/offline/contracts";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  createCheckin,
  createCustomFactor,
  findSleepByNight,
  listCheckinFactorLinks,
  listCheckinsBefore,
  listSleepBefore,
  listCheckins,
  listFactors,
  listSleep,
  updateCheckin,
  upsertSleep,
} from "@/server/repositories/emotional-repository";
import { appendAudit } from "@/server/repositories/identity-repository";
import {
  assertNoOfflineConflict,
  readBaseFingerprint,
  withoutSyncKeys,
} from "@/server/services/offline-sync";

type Client = SupabaseClient<Database>;

export class EmotionalServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmotionalServiceError";
  }
}

function mapCheckin(
  row: Awaited<ReturnType<typeof listCheckins>>[number],
  factorIds: string[],
): EmotionalCheckin {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    mood: row.mood_score,
    perceivedAnxiety: row.perceived_anxiety_score,
    energy: row.energy_score,
    primaryFeeling: row.primary_feeling as PrimaryFeeling | null,
    factorIds,
    note: row.note,
  };
}

function mapFactor(
  row: Awaited<ReturnType<typeof listFactors>>[number],
): EmotionalFactor {
  return {
    id: row.id,
    label: row.label,
    origin: row.origin as EmotionalFactor["origin"],
    ownerId: row.owner_user_id,
  };
}

function mapSleep(row: Awaited<ReturnType<typeof listSleep>>[number]): SleepRecord {
  return {
    id: row.id,
    night: row.night,
    durationMinutes: row.duration_minutes,
    quality: row.sleep_quality_score,
  };
}


export async function getEmotionalSnapshot(
  client: Client,
  user: User,
  options: { since?: string } = {},
): Promise<EmotionalSnapshot> {
  const [checkinRows, factorRows, sleepRows] = await Promise.all([
    listCheckins(client, user.id, options.since),
    listFactors(client),
    listSleep(client, user.id, options.since),
  ]);
  const links = await listCheckinFactorLinks(
    client,
    checkinRows.map((row) => row.id),
  );
  const factorIdsByCheckin = new Map<string, string[]>();
  for (const link of links) {
    const ids = factorIdsByCheckin.get(link.checkin_id) ?? [];
    ids.push(link.factor_id);
    factorIdsByCheckin.set(link.checkin_id, ids);
  }

  return {
    checkins: checkinRows.map((row) =>
      mapCheckin(row, factorIdsByCheckin.get(row.id) ?? []),
    ),
    factors: factorRows.map(mapFactor),
    sleep: sleepRows.map(mapSleep),
  };
}

export async function addEmotionalCheckin(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = emotionalCheckinCreateSchema.parse(rawInput);

  const occurredAt = input.occurredAt ?? null;
  if (occurredAt && new Date(occurredAt).getTime() > Date.now()) {
    throw new EmotionalServiceError("O check-in não pode estar no futuro.");
  }

  const payload: Json = {
    id: input.id ?? null,
    occurred_at: occurredAt,
    mood_score: input.mood,
    perceived_anxiety_score: input.perceivedAnxiety,
    energy_score: input.energy,
    primary_feeling: input.primaryFeeling,
    note: input.note,
    factor_ids: input.factorIds,
  };
  const created = await createCheckin(client, payload);
  return {
    id: created.id,
    occurredAt: created.occurredAt,
    mood: input.mood,
    perceivedAnxiety: input.perceivedAnxiety,
    energy: input.energy,
    primaryFeeling: input.primaryFeeling,
    factorIds: input.factorIds,
    note: input.note,
  } satisfies EmotionalCheckin;
}

/**
 * Corrige ou completa um check-in que ja existe.
 *
 * **Propriedade.** Nao ha checagem de dono aqui: a RPC roda com
 * `security invoker` e a policy `emotional_checkins_update_own` decide. Repetir
 * a regra em TypeScript criaria um segundo lugar para ela divergir - e o
 * TypeScript nao e a fronteira de seguranca.
 *
 * **Data futura.** Rejeitada aqui para dar mensagem legivel, e tambem barrada
 * pelo trigger `emotional_checkins_reject_future`, que cobre `insert` **e**
 * `update`. As duas camadas existem de proposito: a de cima explica, a de baixo
 * garante.
 *
 * **Auditoria.** Editar um registro passado muda o que o historico diz sobre um
 * dia que ja passou, e isso deixa rastro. O `correlationId` e um uuid puro - a
 * licao de `L-068`, em que um identificador de contrato textual foi enviado
 * para uma coluna `uuid` e a auditoria falhou em silencio por dois meses.
 *
 * A falha de auditoria nao derruba a correcao da pessoa, mas tambem nao passa
 * calada: o erro do Postgres agora e registrado pela camada de repositorio.
 */
export async function editEmotionalCheckin(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = emotionalCheckinUpdateSchema.parse(rawInput);
  if (input.occurredAt && new Date(input.occurredAt).getTime() > Date.now()) {
    throw new EmotionalServiceError("O check-in não pode estar no futuro.");
  }

  const payload: Json = {
    id: input.id,
    occurred_at: input.occurredAt ?? null,
    mood_score: input.mood,
    perceived_anxiety_score: input.perceivedAnxiety,
    energy_score: input.energy,
    primary_feeling: input.primaryFeeling,
    note: input.note,
    factor_ids: input.factorIds,
  };
  const updated = await updateCheckin(client, payload);

  try {
    await appendAudit(client, {
      actorUserId: user.id,
      action: "emotional_checkin.updated",
      entityType: "emotional_checkin",
      entityId: updated.id,
      correlationId: crypto.randomUUID(),
    });
  } catch {
    // Auditoria e best-effort: nao desfaz a correcao que a pessoa acabou de
    // fazer. O erro real ja foi registrado no repositorio.
  }

  return {
    id: updated.id,
    occurredAt: updated.occurredAt,
    mood: input.mood,
    perceivedAnxiety: input.perceivedAnxiety,
    energy: input.energy,
    primaryFeeling: input.primaryFeeling,
    factorIds: input.factorIds,
    note: input.note,
  } satisfies EmotionalCheckin;
}

export async function addCustomEmotionalFactor(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = customFactorInputSchema.parse(rawInput);
  return mapFactor(await createCustomFactor(client, user.id, input.label));
}

export async function saveSleepRecord(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = sleepRecordInputSchema.parse(withoutSyncKeys(rawInput));
  const base = readBaseFingerprint(rawInput);
  if (base !== undefined) {
    const current = await findSleepByNight(client, user.id, input.night);
    await assertNoOfflineConflict({
      base,
      currentContent: current
        ? sleepContent({ durationMinutes: current.duration_minutes, quality: current.sleep_quality_score })
        : null,
      currentEntity: current ? mapSleep(current) : null,
      nextContent: sleepContent(input),
    });
  }
  return mapSleep(
    await upsertSleep(client, {
      user_id: user.id,
      night: input.night,
      duration_minutes: input.durationMinutes,
      sleep_quality_score: input.quality,
    }),
  );
}


export async function getOlderCheckins(
  client: Client,
  user: User,
  before: string,
  limit: number,
) {
  const rows = await listCheckinsBefore(client, user.id, before, limit);
  const links = await listCheckinFactorLinks(
    client,
    rows.map((row) => row.id),
  );
  const factorIdsByCheckin = new Map<string, string[]>();
  for (const link of links) {
    const ids = factorIdsByCheckin.get(link.checkin_id) ?? [];
    ids.push(link.factor_id);
    factorIdsByCheckin.set(link.checkin_id, ids);
  }
  return rows.map((row) => mapCheckin(row, factorIdsByCheckin.get(row.id) ?? []));
}

export async function getOlderSleep(
  client: Client,
  user: User,
  before: string,
  limit: number,
) {
  return (await listSleepBefore(client, user.id, before, limit)).map(mapSleep);
}
