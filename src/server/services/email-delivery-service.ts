import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { NotificationKind } from "@/lib/contracts/notifications";
import type { Database } from "@/lib/supabase/database.types";
import {
  EmailTransportError,
  createEmailTransport,
  emailDeliveryAvailable,
  type EmailEnvironment,
  type EmailMessage,
  type EmailTransport,
} from "@/server/email/transport";
import { EMAIL_TEMPLATES, renderEmailMessage } from "@/server/email/templates";
import {
  EMAIL_FAILURE,
  MAX_TENTATIVAS,
  classificarFalha,
  esperaMs,
  formatarLogEntrega,
  haProximaTentativa,
  podeRepetir,
  type EmailFailureClass,
  type EmailLogLine,
} from "@/server/email/failure";

/**
 * Log de entrega, sanitizado pelo formato.
 *
 * `formatarLogEntrega` nao aceita destinatario, assunto, corpo nem chave — os
 * campos nao existem no tipo. Vazamento aqui teria de ser deliberado.
 */
function log(linha: EmailLogLine): void {
  console.info(formatarLogEntrega(linha));
}

type Client = SupabaseClient<Database>;

/**
 * Entrega de e-mail: a regra de produto, sem conhecer o provedor.
 *
 * ## As duas intencoes, que nao se misturam
 *
 * - **Transacional** — confirmacao de conta, recuperacao de senha, seguranca.
 *   Nao consulta preferencia: desligar aviso de engajamento nao pode impedir
 *   alguem de recuperar a propria conta. Hoje esses e-mails sao do GoTrue, e
 *   `sendTransactionalEmail` existe para o que vier depois, ja pelo caminho
 *   certo.
 * - **Engajamento** — os quatro tipos da matriz. Passa por preferencia,
 *   adiamento e teto de frequencia, todos aplicados **no banco**.
 *
 * ## Quem pode chamar isto
 *
 * As RPCs `enqueue_notification_email` e `settle_notification_email` sao
 * **`service_role`** desde o 23-E (`F-23E-01`). Um cliente com a sessao da
 * pessoa recebe permissao negada, e isso e deliberado: entrega de engajamento e
 * acao iniciada pelo sistema — quem decide mandar o resumo semanal e um
 * agendador que age por muitos titulares, fora de qualquer sessao.
 *
 * O agendador ainda **nao existe**. Ate ele existir, este servico nao tem
 * chamador em producao, e a nota esta aqui para que a proxima pessoa nao gaste
 * uma tarde depurando um erro de permissao que e a resposta correta.
 *
 * ## Por que a decisao vive na RPC, e nao aqui
 *
 * `enqueue_notification_email` consulta `notification_channel_delivers`, a mesma
 * funcao que o in-app usa, e colide no `unique (user_id, event_key)` quando a
 * janela ja foi entregue. Reimplementar essas checagens em TypeScript criaria
 * uma segunda autoridade sobre "esta pessoa quer isto agora?" — e duas
 * autoridades divergem no primeiro caso de borda, que aqui significa e-mail para
 * quem pediu silencio.
 */

/** O que falta para este ambiente conseguir entregar. */
export type EmailConfigGap = "transport_missing" | "app_url_missing";

export type EmailDeliveryOutcome =
  /**
   * `CONFIGURATION_MISSING`: nem chegamos a tentar.
   *
   * O motivo e explicito porque "indisponivel" sozinho manda a proxima pessoa
   * caçar entre duas configuracoes diferentes qual delas falta.
   */
  | { status: "unavailable"; reason: EmailConfigGap }
  /** Desligado, adiado, ou a janela ja foi entregue. Nao e erro. */
  | { status: "suppressed" }
  | { status: "delivered"; deliveryId: string; attempts: number }
  | {
      status: "failed";
      deliveryId: string;
      reason: string;
      failureClass: EmailFailureClass;
      attempts: number;
    };

/**
 * Endereco publico do produto, para o convite do e-mail.
 *
 * Vem de variavel, e nao do cabecalho da requisicao, porque quem manda e-mail de
 * engajamento e um agendador: ali nao existe requisicao nenhuma de onde tirar
 * origem. Sem a variavel, a entrega e recusada em vez de montar um link quebrado —
 * e-mail com link errado e pior do que e-mail que nao saiu.
 */
export function appBaseUrl(env: EmailEnvironment = process.env): string | null {
  const raw = env.ELYRA_PUBLIC_APP_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:"
      ? raw.replace(/\/+$/, "")
      : null;
  } catch {
    return null;
  }
}

/** A janela do aviso, embutida na chave — igual a `notifications`. */
export function emailEventKey(kind: NotificationKind, now: Date): string {
  if (kind === "weekly_digest") {
    const target = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    // Quinta-feira da semana ISO define o ano da semana.
    const day = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const week = Math.ceil(
      ((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7,
    );
    const year = target.getUTCFullYear();
    return `weekly_digest:${year}-W${String(week).padStart(2, "0")}`;
  }
  return `${kind}:${now.toISOString().slice(0, 10)}`;
}

export async function sendNotificationEmail(
  client: Client,
  recipient: { email: string },
  kind: NotificationKind,
  options: {
    now?: Date;
    env?: EmailEnvironment;
    transport?: EmailTransport;
    /** Espera entre tentativas. Injetavel para o teste nao dormir de verdade. */
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<EmailDeliveryOutcome> {
  const env = options.env ?? process.env;
  if (!emailDeliveryAvailable(env)) {
    return { status: "unavailable", reason: "transport_missing" };
  }

  const transport = options.transport ?? createEmailTransport(env);
  if (!transport) return { status: "unavailable", reason: "transport_missing" };

  const baseUrl = appBaseUrl(env);
  if (!baseUrl) return { status: "unavailable", reason: "app_url_missing" };

  const template = EMAIL_TEMPLATES[kind];
  const rendered = renderEmailMessage(kind, baseUrl);
  const eventKey = emailEventKey(kind, options.now ?? new Date());

  const { data: deliveryId, error } = await client.rpc(
    "enqueue_notification_email",
    {
      p_kind: kind,
      p_event_key: eventKey,
      p_transport: transport.kind,
      p_subject: template.subject,
      p_body: template.body,
    },
  );

  /*
    Erro da RPC nao vira "suprimido": suprimir e uma decisao da pessoa, e uma
    falha de banco nao pode se disfarcar dela. Sem `deliveryId` nao ha o que
    liquidar, entao o desfecho e falha sem id.
  */
  if (error) {
    return {
      status: "failed",
      deliveryId: "",
      reason: "enqueue_failed",
      failureClass: EMAIL_FAILURE.PERMANENT,
      attempts: 0,
    };
  }
  if (!deliveryId) return { status: "suppressed" };

  const message: EmailMessage = {
    to: recipient.email,
    subject: rendered.subject,
    body: rendered.body,
    html: rendered.html,
  };

  /*
    Retry so do que e seguro repetir. `classificarFalha` separa tres coisas que
    parecem a mesma: "tente de novo" (429/5xx), "nao adianta" (4xx de conta ou
    remetente) e "nao sei se saiu" (timeout, conexao cortada). A terceira **nao**
    e repetida, mesmo sendo transitoria na aparencia — repetir ali duplicaria
    e-mail na caixa de alguem, e duplicata e o erro que a pessoa percebe.
  */
  let tentativa = 0;
  let ultimoMotivo = "transport_error";
  let ultimaClasse: EmailFailureClass = EMAIL_FAILURE.PERMANENT;

  while (tentativa < MAX_TENTATIVAS) {
    tentativa += 1;
    try {
      await transport.send(message);
      /*
        `p_failure_code` e omitido, e nao enviado como `null`: o argumento tem
        default no banco, e sucesso nao tem codigo de falha para declarar.
      */
      await client.rpc("settle_notification_email", {
        p_delivery_id: deliveryId,
        p_succeeded: true,
      });
      log({
        event: kind,
        provider: transport.kind,
        status: "delivered",
        attempt: tentativa,
        correlationId: deliveryId,
      });
      return { status: "delivered", deliveryId, attempts: tentativa };
    } catch (cause) {
      ultimoMotivo =
        cause instanceof EmailTransportError ? cause.reason : "transport_error";
      ultimaClasse = classificarFalha(ultimoMotivo);
      log({
        event: kind,
        provider: transport.kind,
        status: ultimaClasse,
        code: ultimoMotivo,
        attempt: tentativa,
        correlationId: deliveryId,
      });
      if (!podeRepetir(ultimaClasse) || !haProximaTentativa(tentativa)) break;
      const espera = esperaMs(tentativa);
      /*
        Ramo explicito, e nao `await sleep?.(x) ?? await dormir(x)`: aquela forma
        avalia o lado direito sempre que o esquerdo resolve `undefined` — que e o
        caso de toda funcao `Promise<void>`. O teste injetaria o proprio sleep e
        dormiria de verdade do mesmo jeito.
      */
      if (options.sleep) await options.sleep(espera);
      else await new Promise((resolve) => setTimeout(resolve, espera));
    }
  }

  // Falha nao carimba entrega: a linha volta a poder ser tentada na mesma
  // janela, em vez de o `unique` recusar a segunda tentativa legitima.
  await client.rpc("settle_notification_email", {
    p_delivery_id: deliveryId,
    p_succeeded: false,
    p_failure_code: ultimoMotivo,
  });
  return {
    status: "failed",
    deliveryId,
    reason: ultimoMotivo,
    failureClass: ultimaClasse,
    attempts: tentativa,
  };
}

/**
 * E-mail necessario ao funcionamento da conta.
 *
 * **Nao** consulta `notification_preferences`, e a omissao e a regra: quem
 * desligou lembrete de metas nao abriu mao de conseguir recuperar a propria
 * senha. Confirmacao e recuperacao continuam sendo do GoTrue; esta funcao existe
 * para o e-mail transacional que a Elyra vier a enviar por conta propria, ja
 * separado do engajamento desde o primeiro dia.
 */
export async function sendTransactionalEmail(
  message: EmailMessage,
  options: { env?: EmailEnvironment; transport?: EmailTransport } = {},
): Promise<{ status: "delivered" } | { status: "unavailable" } | { status: "failed"; reason: string }> {
  const env = options.env ?? process.env;
  const transport = options.transport ?? createEmailTransport(env);
  if (!transport) return { status: "unavailable" };

  try {
    await transport.send(message);
    return { status: "delivered" };
  } catch (cause) {
    return {
      status: "failed",
      reason:
        cause instanceof EmailTransportError ? cause.reason : "transport_error",
    };
  }
}
