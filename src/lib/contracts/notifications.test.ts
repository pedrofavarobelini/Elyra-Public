import { describe, expect, it } from "vitest";

import {
  EMPTY_NOTIFICATION_SNAPSHOT,
  NOTIFICATION_COPY,
  notificationIdSchema,
  notificationSchema,
  notificationSnapshotSchema,
} from "@/lib/contracts/notifications";

const notification = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "checkin_reminder",
  title: NOTIFICATION_COPY.checkin_reminder.title,
  message: NOTIFICATION_COPY.checkin_reminder.message,
  readAt: null,
  createdAt: "2026-08-28T12:00:00.000Z",
};

describe("contrato de notificacoes in-app", () => {
  it("aceita somente as categorias do contrato, e recusa campanha", () => {
    expect(notificationSchema.parse(notification).kind).toBe("checkin_reminder");

    expect(notificationSchema.parse({ ...notification, kind: "weekly_digest" }).kind)
      .toBe("weekly_digest");
    expect(() =>
      notificationSchema.parse({ ...notification, kind: "push_campaign" }),
    ).toThrow();
  });

  it("mantem copia neutra e fechada para cada categoria", () => {
    expect(Object.keys(NOTIFICATION_COPY).sort()).toEqual([
      "appointment_cancelled",
      "appointment_confirmed",
      "appointment_reminder",
      "appointment_requested",
      "checkin_reminder",
      "connection_requested",
      "goal_reminder",
      "help_request_received",
      "help_request_updated",
      "invite_accepted",
      "professional_verification_update",
      "relationship_created",
      "session_ready",
      "system_notice",
      "weekly_digest",
    ]);
    expect(JSON.stringify(NOTIFICATION_COPY)).not.toMatch(
      /diagnostico|clinico|transtorno|tratamento/i,
    );
  });

  it("recusa campo extra no item", () => {
    expect(() =>
      notificationSchema.parse({ ...notification, deepLink: "/metas" }),
    ).toThrow();
  });

  it("limita a caixa V1 a vinte itens", () => {
    expect(() =>
      notificationSnapshotSchema.parse({
        notifications: Array.from({ length: 21 }, (_, index) => ({
          ...notification,
          id: `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
        })),
        unreadCount: 21,
      }),
    ).toThrow();
  });

  it("nao aceita contador negativo", () => {
    expect(() =>
      notificationSnapshotSchema.parse({
        ...EMPTY_NOTIFICATION_SNAPSHOT,
        unreadCount: -1,
      }),
    ).toThrow();
  });

  it("exige UUID para a acao de leitura", () => {
    expect(notificationIdSchema.parse(notification.id)).toBe(notification.id);
    expect(() => notificationIdSchema.parse("nao-e-uuid")).toThrow();
  });
});
