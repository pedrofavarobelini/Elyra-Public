import "server-only";

import {
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];

export class NotificationsRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de notificacoes: ${operation}.`);
    this.name = "NotificationsRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("notificacoes", operation, normalizada);
  }
}

export async function materializeNotifications(client: Client) {
  const { data, error } = await client.rpc("materialize_in_app_notifications");
  if (error || typeof data !== "number") {
    throw new NotificationsRepositoryError("materialize", error);
  }
  return data;
}

export async function listNotifications(client: Client, limit: number) {
  const { data, error } = await client
    .from("notifications")
    .select("id, user_id, kind, event_key, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new NotificationsRepositoryError("list", error);
  return data satisfies NotificationRow[];
}

export async function countUnreadNotifications(client: Client) {
  const { count, error } = await client
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error || count === null) {
    throw new NotificationsRepositoryError("count_unread", error);
  }
  return count;
}

export async function markNotificationRead(
  client: Client,
  id: string,
): Promise<string | null> {
  const { data, error } = await client.rpc("mark_in_app_notification_read", {
    p_notification_id: id,
  });
  if (error) throw new NotificationsRepositoryError("mark_read", error);
  return (data as string | null) ?? null;
}
