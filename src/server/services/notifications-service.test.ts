import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/repositories/notifications-repository", () => ({
  NotificationsRepositoryError: class NotificationsRepositoryError extends Error {},
  countUnreadNotifications: vi.fn(),
  listNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  materializeNotifications: vi.fn(),
}));

import type { Database } from "@/lib/supabase/database.types";
import {
  countUnreadNotifications,
  listNotifications,
  markNotificationRead,
  materializeNotifications,
} from "@/server/repositories/notifications-repository";
import {
  getNotificationsSnapshot,
  NotificationNotFoundError,
  readNotification,
} from "@/server/services/notifications-service";

const client = {} as SupabaseClient<Database>;
const id = "11111111-1111-4111-8111-111111111111";

describe("notifications service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(materializeNotifications).mockResolvedValue(1);
    vi.mocked(countUnreadNotifications).mockResolvedValue(1);
    vi.mocked(listNotifications).mockResolvedValue([
      {
        id,
        user_id: "22222222-2222-4222-8222-222222222222",
        kind: "goal_reminder",
        event_key: "goal_reminder:2026-08-28",
        read_at: null,
        created_at: "2026-08-28T12:00:00.000Z",
      },
    ]);
  });

  it("materializa antes de listar e deriva copia do vocabulary fechado", async () => {
    const snapshot = await getNotificationsSnapshot(client);

    expect(materializeNotifications).toHaveBeenCalledWith(client);
    expect(listNotifications).toHaveBeenCalledWith(client, 20);
    expect(snapshot).toEqual({
      notifications: [
        expect.objectContaining({
          id,
          kind: "goal_reminder",
          title: "Lembrete de metas",
        }),
      ],
      unreadCount: 1,
    });
    expect(
      vi.mocked(materializeNotifications).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(listNotifications).mock.invocationCallOrder[0] ?? 0);
  });

  it("recusa categoria persistida fora do contrato", async () => {
    vi.mocked(listNotifications).mockResolvedValue([
      {
        id,
        user_id: "22222222-2222-4222-8222-222222222222",
        kind: "campaign",
        event_key: "campaign:2026-08-28",
        read_at: null,
        created_at: "2026-08-28T12:00:00.000Z",
      },
    ]);

    await expect(getNotificationsSnapshot(client)).rejects.toThrow();
  });

  it("valida o UUID antes de chegar ao repositorio", async () => {
    await expect(readNotification(client, "invalido")).rejects.toThrow();
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it("nao distingue inexistente de notificacao alheia", async () => {
    vi.mocked(markNotificationRead).mockResolvedValue(null);
    await expect(readNotification(client, id)).rejects.toBeInstanceOf(
      NotificationNotFoundError,
    );
  });

  it("devolve apenas o identificador apos a leitura", async () => {
    vi.mocked(markNotificationRead).mockResolvedValue(id);
    await expect(readNotification(client, id)).resolves.toEqual({ id });
  });
});
