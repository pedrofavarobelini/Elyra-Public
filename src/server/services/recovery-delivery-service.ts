import "server-only";

import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import {
  createEmailTransport,
  type EmailEnvironment,
  type EmailTransport,
} from "@/server/email/transport";
import { renderRecoveryEmail } from "@/server/email/templates";
import { appBaseUrl, sendTransactionalEmail } from "@/server/services/email-delivery-service";

/**
 * Entrega do e-mail de recuperacao de senha (ADR-0022).
 *
 * ## Dois modos, escolhidos por variavel explicita
 *
 * - `gotrue` (padrao): o GoTrue gera **e** envia o link. Na stack local isso
 *   termina no Mailpit — deterministico, offline, e a base do E2E.
 * - `elyra`: o servidor pede o link ao GoTrue por `auth.admin.generateLink`
 *   (que **nao** envia nada) e a Elyra envia pela Brevo. E o unico caminho de
 *   e-mail real que funciona com a stack local, onde o SMTP do GoTrue nao tem
 *   opt-in seguro (L-252).
 *
 * Valor desconhecido vale `gotrue`: o modo que nao depende de rede nem de
 * segredo e o lado seguro de um erro de digitacao.
 *
 * ## O que nunca sai daqui
 *
 * Nem o endereco, nem o `hashed_token`, nem o link. O log so carrega o desfecho
 * em rotulo fechado. Quem chama tambem nao recebe o desfecho de volta para a
 * tela: a resposta da pagina e sempre a mesma (anti-enumeracao).
 */
export const RECOVERY_DELIVERY_MODES = ["gotrue", "elyra"] as const;
export type RecoveryDeliveryMode = (typeof RECOVERY_DELIVERY_MODES)[number];

export function recoveryDeliveryMode(env: EmailEnvironment = process.env): RecoveryDeliveryMode {
  return env.ELYRA_RECOVERY_DELIVERY?.trim() === "elyra" ? "elyra" : "gotrue";
}

/** Caminho interno de confirmacao. Fixo em codigo; o token vai na query. */
export const RECOVERY_CONFIRM_PATH = "/redefinir-senha/confirmar";

/**
 * Formato do `hashed_token` do GoTrue: hexadecimal. Medido na versao instalada
 * (56 caracteres); a faixa aceita e larga o bastante para uma troca de algoritmo
 * e estreita o bastante para recusar lixo antes de ir ao GoTrue.
 */
export const RECOVERY_TOKEN_HASH_PATTERN = /^[0-9a-f]{32,128}$/;

export type RecoveryDeliveryOutcome =
  | "sent"
  | "no_account"
  | "unavailable_admin"
  | "unavailable_transport"
  | "unavailable_app_url"
  | "link_failed"
  | "send_failed";

function log(outcome: RecoveryDeliveryOutcome, provider: string, code?: string): void {
  // Rotulos fechados apenas. Nenhum endereco, token, link ou corpo de resposta.
  console.info(
    `elyra.recovery_delivery outcome=${outcome} provider=${provider}${code ? ` code=${code}` : ""}`,
  );
}

export async function deliverRecoveryEmail(
  email: string,
  options: {
    env?: EmailEnvironment;
    admin?: AdminClient | null;
    transport?: EmailTransport | null;
  } = {},
): Promise<RecoveryDeliveryOutcome> {
  const env = options.env ?? process.env;
  const transport = options.transport === undefined ? createEmailTransport(env) : options.transport;
  const provider = transport?.kind ?? "none";

  const baseUrl = appBaseUrl(env);
  if (!baseUrl) {
    log("unavailable_app_url", provider);
    return "unavailable_app_url";
  }
  if (!transport) {
    log("unavailable_transport", provider);
    return "unavailable_transport";
  }
  const admin = options.admin === undefined ? createAdminClient(env) : options.admin;
  if (!admin) {
    log("unavailable_admin", provider);
    return "unavailable_admin";
  }

  let hashedToken: string | undefined;
  try {
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
    if (error) {
      /*
        `user_not_found` e o caso normal de quem digitou um endereco sem conta.
        Nao e falha e nao vira tela diferente; so o log distingue, sem endereco.
      */
      const noAccount = error.status === 404 || error.code === "user_not_found";
      log(noAccount ? "no_account" : "link_failed", provider, noAccount ? undefined : `auth_${error.status ?? "error"}`);
      return noAccount ? "no_account" : "link_failed";
    }
    hashedToken = data?.properties?.hashed_token;
  } catch {
    log("link_failed", provider, "auth_unreachable");
    return "link_failed";
  }

  if (!hashedToken || !RECOVERY_TOKEN_HASH_PATTERN.test(hashedToken)) {
    log("link_failed", provider, "token_shape");
    return "link_failed";
  }

  const confirmUrl = `${baseUrl}${RECOVERY_CONFIRM_PATH}?token_hash=${encodeURIComponent(hashedToken)}`;
  const rendered = renderRecoveryEmail(confirmUrl);
  const result = await sendTransactionalEmail(
    { to: email, subject: rendered.subject, body: rendered.body, html: rendered.html },
    { env, transport },
  );
  if (result.status === "delivered") {
    log("sent", provider);
    return "sent";
  }
  log(
    result.status === "unavailable" ? "unavailable_transport" : "send_failed",
    provider,
    result.status === "failed" ? result.reason : undefined,
  );
  return result.status === "unavailable" ? "unavailable_transport" : "send_failed";
}
