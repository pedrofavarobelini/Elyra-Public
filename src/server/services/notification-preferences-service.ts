import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  NOTIFICATION_CHANNELS,
  notificationPreferenceUpdateSchema,
  notificationPreferencesSchema,
  type NotificationChannel,
  type NotificationPreferences,
} from "@/lib/contracts/notifications";
import type { Database } from "@/lib/supabase/database.types";
import { adminClientConfigured } from "@/lib/supabase/admin";
import { emailDeliveryAvailable } from "@/server/email/transport";
import { dispatchSecretConfigured } from "@/server/internal-dispatch-secret";
import { DISPATCHER_HEALTH_MAX_AGE_MINUTES } from "@/server/jobs/notification-email-dispatcher";
import { appBaseUrl } from "@/server/services/email-delivery-service";
import {
  findNotificationPreferences,
  syncLegacyReminderColumn,
  updateNotificationPreference,
  type NotificationPreferenceRow,
} from "@/server/repositories/notification-preferences-repository";

type Client = SupabaseClient<Database>;

export class NotificationPreferenceNotFoundError extends Error {
  constructor() {
    super("Preferência de notificação não encontrada.");
    this.name = "NotificationPreferenceNotFoundError";
  }
}

export class NotificationChannelUnavailableError extends Error {
  constructor(public readonly channel: NotificationChannel) {
    super("Este canal não está disponível nesta instalação.");
    this.name = "NotificationChannelUnavailableError";
  }
}


const LEGACY_COLUMN = {
  checkin_reminder: "checkin_reminder",
  goal_reminder: "goal_reminder",
} as const satisfies Partial<Record<string, "checkin_reminder" | "goal_reminder">>;

/**
 * Canais que **esta instalacao** consegue entregar.
 *
 * `in_app` sempre existe: a entrega e a propria tela. `web_push` depende de
 * chave VAPID no ambiente, e por isso e propriedade da instalacao, e nao da
 * pessoa. Sem a chave, o canal nao aparece como opcao — e a tela diz que ele
 * nao esta disponivel, em vez de oferecer um controle que nao entrega nada.
 *
 * A leitura e do ambiente do **servidor**: a chave publica pode ser publica, e
 * ainda assim quem decide se o canal existe e o servidor que enviaria o push.
 */
export type NotificationEnvironment = Readonly<
  Record<string, string | undefined>
>;

/**
 * Capability por canal, e nao um booleano compartilhado.
 *
 * A versao anterior filtrava com `channel === "in_app" || pushConfigured`. Com
 * dois canais aquilo funcionava; no instante em que `email` entrou na matriz,
 * passou a significar "e-mail esta disponivel sempre que houver chave VAPID" —
 * acoplando um canal ao pre-requisito do outro. Cada canal responde por si.
 */
const CHANNEL_AVAILABILITY: Record<
  NotificationChannel,
  (env: NotificationEnvironment) => boolean
> = {
  // A entrega e a propria tela: nao ha o que configurar.
  in_app: () => true,

  web_push: () => false,
  /*
    E-mail precisa de TODA a cadeia configurada: transporte com remetente,
    endereco publico para o link, cliente de sistema e segredo do agendador.
    Isto e so a metade estatica; `deliverableNotificationChannels` acrescenta a
    prova de que o dispatcher de fato roda.
  */
  email: (env) =>
    emailDeliveryAvailable(env) &&
    appBaseUrl(env) !== null &&
    adminClientConfigured(env) &&
    dispatchSecretConfigured(env),
};

/** Canais com configuracao completa neste ambiente (sem consultar o banco). */
export function availableNotificationChannels(
  env: NotificationEnvironment = process.env,
): NotificationChannel[] {
  return NOTIFICATION_CHANNELS.filter((channel) =>
    CHANNEL_AVAILABILITY[channel](env),
  );
}

/**
 * Canais que **de fato entregam** agora (L-279).
 *
 * Para `email`, configuracao nao basta: a chave pode existir e nenhum agendador
 * chamar o dispatcher. O canal so aparece se houve uma execucao concluida
 * recente (`notification_email_dispatcher_healthy`). Falha ao consultar vale
 * "indisponivel" — oferecer por otimismo e o defeito que isto fecha.
 */
export async function deliverableNotificationChannels(
  client: Client,
  env: NotificationEnvironment = process.env,
): Promise<NotificationChannel[]> {
  const configured = availableNotificationChannels(env);
  if (!configured.includes("email")) return configured;
  let healthy = false;
  try {
    const { data, error } = await client.rpc("notification_email_dispatcher_healthy", {
      p_max_age_minutes: DISPATCHER_HEALTH_MAX_AGE_MINUTES,
    });
    healthy = !error && data === true;
  } catch {
    healthy = false;
  }
  return healthy ? configured : configured.filter((channel) => channel !== "email");
}

function rowToPreference(row: NotificationPreferenceRow) {
  return {
    kind: row.kind,
    channel: row.channel,
    enabled: row.enabled,
    snoozedUntil: row.snoozed_until,
  };
}

export async function getNotificationPreferences(
  client: Client,
): Promise<NotificationPreferences> {
  const rows = await findNotificationPreferences(client);
  return notificationPreferencesSchema.parse({
    preferences: rows.map(rowToPreference),
    availableChannels: await deliverableNotificationChannels(client),
  });
}

/**
 * Aplica uma mudanca a um par da matriz.
 *
 * Tres decisoes visiveis aqui:
 *
 * 1. **Canal indisponivel recusa a escrita.** Guardar `enabled = true` para um
 *    canal que a instalacao nao entrega criaria uma preferencia que mente: a
 *    pessoa acharia que autorizou algo que nunca aconteceria.
 * 2. **Par ausente e erro, e nao criacao.** A matriz nasce inteira; a ausencia
 *    de uma linha significa que a semeadura falhou, e inventar a linha aqui
 *    esconderia isso.
 * 3. **A face legada e escrita junto**, e somente para `in_app` dos dois tipos
 *    que a possuem. Quem le a coluna antiga continua vendo a verdade.
 */
export async function updateNotificationPreferences(
  client: Client,
  rawInput: unknown,
): Promise<NotificationPreferences> {
  const input = notificationPreferenceUpdateSchema.parse(rawInput);

  if (!(await deliverableNotificationChannels(client)).includes(input.channel)) {
    throw new NotificationChannelUnavailableError(input.channel);
  }

  const patch: { enabled?: boolean; snoozed_until?: string | null } = {};
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.snoozedUntil !== undefined) patch.snoozed_until = input.snoozedUntil;

  const updated = await updateNotificationPreference(client, {
    kind: input.kind,
    channel: input.channel,
    patch,
  });
  if (!updated) throw new NotificationPreferenceNotFoundError();


  if (input.snoozedUntil !== undefined) {
    for (const channel of NOTIFICATION_CHANNELS) {
      if (channel === input.channel) continue;
      const irmao = await updateNotificationPreference(client, {
        kind: input.kind,
        channel,
        patch: { snoozed_until: input.snoozedUntil },
      });
      if (!irmao) throw new NotificationPreferenceNotFoundError();
    }
  }

  const legacyColumn =
    input.channel === "in_app"
      ? LEGACY_COLUMN[input.kind as keyof typeof LEGACY_COLUMN]
      : undefined;
  if (legacyColumn && input.enabled !== undefined) {
    await syncLegacyReminderColumn(client, updated.user_id, legacyColumn, input.enabled);
  }

  return getNotificationPreferences(client);
}
