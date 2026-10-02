import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";

type Client = SupabaseClient<Database>;

export type NotificationPreferenceRow =
  Database["public"]["Tables"]["notification_preferences"]["Row"];

const PREFERENCE_FIELDS =
  "user_id, kind, channel, enabled, snoozed_until, created_at, updated_at" as const;

export class NotificationPreferencesRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de preferencias de notificacao: ${operation}.`);
    this.name = "NotificationPreferencesRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("notificacoes", operation, normalizada);
  }
}

/**
 * A matriz inteira da pessoa.
 *
 * Sem filtro de canal: quem decide o que exibir e a camada de cima, e um
 * repositorio que ja escondesse o par indisponivel tornaria impossivel dizer na
 * tela **por que** ele nao aparece.
 */
export async function findNotificationPreferences(client: Client) {
  const { data, error } = await client
    .from("notification_preferences")
    .select(PREFERENCE_FIELDS)
    .order("kind", { ascending: true })
    .order("channel", { ascending: true });
  if (error) {
    throw new NotificationPreferencesRepositoryError("find_preferences", error);
  }
  return data;
}

/**
 * Atualiza um par, e devolve a linha resultante.
 *
 * `update` com filtro pela chave primaria, e nao `upsert`: a matriz nasce
 * inteira na semeadura, entao um par ausente e **defeito**, e nao caso normal.
 * Um `upsert` transformaria esse defeito em linha nova silenciosa, com
 * `enabled` vindo do payload em vez do default seguro.
 */
export async function updateNotificationPreference(
  client: Client,
  input: {
    kind: string;
    channel: string;
    patch: { enabled?: boolean; snoozed_until?: string | null };
  },
): Promise<NotificationPreferenceRow | null> {
  const { data, error } = await client
    .from("notification_preferences")
    .update(input.patch)
    .eq("kind", input.kind)
    .eq("channel", input.channel)
    .select(PREFERENCE_FIELDS)
    .maybeSingle();
  if (error) {
    throw new NotificationPreferencesRepositoryError("update_preference", error);
  }
  return data;
}

/**
 * Espelha a decisao de `in_app` na coluna legada de `user_preferences`.
 *
 * A migration propaga coluna -> matriz por trigger. O caminho inverso vive
 * aqui, e nao num segundo trigger, porque dois gatilhos em direcoes opostas
 * sobre a mesma decisao e recursao esperando acontecer.
 */
export async function syncLegacyReminderColumn(
  client: Client,
  userId: string,
  column: "checkin_reminder" | "goal_reminder",
  enabled: boolean,
): Promise<void> {
  /*
    Ramo explicito, e nao chave computada.

    `{ [column]: enabled }` e inferido como `Record<string, boolean>`, e o
    cliente tipado recusa - com razao: uma chave dinamica aceitaria qualquer
    nome de coluna vindo de cima, e este e o unico ponto do servico que escreve
    na tabela de identidade.
  */
  const patch =
    column === "checkin_reminder"
      ? { checkin_reminder: enabled }
      : { goal_reminder: enabled };

  const { error } = await client
    .from("user_preferences")
    .update(patch)
    .eq("user_id", userId)
    .select("user_id")
    .maybeSingle();
  if (error) {
    throw new NotificationPreferencesRepositoryError("sync_legacy", error);
  }
}
