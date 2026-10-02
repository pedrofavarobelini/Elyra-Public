import "server-only";



export const EMAIL_FAILURE = {
  TRANSIENT: "TRANSIENT_FAILURE",
  PERMANENT: "PERMANENT_FAILURE",
  UNKNOWN_DELIVERY: "UNKNOWN_DELIVERY",
  CONFIGURATION_MISSING: "CONFIGURATION_MISSING",
} as const;

export type EmailFailureClass =
  (typeof EMAIL_FAILURE)[keyof typeof EMAIL_FAILURE];

/**
 * Codigos HTTP que o provedor usa para dizer "agora nao" — e nada mais.
 *
 * `408` e `429` sao pedido explicito de espera. Os `5xx` listados sao falha do
 * lado dele. Um `5xx` **com resposta recebida** e seguro de repetir: o provedor
 * declarou que nao processou.
 */
const TRANSIENTES = new Set([408, 429, 500, 502, 503, 504]);

/** Extrai o status de um `reason` no formato `http_<codigo>`. */
export function statusDoReason(reason: string): number | null {
  const match = /^http_(\d{3})$/.exec(reason);
  return match ? Number(match[1]) : null;
}

/**
 * Classifica o motivo de falha devolvido pelo transporte.
 *
 * `network_error` e `timeout` viram `UNKNOWN_DELIVERY`, e nao `TRANSIENT`: sem
 * resposta do provedor, ninguem pode afirmar que a mensagem **nao** saiu.
 */
export function classificarFalha(reason: string): EmailFailureClass {
  if (reason === "configuration_missing") return EMAIL_FAILURE.CONFIGURATION_MISSING;
  if (reason === "timeout" || reason === "network_error") {
    return EMAIL_FAILURE.UNKNOWN_DELIVERY;
  }
  const status = statusDoReason(reason);
  if (status === null) return EMAIL_FAILURE.PERMANENT;
  return TRANSIENTES.has(status)
    ? EMAIL_FAILURE.TRANSIENT
    : EMAIL_FAILURE.PERMANENT;
}

/** Só `TRANSIENT_FAILURE` pode ser repetido. */
export function podeRepetir(classe: EmailFailureClass): boolean {
  return classe === EMAIL_FAILURE.TRANSIENT;
}

/** Tentativas totais (a primeira mais duas repeticoes). */
export const MAX_TENTATIVAS = 3;

/**
 * Espera antes da proxima tentativa: 200 ms, 400 ms — teto curto, de proposito.
 *
 * Isto roda **dentro** da requisicao que originou o envio. Uma espera longa aqui
 * seguraria a acao da pessoa para resolver um problema do provedor, o que inverte
 * a prioridade: a acao principal nunca pode depender do e-mail. Retry longo e
 * trabalho de agendador, e o agendador ainda nao existe (declarado no servico).
 */
export function esperaMs(tentativa: number): number {
  return 200 * 2 ** (tentativa - 1);
}

/** A tentativa `n` ainda existe? */
export function haProximaTentativa(tentativa: number): boolean {
  return tentativa < MAX_TENTATIVAS;
}

/**
 * Linha de log de entrega — sanitizada na origem.
 *
 * Nao aceita destinatario, assunto, corpo, chave nem token: o tipo simplesmente
 * nao tem esses campos. Sanitizar na hora de imprimir depende de alguem lembrar;
 * sanitizar no formato torna o vazamento impossivel de escrever sem querer.
 */
export interface EmailLogLine {
  event: string;
  provider: string;
  status: string;
  /** Codigo curto ja sanitizado (`http_429`, `timeout`), nunca corpo de resposta. */
  code?: string;
  attempt?: number;
  correlationId?: string;
}

/** Codigo aceitavel em log: so o formato curto que o transporte produz. */
const CODIGO_SEGURO = /^[a-z0-9_]{1,40}$/;

export function formatarLogEntrega(linha: EmailLogLine): string {
  const partes = [
    `email_delivery event=${linha.event}`,
    `provider=${linha.provider}`,
    `status=${linha.status}`,
  ];
  if (linha.code) {
    // Codigo fora do formato curto e descartado: e sinal de que alguem tentou
    // passar mensagem do provedor, que pode ecoar o endereco de destino.
    partes.push(`code=${CODIGO_SEGURO.test(linha.code) ? linha.code : "sanitized"}`);
  }
  if (linha.attempt !== undefined) partes.push(`attempt=${linha.attempt}`);
  if (linha.correlationId) partes.push(`correlation=${linha.correlationId}`);
  return partes.join(" ");
}
