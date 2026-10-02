import "server-only";



export const EMAIL_TRANSPORTS = ["local_capture", "mailpit", "brevo"] as const;
export type EmailTransportKind = (typeof EMAIL_TRANSPORTS)[number];

export type EmailEnvironment = Readonly<Record<string, string | undefined>>;

export interface EmailMessage {
  to: string;
  subject: string;
  /** Texto puro — sempre presente, e sempre o conteudo de referencia. */
  body: string;
  /**
   * Versao HTML, opcional.
   *
   * Opcional de proposito: cliente que bloqueia HTML, leitor de tela em modo
   * texto e o proprio `local_capture` continuam recebendo a mensagem inteira em
   * `body`. HTML aqui e apresentacao, nunca o unico lugar onde o conteudo existe.
   */
  html?: string;
}

export interface EmailTransport {
  readonly kind: EmailTransportKind;
  /**
   * Transmite a mensagem.
   *
   * `local_capture` nao transmite nada: o registro ja foi feito por quem chamou,
   * e essa e a captura. Lancar aqui significaria falha real de transporte.
   */
  send(message: EmailMessage): Promise<void>;
}

/**
 * Qual transporte este ambiente declara.
 *
 * A leitura e explicita (`ELYRA_EMAIL_TRANSPORT`), e nao inferida da presenca de
 * outra variavel: inferir faria um ambiente ganhar transporte por efeito
 * colateral de uma configuracao vizinha, que e como um canal desligado vira
 * ligado sem ninguem decidir.
 */
export function emailTransportKind(
  env: EmailEnvironment = process.env,
): EmailTransportKind | null {
  const declared = env.ELYRA_EMAIL_TRANSPORT?.trim();
  if (!declared) return null;
  return (EMAIL_TRANSPORTS as readonly string[]).includes(declared)
    ? (declared as EmailTransportKind)
    : null;
}

/**
 * Ha transporte **e** o que ele precisa para funcionar?
 *
 * Brevo sem chave nao e transporte configurado, e declarar disponibilidade nesse
 * estado colocaria na tela um controle que falharia na primeira entrega.
 */
export function emailDeliveryAvailable(
  env: EmailEnvironment = process.env,
): boolean {
  const kind = emailTransportKind(env);
  if (kind === "local_capture") return true;
  if (kind === "mailpit") return mailpitBaseUrl(env) !== null;
  // Sem remetente verificado a Brevo recusa toda mensagem (400/422): anunciar
  // o canal nesse estado seria prometer uma entrega que falha sempre.
  if (kind === "brevo") {
    return Boolean(env.BREVO_API_KEY?.trim()) && Boolean(env.ELYRA_EMAIL_SENDER_ADDRESS?.trim());
  }
  return false;
}

/**
 * Transporte que so **captura** — nada chega a uma caixa real.
 *
 * O dispatcher usa isto para gravar `captured` em vez de `sent`: dizer que um
 * e-mail foi enviado quando ele parou no Mailpit seria o PASS falso que o
 * CLAUDE.md proibe ("fallback silencioso em QA nunca conta como sucesso").
 */
export function isCaptureTransport(kind: EmailTransportKind): boolean {
  return kind !== "brevo";
}

export const DEFAULT_MAILPIT_URL = "http://127.0.0.1:54384";

/**
 * Endereco do Mailpit, somente loopback.
 *
 * Um valor apontando para fora transformaria o "transporte de QA" num relay
 * sem autenticacao para qualquer host — por isso qualquer coisa diferente de
 * `127.0.0.1`/`localhost` e recusada e o canal fica indisponivel.
 */
export function mailpitBaseUrl(env: EmailEnvironment = process.env): string | null {
  const raw = env.ELYRA_MAILPIT_URL?.trim() || DEFAULT_MAILPIT_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:") return null;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
    return url.origin;
  } catch {
    return null;
  }
}

class LocalCaptureTransport implements EmailTransport {
  readonly kind = "local_capture" as const;

  async send(): Promise<void> {
    /*
      Sem rede, de proposito. A mensagem ja foi registrada em
      `email_deliveries`, e e la que o QA a inspeciona. Abrir uma conexao aqui
      so para descarta-la criaria a impressao de envio real.
    */
  }
}

class MailpitTransport implements EmailTransport {
  readonly kind = "mailpit" as const;

  private readonly baseUrl: string;
  private readonly sender: { name: string; email: string };

  constructor(baseUrl: string, sender: { name: string; email: string }) {
    this.baseUrl = baseUrl;
    this.sender = sender;
  }

  async send(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/v1/send`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          From: { Email: this.sender.email, Name: this.sender.name },
          To: [{ Email: message.to }],
          Subject: message.subject,
          Text: message.body,
          ...(message.html ? { HTML: message.html } : {}),
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (cause) {
      const timeout = cause instanceof Error && cause.name === "TimeoutError";
      throw new EmailTransportError(timeout ? "timeout" : "network_error");
    }
    if (!response.ok) throw new EmailTransportError(`http_${response.status}`);
  }
}

export class EmailTransportError extends Error {
  /** Codigo curto e ja sanitizado (`http_429`, `timeout`) — nunca corpo de resposta. */
  readonly reason: string;

  constructor(reason: string) {
    super("email_transport_failed");
    this.name = "EmailTransportError";
    this.reason = reason;
  }
}

class BrevoTransport implements EmailTransport {
  readonly kind = "brevo" as const;

  /*
    Campos declarados e atribuidos no corpo, e nao parametros-propriedade do
    TypeScript: `node --experimental-strip-types` (que e como os scripts de QA
    carregam este modulo) recusa aquela forma com
    `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, porque ela gera codigo em vez de so
    apagar tipos. Medido ao ligar o `scripts/brevo-check.mjs`.
  */
  private readonly apiKey: string;
  private readonly sender: { name: string; email: string };

  constructor(apiKey: string, sender: { name: string; email: string }) {
    this.apiKey = apiKey;
    this.sender = sender;
  }

  async send(message: EmailMessage): Promise<void> {
    let response: Response;
    try {
      response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          sender: this.sender,
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.body,
          ...(message.html ? { htmlContent: message.html } : {}),
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (cause) {
      /*
        Sem resposta, o desfecho e **desconhecido**, e nao "falhou": a requisicao
        pode ter chegado e a mensagem pode ter saido. Quem classifica usa isto
        para NAO repetir — repetir aqui e como duplicar e-mail na caixa de alguem.
        O motivo sai em codigo curto; a mensagem original pode carregar URL e host.
      */
      const timeout = cause instanceof Error && cause.name === "TimeoutError";
      throw new EmailTransportError(timeout ? "timeout" : "network_error");
    }

    if (!response.ok) {
      /*
        O corpo da resposta **nao** entra no erro nem no log: ele pode ecoar o
        endereco de destino, e endereco de destino e dado pessoal.
      */
      throw new EmailTransportError(`http_${response.status}`);
    }
  }
}

export function createEmailTransport(
  env: EmailEnvironment = process.env,
): EmailTransport | null {
  const kind = emailTransportKind(env);
  if (kind === "local_capture") return new LocalCaptureTransport();
  if (kind === "mailpit") {
    const baseUrl = mailpitBaseUrl(env);
    if (!baseUrl) return null;
    return new MailpitTransport(baseUrl, {
      name: env.ELYRA_EMAIL_SENDER_NAME?.trim() || "Elyra",
      email: env.ELYRA_EMAIL_SENDER_ADDRESS?.trim() || "nao-responda@elyra.invalid",
    });
  }
  if (kind === "brevo") {
    const apiKey = env.BREVO_API_KEY?.trim();
    if (!apiKey) return null;
    return new BrevoTransport(apiKey, {
      name: env.ELYRA_EMAIL_SENDER_NAME?.trim() || "Elyra",
      email: env.ELYRA_EMAIL_SENDER_ADDRESS?.trim() || "",
    });
  }
  return null;
}
