import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  NOTIFICATION_COPY,
  notificationIdSchema,
  notificationSchema,
  notificationSnapshotSchema,
} from "@/lib/contracts/notifications";
import type { Database } from "@/lib/supabase/database.types";
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationRead,
  materializeNotifications,
} from "@/server/repositories/notifications-repository";

type Client = SupabaseClient<Database>;
const LIST_LIMIT = 20;

export class NotificationNotFoundError extends Error {
  constructor() {
    super("Notificação não encontrada.");
    this.name = "NotificationNotFoundError";
  }
}

export async function getNotificationsSnapshot(client: Client) {
  await materializeNotifications(client);
  const [rows, unreadCount] = await Promise.all([
    listNotifications(client, LIST_LIMIT),
    countUnreadNotifications(client),
  ]);

  return notificationSnapshotSchema.parse({
    notifications: rows.map((row) => {
      const copy = NOTIFICATION_COPY[row.kind as keyof typeof NOTIFICATION_COPY];
      return notificationSchema.parse({
        id: row.id,
        kind: row.kind,
        title: copy?.title,
        message: copy?.message,
        readAt: row.read_at,
        createdAt: row.created_at,
      });
    }),
    unreadCount,
  });
}

export async function readNotification(client: Client, rawId: unknown) {
  const id = notificationIdSchema.parse(rawId);
  const markedId = await markNotificationRead(client, id);
  if (!markedId) throw new NotificationNotFoundError();
  return { id: markedId };
}
