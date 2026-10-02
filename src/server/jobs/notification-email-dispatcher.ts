import "server-only";

import { NOTIFICATION_KINDS, type NotificationKind } from "@/lib/contracts/notifications";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import {
  EMAIL_FAILURE,
  MAX_TENTATIVAS,
  classificarFalha,
  esperaMs,
  formatarLogEntrega,
  haProximaTentativa,
  podeRepetir,
  type EmailFailureClass,
} from "@/server/email/failure";
import { EMAIL_TEMPLATES, renderEmailMessage } from "@/server/email/templates";
import {
  EmailTransportError,
  createEmailTransport,
  isCaptureTransport,
  type EmailEnvironment,
  type EmailTransport,
} from "@/server/email/transport";
import { appBaseUrl } from "@/server/services/email-delivery-service";



export const DEFAULT_NOTIFICATION_TIMEZONE = "America/Sao_Paulo";
export const DEFAULT_SEND_HOURS = { start: 8, end: 21 } as const;
/** Teto diario padrao. Fica bem abaixo do limite gratuito publicado da Brevo. */
export const DEFAULT_DAILY_LIMIT = 100;
export const MAX_DAILY_LIMIT = 300;
export const DEFAULT_BATCH_SIZE = 50;
export const MAX_BATCH_SIZE = 200;
/** Janela de saude usada pela UI: o agendador roda a cada 15 min. */
export const DISPATCHER_HEALTH_MAX_AGE_MINUTES = 60;

export interface DispatchConfig {
  timezone: string;
  sendHours: { start: number; end: number };
  dailyLimit: number;
  batchSize: number;
}

function inteiro(raw: string | undefined, padrao: number, min: number, max: number): number {
  const valor = Number(raw?.trim());
  if (!Number.isInteger(valor) || valor < min || valor > max) return padrao;
  return valor;
}

function fusoValido(fuso: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/**
 * Configuracao lida do ambiente, sempre com teto. Valor absurdo volta ao
 * padrao em vez de abrir a cota: um `ELYRA_EMAIL_DAILY_LIMIT=100000` por engano
 * nao pode queimar a conta gratuita do provedor.
 */
export function dispatchConfig(env: EmailEnvironment = process.env): DispatchConfig {
  const fuso = env.ELYRA_NOTIFICATION_TIMEZONE?.trim() || DEFAULT_NOTIFICATION_TIMEZONE;
  const horas = /^(\d{1,2})-(\d{1,2})$/.exec(env.ELYRA_NOTIFICATION_SEND_HOURS?.trim() ?? "");
  const start = horas ? Number(horas[1]) : DEFAULT_SEND_HOURS.start;
  const end = horas ? Number(horas[2]) : DEFAULT_SEND_HOURS.end;
  const horasValidas = start >= 0 && end <= 24 && start < end;
  return {
    timezone: fusoValido(fuso) ? fuso : DEFAULT_NOTIFICATION_TIMEZONE,
    sendHours: horasValidas ? { start, end } : { ...DEFAULT_SEND_HOURS },
    dailyLimit: inteiro(env.ELYRA_EMAIL_DAILY_LIMIT, DEFAULT_DAILY_LIMIT, 1, MAX_DAILY_LIMIT),
    batchSize: inteiro(env.ELYRA_NOTIFICATION_DISPATCH_BATCH, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE),
  };
}

/** Hora local (0-23) no fuso da instalacao. */
export function horaLocal(now: Date, timezone: string): number {
  const parte = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .find((p) => p.type === "hour");
  return Number(parte?.value ?? 0);
}

export function dentroDaJanela(now: Date, config: DispatchConfig): boolean {
  const hora = horaLocal(now, config.timezone);
  return hora >= config.sendHours.start && hora < config.sendHours.end;
}

export type DispatchOutcome =
  | { status: "unavailable"; reason: "transport_missing" | "app_url_missing" | "admin_missing" }
  | {
      status: "completed" | "outside_window" | "quota_reached" | "failed";
      runId: string | null;
      selected: number;
      delivered: number;
      suppressed: number;
      failed: number;
      transport: EmailTransport["kind"];
    };

type DueItem = { user_id: string; kind: string; event_key: string };

function isKind(value: string): value is NotificationKind {
  return (NOTIFICATION_KINDS as readonly string[]).includes(value);
}

async function enviarComRetry(
  transport: EmailTransport,
  message: { to: string; subject: string; body: string; html: string },
  correlationId: string,
  kind: NotificationKind,
  sleep: (ms: number) => Promise<void>,
): Promise<{ ok: true } | { ok: false; reason: string; failureClass: EmailFailureClass }> {
  let tentativa = 0;
  let motivo = "transport_error";
  let classe: EmailFailureClass = EMAIL_FAILURE.PERMANENT;
  while (tentativa < MAX_TENTATIVAS) {
    tentativa += 1;
    try {
      await transport.send(message);
      console.info(
        formatarLogEntrega({
          event: kind,
          provider: transport.kind,
          status: "delivered",
          attempt: tentativa,
          correlationId,
        }),
      );
      return { ok: true };
    } catch (cause) {
      motivo = cause instanceof EmailTransportError ? cause.reason : "transport_error";
      classe = classificarFalha(motivo);
      console.info(
        formatarLogEntrega({
          event: kind,
          provider: transport.kind,
          status: classe,
          code: motivo,
          attempt: tentativa,
          correlationId,
        }),
      );
      if (!podeRepetir(classe) || !haProximaTentativa(tentativa)) break;
      await sleep(esperaMs(tentativa));
    }
  }
  return { ok: false, reason: motivo, failureClass: classe };
}

async function lerEnderecoConfirmado(admin: AdminClient, userId: string): Promise<string | null> {
  try {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data?.user) return null;
    const { email, email_confirmed_at: confirmado } = data.user;
    return email && confirmado ? email : null;
  } catch {
    return null;
  }
}

export async function dispatchNotificationEmails(
  options: {
    env?: EmailEnvironment;
    admin?: AdminClient | null;
    transport?: EmailTransport | null;
    now?: Date;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<DispatchOutcome> {
  const env = options.env ?? process.env;
  const transport = options.transport === undefined ? createEmailTransport(env) : options.transport;
  if (!transport) return { status: "unavailable", reason: "transport_missing" };
  const baseUrl = appBaseUrl(env);
  if (!baseUrl) return { status: "unavailable", reason: "app_url_missing" };
  const admin = options.admin === undefined ? createAdminClient(env) : options.admin;
  if (!admin) return { status: "unavailable", reason: "admin_missing" };

  const config = dispatchConfig(env);
  const now = options.now ?? new Date();
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const counts = { selected: 0, delivered: 0, suppressed: 0, failed: 0 };

  const { data: run, error: runError } = await admin
    .from("notification_dispatch_runs")
    .insert({ transport: transport.kind })
    .select("id")
    .single();
  const runId = runError ? null : (run?.id ?? null);

  const finish = async (
    status: "completed" | "outside_window" | "quota_reached" | "failed",
  ): Promise<DispatchOutcome> => {
    if (runId) {
      await admin
        .from("notification_dispatch_runs")
        .update({ outcome: status, finished_at: new Date().toISOString(), ...counts })
        .eq("id", runId);
    }
    console.info(
      `elyra.notification_dispatch run=${runId ?? "none"} outcome=${status} provider=${transport.kind} ` +
        `selected=${counts.selected} delivered=${counts.delivered} suppressed=${counts.suppressed} failed=${counts.failed}`,
    );
    return { status, runId, transport: transport.kind, ...counts };
  };

  if (!runId) return finish("failed");
  if (!dentroDaJanela(now, config)) return finish("outside_window");

  const { data: usados, error: quotaError } = await admin.rpc("email_deliveries_used_since", {
    p_since: new Date(now.getTime() - 86_400_000).toISOString(),
  });
  if (quotaError || typeof usados !== "number") return finish("failed");
  const restante = config.dailyLimit - usados;
  if (restante <= 0) return finish("quota_reached");

  const { data: due, error: dueError } = await admin.rpc("due_notification_emails", {
    p_timezone: config.timezone,
    p_limit: Math.min(config.batchSize, restante),
  });
  if (dueError || !Array.isArray(due)) return finish("failed");

  const itens = due as DueItem[];
  counts.selected = itens.length;
  const statusSucesso = isCaptureTransport(transport.kind) ? "captured" : "sent";

  for (const item of itens) {
    if (!isKind(item.kind)) {
      counts.suppressed += 1;
      continue;
    }
    try {
      const destino = await lerEnderecoConfirmado(admin, item.user_id);
      if (!destino) {
        counts.suppressed += 1;
        continue;
      }
      const template = EMAIL_TEMPLATES[item.kind];
      const { data: deliveryId, error: enqueueError } = await admin.rpc(
        "enqueue_notification_email_for",
        {
          p_user_id: item.user_id,
          p_kind: item.kind,
          p_event_key: item.event_key,
          p_transport: transport.kind,
          p_subject: template.subject,
          p_body: template.body,
        },
      );
      if (enqueueError) {
        counts.failed += 1;
        continue;
      }
      // `null`: outra execucao ganhou a janela, ou a preferencia mudou no meio.
      if (!deliveryId) {
        counts.suppressed += 1;
        continue;
      }
      const rendered = renderEmailMessage(item.kind, baseUrl);
      const resultado = await enviarComRetry(
        transport,
        { to: destino, subject: rendered.subject, body: rendered.body, html: rendered.html },
        deliveryId,
        item.kind,
        sleep,
      );
      await admin.rpc("settle_notification_email_for", {
        p_delivery_id: deliveryId,
        p_status: resultado.ok ? statusSucesso : "failed",
        ...(resultado.ok ? {} : { p_failure_code: resultado.reason }),
      });
      if (resultado.ok) counts.delivered += 1;
      else counts.failed += 1;
    } catch {
      counts.failed += 1;
    }
  }

  await admin.rpc("purge_email_delivery_history");
  return finish("completed");
}
