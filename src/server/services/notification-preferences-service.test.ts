import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/repositories/notification-preferences-repository", () => ({
  NotificationPreferencesRepositoryError: class NotificationPreferencesRepositoryError extends Error {},
  findNotificationPreferences: vi.fn(),
  updateNotificationPreference: vi.fn(),
  syncLegacyReminderColumn: vi.fn(),
}));

import type { Database } from "@/lib/supabase/database.types";
import {
  findNotificationPreferences,
  syncLegacyReminderColumn,
  updateNotificationPreference,
} from "@/server/repositories/notification-preferences-repository";
import {
  NotificationChannelUnavailableError,
  NotificationPreferenceNotFoundError,
  availableNotificationChannels,
  deliverableNotificationChannels,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/server/services/notification-preferences-service";

const client = {} as SupabaseClient<Database>;
const userId = "22222222-2222-4222-8222-222222222222";

function row(
  kind: string,
  channel: string,
  enabled: boolean,
  snoozedUntil: string | null = null,
) {
  return {
    user_id: userId,
    kind,
    channel,
    enabled,
    snoozed_until: snoozedUntil,
    created_at: "2026-09-11T00:00:00.000Z",
    updated_at: "2026-09-11T00:00:00.000Z",
  };
}

/*
  Doze linhas desde a extensao do 23-A: quatro tipos por tres canais. A fixture
  espelha a matriz real de proposito — uma fixture menor faria o teste
  "devolve a matriz inteira" passar afirmando uma matriz que nao existe mais.
*/
const MATRIZ = [
  row("checkin_reminder", "in_app", true),
  row("checkin_reminder", "web_push", false),
  row("checkin_reminder", "email", false),
  row("goal_reminder", "in_app", true),
  row("goal_reminder", "web_push", false),
  row("goal_reminder", "email", false),
  row("weekly_digest", "in_app", false),
  row("weekly_digest", "web_push", false),
  row("weekly_digest", "email", false),
  row("system_notice", "in_app", true),
  row("system_notice", "web_push", false),
  row("system_notice", "email", false),
];

describe("preferencias de notificacao", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(findNotificationPreferences).mockResolvedValue(MATRIZ);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("canais disponiveis", () => {
    const EMAIL_CHAIN = {
      ELYRA_EMAIL_TRANSPORT: "local_capture",
      ELYRA_PUBLIC_APP_URL: "http://localhost:3000",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54381",
      SUPABASE_SERVICE_ROLE_KEY: "service-role-fixture",
      ELYRA_DISPATCH_SECRET: "x".repeat(32),
    };

    it("in_app sempre existe: a entrega e a propria tela", () => {
      expect(availableNotificationChannels({})).toEqual(["in_app"]);
    });

    it("web_push nunca e oferecido: chave VAPID nao e entrega (L-279)", () => {
      expect(
        availableNotificationChannels({
          ELYRA_WEB_PUSH_PUBLIC_KEY: "pub",
          ELYRA_WEB_PUSH_PRIVATE_KEY: "priv",
          ...EMAIL_CHAIN,
        }),
      ).not.toContain("web_push");
    });

    it("email nao aparece sem transporte declarado", () => {
      expect(availableNotificationChannels({})).not.toContain("email");
    });

    it("email exige a cadeia inteira: transporte, URL, cliente de sistema e segredo", () => {
      expect(availableNotificationChannels(EMAIL_CHAIN)).toEqual(["in_app", "email"]);
      for (const faltando of Object.keys(EMAIL_CHAIN)) {
        const env = { ...EMAIL_CHAIN, [faltando]: undefined };
        expect(availableNotificationChannels(env), faltando).not.toContain("email");
      }
    });

    it("segredo curto do agendador nao conta como configurado", () => {
      expect(
        availableNotificationChannels({ ...EMAIL_CHAIN, ELYRA_DISPATCH_SECRET: "curto" }),
      ).not.toContain("email");
    });

    it("brevo sem remetente nao e canal: a Brevo recusaria toda mensagem", () => {
      expect(
        availableNotificationChannels({
          ...EMAIL_CHAIN,
          ELYRA_EMAIL_TRANSPORT: "brevo",
          BREVO_API_KEY: "chave-fixture",
        }),
      ).not.toContain("email");
    });

    it("configuracao completa sem dispatcher saudavel nao oferece e-mail", async () => {
      const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
      const canais = await deliverableNotificationChannels(
        { rpc } as unknown as SupabaseClient<Database>,
        EMAIL_CHAIN,
      );
      expect(canais).toEqual(["in_app"]);
      expect(rpc).toHaveBeenCalledWith("notification_email_dispatcher_healthy", {
        p_max_age_minutes: 60,
      });
    });

    it("dispatcher saudavel oferece e-mail", async () => {
      const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
      await expect(
        deliverableNotificationChannels({ rpc } as unknown as SupabaseClient<Database>, EMAIL_CHAIN),
      ).resolves.toEqual(["in_app", "email"]);
    });

    it("erro ao consultar a saude vale indisponivel, nunca otimismo", async () => {
      const rpc = vi.fn().mockRejectedValue(new Error("rede"));
      await expect(
        deliverableNotificationChannels({ rpc } as unknown as SupabaseClient<Database>, EMAIL_CHAIN),
      ).resolves.toEqual(["in_app"]);
    });

    it("sem configuracao de e-mail nem consulta o banco", async () => {
      const rpc = vi.fn();
      await deliverableNotificationChannels({ rpc } as unknown as SupabaseClient<Database>, {});
      expect(rpc).not.toHaveBeenCalled();
    });
  });

  describe("leitura", () => {
    it("devolve a matriz inteira, e nao so o que esta ligado", async () => {
      const preferences = await getNotificationPreferences(client);
      expect(preferences.preferences).toHaveLength(12);
      expect(preferences.preferences).toContainEqual({
        kind: "weekly_digest",
        channel: "in_app",
        enabled: false,
        snoozedUntil: null,
      });
    });

    it("declara o canal indisponivel pela ausencia, e nao por um booleano", async () => {
      const preferences = await getNotificationPreferences(client);
      expect(preferences.availableChannels).toEqual(["in_app"]);
      // A linha de push continua na matriz: some da lista de canais, nao do dado.
      expect(
        preferences.preferences.some((item) => item.channel === "web_push"),
      ).toBe(true);
    });
  });

  describe("escrita", () => {
    it("recusa ligar um canal que esta instalacao nao entrega", async () => {
      await expect(
        updateNotificationPreferences(client, {
          kind: "goal_reminder",
          channel: "web_push",
          enabled: true,
        }),
      ).rejects.toBeInstanceOf(NotificationChannelUnavailableError);
      expect(updateNotificationPreference).not.toHaveBeenCalled();
    });

    it("espelha a decisao de in_app na coluna legada", async () => {
      vi.mocked(updateNotificationPreference).mockResolvedValue(
        row("goal_reminder", "in_app", false),
      );

      await updateNotificationPreferences(client, {
        kind: "goal_reminder",
        channel: "in_app",
        enabled: false,
      });

      expect(syncLegacyReminderColumn).toHaveBeenCalledWith(
        client,
        userId,
        "goal_reminder",
        false,
      );
    });

    it("tipo novo nao tem coluna legada, e nao inventa uma", async () => {
      vi.mocked(updateNotificationPreference).mockResolvedValue(
        row("weekly_digest", "in_app", true),
      );

      await updateNotificationPreferences(client, {
        kind: "weekly_digest",
        channel: "in_app",
        enabled: true,
      });

      expect(syncLegacyReminderColumn).not.toHaveBeenCalled();
    });

    it("adiar nao mexe na coluna legada: adiar nao e desligar", async () => {
      vi.mocked(updateNotificationPreference).mockResolvedValue(
        row("goal_reminder", "in_app", true, "2026-09-18T00:00:00.000Z"),
      );

      await updateNotificationPreferences(client, {
        kind: "goal_reminder",
        channel: "in_app",
        snoozedUntil: "2026-09-18T00:00:00.000Z",
      });

      expect(updateNotificationPreference).toHaveBeenCalledWith(client, {
        kind: "goal_reminder",
        channel: "in_app",
        patch: { snoozed_until: "2026-09-18T00:00:00.000Z" },
      });
      expect(syncLegacyReminderColumn).not.toHaveBeenCalled();
    });

    it("adiar vale para todos os canais do tipo: e-mail nao sai durante o adiamento", async () => {
      const ate = "2026-09-26T12:00:00.000Z";
      vi.mocked(updateNotificationPreference).mockImplementation(async (_c, arg) =>
        row(arg.kind, arg.channel, true, ate),
      );
      await updateNotificationPreferences(client, {
        kind: "checkin_reminder",
        channel: "in_app",
        snoozedUntil: ate,
      });
      const canais = vi
        .mocked(updateNotificationPreference)
        .mock.calls.map(([, arg]) => `${arg.kind}:${arg.channel}:${arg.patch.snoozed_until}`);
      expect(canais.sort()).toEqual([
        `checkin_reminder:email:${ate}`,
        `checkin_reminder:in_app:${ate}`,
        `checkin_reminder:web_push:${ate}`,
      ]);
    });

    it("voltar a receber limpa o adiamento de todos os canais do tipo", async () => {
      vi.mocked(updateNotificationPreference).mockImplementation(async (_c, arg) =>
        row(arg.kind, arg.channel, true, null),
      );
      await updateNotificationPreferences(client, {
        kind: "weekly_digest",
        channel: "in_app",
        snoozedUntil: null,
      });
      expect(vi.mocked(updateNotificationPreference)).toHaveBeenCalledTimes(3);
      for (const [, arg] of vi.mocked(updateNotificationPreference).mock.calls) {
        expect(arg.patch).toEqual({ snoozed_until: null });
      }
    });

    it("ligar/desligar continua sendo do par, e nao do tipo", async () => {
      vi.mocked(updateNotificationPreference).mockResolvedValue(row("weekly_digest", "in_app", false));
      await updateNotificationPreferences(client, { kind: "weekly_digest", channel: "in_app", enabled: false });
      expect(vi.mocked(updateNotificationPreference)).toHaveBeenCalledTimes(1);
    });

    it("par ausente e defeito de semeadura, e nao linha nova", async () => {
      vi.mocked(updateNotificationPreference).mockResolvedValue(null);

      await expect(
        updateNotificationPreferences(client, {
          kind: "goal_reminder",
          channel: "in_app",
          enabled: true,
        }),
      ).rejects.toBeInstanceOf(NotificationPreferenceNotFoundError);
    });

    it("recusa payload que nao diz o que mudar", async () => {
      await expect(
        updateNotificationPreferences(client, {
          kind: "goal_reminder",
          channel: "in_app",
        }),
      ).rejects.toThrow();
      expect(updateNotificationPreference).not.toHaveBeenCalled();
    });

    it("recusa tipo fora do contrato", async () => {
      await expect(
        updateNotificationPreferences(client, {
          kind: "campaign",
          channel: "in_app",
          enabled: true,
        }),
      ).rejects.toThrow();
      expect(updateNotificationPreference).not.toHaveBeenCalled();
    });
  });
});
