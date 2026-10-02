import "server-only";

import {
  SEM_RESULTADO,
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";
import { chunkIds } from "./id-chunks";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type EntryRow = Database["public"]["Tables"]["journal_entries"]["Row"];
type TagRow = Database["public"]["Tables"]["journal_tags"]["Row"];

export class JournalRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio do diario: ${operation}.`);
    this.name = "JournalRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("diario", operation, normalizada);
  }
}

export async function listJournalEntries(client: Client, userId: string, since?: string) {
  const query = client
    .from("journal_entries")
    .select("id, user_id, title, content, status, created_at, updated_at, trashed_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  const { data, error } = await (since ? query.gte("updated_at", since) : query);
  if (error) throw new JournalRepositoryError("list_entries", error);
  return data satisfies EntryRow[];
}

export async function countJournalEntriesBefore(client: Client, userId: string, since: string) {
  const { count, error } = await client
    .from("journal_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .lt("updated_at", since);
  if (error) throw new JournalRepositoryError("count_entries_before", error);
  return count ?? 0;
}

export async function listJournalEntriesBefore(
  client: Client,
  userId: string,
  before: string,
  limit: number,
) {
  const { data, error } = await client
    .from("journal_entries")
    .select("id, user_id, title, content, status, created_at, updated_at, trashed_at")
    .eq("user_id", userId)
    .lt("updated_at", before)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw new JournalRepositoryError("list_entries_before", error);
  return data satisfies EntryRow[];
}

export async function findJournalEntry(
  client: Client,
  userId: string,
  id: string,
) {
  const { data, error } = await client
    .from("journal_entries")
    .select("id, user_id, title, content, status, created_at, updated_at, trashed_at")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new JournalRepositoryError("find_entry", error);
  return data satisfies EntryRow | null;
}

export async function listJournalEntryTagLinks(
  client: Client,
  entryIds: string[],
) {
  const rows: { entry_id: string; tag_id: string }[] = [];
  for (const chunk of chunkIds(entryIds)) {
    const { data, error } = await client
      .from("journal_entry_tags")
      .select("entry_id, tag_id")
      .in("entry_id", chunk);
    if (error) throw new JournalRepositoryError("list_entry_tags", error);
    rows.push(...data);
  }
  return rows;
}

export async function listJournalTags(client: Client) {
  const { data, error } = await client
    .from("journal_tags")
    .select("id, label, origin, owner_user_id, created_at")
    .order("origin", { ascending: false })
    .order("label", { ascending: true });
  if (error) throw new JournalRepositoryError("list_tags", error);
  return data satisfies TagRow[];
}

export async function persistJournalEntry(client: Client, payload: Json) {
  const { data, error } = await client.rpc("save_journal_entry", {
    p_payload: payload,
  });
  // RPC de upsert: zero linhas seria anomalia (a funcao sempre devolve a
  // anotacao gravada), nao ausencia. Causa propria no log (L-051).
  if (error) throw new JournalRepositoryError("save_entry", error);
  if (!data) throw new JournalRepositoryError("save_entry", SEM_RESULTADO);
  return data;
}

export async function createCustomJournalTag(
  client: Client,
  userId: string,
  label: string,
) {
  const findExisting = async () => {
    const { data, error } = await client
      .from("journal_tags")
      .select("id, label, origin, owner_user_id, created_at")
      .eq("owner_user_id", userId)
      .eq("origin", "custom");
    if (error) throw new JournalRepositoryError("find_custom_tag", error);
    return data.find(
      (tag) => tag.label.toLocaleLowerCase() === label.toLocaleLowerCase(),
    );
  };

  const existing = await findExisting();
  if (existing) return existing satisfies TagRow;

  const { data, error } = await client
    .from("journal_tags")
    .insert({ label, origin: "custom", owner_user_id: userId })
    .select("id, label, origin, owner_user_id, created_at")
    .single();
  if (error) {
    const concurrent = await findExisting();
    if (concurrent) return concurrent satisfies TagRow;
    throw new JournalRepositoryError("create_custom_tag", error);
  }
  return data satisfies TagRow;
}

export async function setJournalTrashState(
  client: Client,
  userId: string,
  id: string,
  trashedAt: string | null,
) {
  const { data, error } = await client
    .from("journal_entries")
    .update({ trashed_at: trashedAt })
    .eq("user_id", userId)
    .eq("id", id)
    .select("id, user_id, title, content, status, created_at, updated_at, trashed_at")
    .maybeSingle();
  // `error` e `!data` sao coisas diferentes e nao podem virar a mesma
  // excecao. `error` e falha real do banco. `!data` e zero linhas afetadas -
  // a anotacao nao existe, ou existe e pertence a outra pessoa, e a RLS a
  // tornou invisivel. Confundir as duas transformava uma recusa esperada em
  // 500, e enterrava falha real de servidor no meio de negacoes de rotina.
  if (error) throw new JournalRepositoryError("set_trash_state", error);
  return data satisfies EntryRow | null;
}

export async function deleteJournalEntry(
  client: Client,
  userId: string,
  id: string,
) {
  const { data, error } = await client
    .from("journal_entries")
    .delete()
    .eq("user_id", userId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw new JournalRepositoryError("delete_entry", error);
  return data?.id ?? null;
}

export async function purgeExpiredJournal(client: Client) {
  const { data, error } = await client.rpc("purge_expired_journal_entries");
  if (error) throw new JournalRepositoryError("purge_expired", error);
  return Number(data ?? 0);
}
