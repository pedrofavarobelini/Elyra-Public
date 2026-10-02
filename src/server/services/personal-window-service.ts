import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

import {
  EMPTY_OLDER_COUNTS,
  HISTORY_DOMAIN,
  HISTORY_PAGE_SIZE,
  PERSONAL_WINDOW_DAYS,
  personalWindowStart,
  type HistoryDomain,
  type PersonalWindowInfo,
} from "@/lib/contracts/personal-window";
import type { Database } from "@/lib/supabase/database.types";
import {
  countCheckinsBefore,
  countSleepBefore,
} from "@/server/repositories/emotional-repository";
import { countJournalEntriesBefore } from "@/server/repositories/journal-repository";
import { countCycleRecordsBefore } from "@/server/repositories/cycle-repository";
import {
  countGoalProgressBefore,
  listGoals,
} from "@/server/repositories/goals-repository";
import { getOlderCycleRecords } from "@/server/services/cycle-service";
import {
  getOlderCheckins,
  getOlderSleep,
} from "@/server/services/emotional-service";
import { getOlderGoalProgress } from "@/server/services/goals-service";
import { getOlderJournalEntries } from "@/server/services/journal-service";

type Client = SupabaseClient<Database>;


export async function getPersonalWindow(
  client: Client,
  user: User,
  now: Date = new Date(),
): Promise<PersonalWindowInfo> {
  const since = personalWindowStart(now);
  const goals = await listGoals(client, user.id);
  const [checkins, journal, sleep, cycleRecords, goalProgress] = await Promise.all([
    countCheckinsBefore(client, user.id, since),
    countJournalEntriesBefore(client, user.id, since),
    countSleepBefore(client, user.id, since),
    countCycleRecordsBefore(client, user.id, since),
    countGoalProgressBefore(client, goals.map((goal) => goal.id), since),
  ]);
  const olderCounts = { ...EMPTY_OLDER_COUNTS, checkins, journal, sleep, cycle_records: cycleRecords, goal_progress: goalProgress };
  return {
    days: PERSONAL_WINDOW_DAYS,
    since,
    hasOlder: Object.values(olderCounts).some((count) => count > 0),
    olderCounts,
  };
}

export const historyRequestSchema = z.object({
  domain: z.enum([
    HISTORY_DOMAIN.CHECKINS,
    HISTORY_DOMAIN.JOURNAL,
    HISTORY_DOMAIN.SLEEP,
    HISTORY_DOMAIN.CYCLE_RECORDS,
    HISTORY_DOMAIN.GOAL_PROGRESS,
  ]),
  /** Cursor: traz o que e anterior a este instante/data. */
  before: z.string().min(4).max(40),
  limit: z.number().int().min(1).max(HISTORY_PAGE_SIZE).optional(),
});

export class PersonalHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PersonalHistoryError";
  }
}

export interface PersonalHistoryPage {
  domain: HistoryDomain;
  /** Proximo cursor, ou `null` quando a pagina esgotou o dominio. */
  nextBefore: string | null;
  items: unknown[];
}

/** Uma pagina de historia anterior ao cursor, do mais recente para o mais antigo. */
export async function getPersonalHistory(
  client: Client,
  user: User,
  rawInput: unknown,
): Promise<PersonalHistoryPage> {
  const input = historyRequestSchema.parse(rawInput);
  const limit = input.limit ?? HISTORY_PAGE_SIZE;

  switch (input.domain) {
    case HISTORY_DOMAIN.CHECKINS: {
      const items = await getOlderCheckins(client, user, input.before, limit);
      return page(input.domain, items, limit, items.at(-1)?.occurredAt ?? null);
    }
    case HISTORY_DOMAIN.JOURNAL: {
      const items = await getOlderJournalEntries(client, user, input.before, limit);
      return page(input.domain, items, limit, items.at(-1)?.updatedAt ?? null);
    }
    case HISTORY_DOMAIN.SLEEP: {
      const items = await getOlderSleep(client, user, input.before, limit);
      return page(input.domain, items, limit, items.at(-1)?.night ?? null);
    }
    case HISTORY_DOMAIN.CYCLE_RECORDS: {
      const items = await getOlderCycleRecords(client, user, input.before, limit);
      return page(input.domain, items, limit, items.at(-1)?.date ?? null);
    }
    case HISTORY_DOMAIN.GOAL_PROGRESS: {
      const items = await getOlderGoalProgress(client, user, input.before, limit);
      return page(input.domain, items, limit, items.at(-1)?.day ?? null);
    }
    default: {
      throw new PersonalHistoryError("Domínio de histórico inválido.");
    }
  }
}

function page(
  domain: HistoryDomain,
  items: unknown[],
  limit: number,
  lastCursor: string | null,
): PersonalHistoryPage {
  // Pagina cheia significa "provavelmente ha mais"; pagina curta encerra o dominio.
  return { domain, items, nextBefore: items.length === limit ? lastCursor : null };
}
