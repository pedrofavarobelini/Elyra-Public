import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  customJournalTagInputSchema,
  journalEntryActionSchema,
  journalEntryDeleteSchema,
  journalSaveInputSchema,
  type JournalEntry,
  type JournalSnapshot,
  type JournalTag,
} from "@/lib/contracts/journal";
import { journalContent } from "@/lib/offline/contracts";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  createCustomJournalTag,
  deleteJournalEntry,
  findJournalEntry,
  listJournalEntriesBefore,
  listJournalEntries,
  listJournalEntryTagLinks,
  listJournalTags,
  persistJournalEntry,
  purgeExpiredJournal,
  setJournalTrashState,
} from "@/server/repositories/journal-repository";
import {
  OfflineConflictError,
  assertNoOfflineConflict,
  readBaseFingerprint,
} from "@/server/services/offline-sync";

type Client = SupabaseClient<Database>;

export class JournalServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalServiceError";
  }
}


export class JournalEntryNotFoundError extends Error {
  constructor() {
    super("Anotação não encontrada.");
    this.name = "JournalEntryNotFoundError";
  }
}

function mapEntry(
  row: Awaited<ReturnType<typeof listJournalEntries>>[number],
  tagIds: string[],
): JournalEntry {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    status: row.status as JournalEntry["status"],
    tagIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    trashedAt: row.trashed_at,
  };
}

function mapTag(
  row: Awaited<ReturnType<typeof listJournalTags>>[number],
): JournalTag {
  return {
    id: row.id,
    label: row.label,
    origin: row.origin as JournalTag["origin"],
    ownerId: row.owner_user_id,
  };
}

async function hydrateEntry(
  client: Client,
  user: User,
  id: string,
): Promise<JournalEntry> {
  const [row, links] = await Promise.all([
    findJournalEntry(client, user.id, id),
    listJournalEntryTagLinks(client, [id]),
  ]);
  if (!row) throw new JournalEntryNotFoundError();
  return mapEntry(
    row,
    links.filter((link) => link.entry_id === id).map((link) => link.tag_id),
  );
}


export async function getJournalSnapshot(
  client: Client,
  user: User,
  options: { since?: string } = {},
): Promise<JournalSnapshot> {
  const [entryRows, tagRows] = await Promise.all([
    listJournalEntries(client, user.id, options.since),
    listJournalTags(client),
  ]);
  const links = await listJournalEntryTagLinks(
    client,
    entryRows.map((entry) => entry.id),
  );
  const tagIdsByEntry = new Map<string, string[]>();
  for (const link of links) {
    const ids = tagIdsByEntry.get(link.entry_id) ?? [];
    ids.push(link.tag_id);
    tagIdsByEntry.set(link.entry_id, ids);
  }

  return {
    entries: entryRows.map((row) => mapEntry(row, tagIdsByEntry.get(row.id) ?? [])),
    tags: tagRows.map(mapTag),
  };
}

export async function saveJournalEntry(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = journalSaveInputSchema.parse(rawInput);
  if (input.title.trim() === "" && input.content.trim() === "") {
    throw new JournalServiceError("A anotação não pode estar vazia.");
  }
  const base = readBaseFingerprint(rawInput);
  if (base !== undefined && input.id) {
    const [row, links] = await Promise.all([
      findJournalEntry(client, user.id, input.id),
      listJournalEntryTagLinks(client, [input.id]),
    ]);
    const tagIds = links.filter((link) => link.entry_id === input.id).map((link) => link.tag_id);
    const current = row ? mapEntry(row, tagIds) : null;
    // Na lixeira em outro aparelho: editar por cima sumiria com a decisao dela.
    if (current?.trashedAt) throw new OfflineConflictError(current);
    await assertNoOfflineConflict({
      base,
      currentContent: current ? journalContent(current) : null,
      currentEntity: current,
      nextContent: journalContent(input),
    });
  }
  const payload: Json = {
    id: input.id ?? null,
    title: input.title,
    content: input.content,
    status: input.status,
    tag_ids: input.tagIds,
  };
  const id = await persistJournalEntry(client, payload);
  return hydrateEntry(client, user, id);
}

export async function addCustomJournalTag(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = customJournalTagInputSchema.parse(rawInput);
  return mapTag(await createCustomJournalTag(client, user.id, input.label));
}

export async function changeJournalTrashState(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = journalEntryActionSchema.parse(rawInput);
  const row = await setJournalTrashState(
    client,
    user.id,
    input.id,
    input.action === "trash" ? new Date().toISOString() : null,
  );
  if (!row) throw new JournalEntryNotFoundError();
  const links = await listJournalEntryTagLinks(client, [row.id]);
  return mapEntry(row, links.map((link) => link.tag_id));
}

export async function permanentlyDeleteJournalEntry(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const { id } = journalEntryDeleteSchema.parse(rawInput);
  const deleted = await deleteJournalEntry(client, user.id, id);
  if (!deleted) throw new JournalEntryNotFoundError();
  return { id: deleted };
}

export async function purgeExpiredJournalEntries(client: Client) {
  return { count: await purgeExpiredJournal(client) };
}


export async function getOlderJournalEntries(
  client: Client,
  user: User,
  before: string,
  limit: number,
) {
  const rows = await listJournalEntriesBefore(client, user.id, before, limit);
  const links = await listJournalEntryTagLinks(
    client,
    rows.map((row) => row.id),
  );
  const tagIdsByEntry = new Map<string, string[]>();
  for (const link of links) {
    const ids = tagIdsByEntry.get(link.entry_id) ?? [];
    ids.push(link.tag_id);
    tagIdsByEntry.set(link.entry_id, ids);
  }
  return rows.map((row) => mapEntry(row, tagIdsByEntry.get(row.id) ?? []));
}
