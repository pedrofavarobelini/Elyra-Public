import { z } from "zod";


export const HELP_REQUEST_POLICY = {
  maxLength: 1000,
  waitingDays: 7,
  retentionDays: 30,
  perConnectionWaiting: 1,
  perDay: 3,
  attachments: false,
  professionalTextReply: false,
} as const;

export const HELP_REQUEST_STATUSES = ["open", "seen", "responded", "closed", "cancelled", "expired"] as const;
export const helpRequestStatusSchema = z.enum(HELP_REQUEST_STATUSES);
export type HelpRequestStatus = z.infer<typeof helpRequestStatusSchema>;

/** So fatos. Nao existe "assumido", "em atendimento" nem prazo (D-PRO8-5). */
export const HELP_REQUEST_STATUS_LABEL: Record<HelpRequestStatus, string> = {
  open: "Enviado",
  seen: "Lido",
  responded: "Respondido",
  closed: "Encerrado",
  cancelled: "Cancelado",
  expired: "Expirado sem resposta",
};

export const HELP_REQUEST_ACTIONS = ["cancel", "seen", "responded", "close"] as const;
export const helpRequestActionSchema = z.object({ action: z.enum(HELP_REQUEST_ACTIONS) }).strict();
export type HelpRequestAction = (typeof HELP_REQUEST_ACTIONS)[number];

export const helpRequestCreateSchema = z
  .object({
    connectionId: z.string().uuid("Escolha o profissional."),
    body: z
      .string()
      .trim()
      .min(1, "Escreva o seu recado.")
      .max(HELP_REQUEST_POLICY.maxLength, `Use até ${HELP_REQUEST_POLICY.maxLength} caracteres.`),
    idempotencyKey: z.string().uuid(),
  })
  .strict();
export type HelpRequestCreate = z.infer<typeof helpRequestCreateSchema>;

export const helpRequestSchema = z
  .object({
    id: z.string().uuid(),
    connectionId: z.string().uuid(),
    role: z.enum(["client", "professional"]),
    counterpartName: z.string().nullable(),
    status: helpRequestStatusSchema,
    /** `null` depois da retencao: a linha fica, o texto nao. */
    body: z.string().nullable(),
    createdAt: z.string(),
    expiresAt: z.string(),
    seenAt: z.string().nullable(),
    respondedAt: z.string().nullable(),
    endedAt: z.string().nullable(),
  })
  .strict();
export type HelpRequest = z.infer<typeof helpRequestSchema>;

export const helpRequestTargetSchema = z
  .object({
    connectionId: z.string().uuid(),
    professionalName: z.string().nullable(),
    waiting: z.boolean(),
  })
  .strict();
export type HelpRequestTarget = z.infer<typeof helpRequestTargetSchema>;

/** Quem pode o que, por estado (espelho da RPC; o banco decide de verdade). */
export function allowedHelpRequestActions(role: HelpRequest["role"], status: HelpRequestStatus): HelpRequestAction[] {
  if (role === "client") {
    if (status === "open") return ["cancel"];
    if (status === "seen" || status === "responded") return ["close"];
    return [];
  }
  if (status === "open") return ["seen", "responded"];
  if (status === "seen") return ["responded", "close"];
  if (status === "responded") return ["close"];
  return [];
}

export const HELP_REQUEST_ACTION_LABEL: Record<HelpRequestAction, string> = {
  cancel: "Cancelar recado",
  seen: "Marcar como lido",
  responded: "Marcar como respondido",
  close: "Encerrar",
};

/**
 * Limite dito ANTES do campo (D-PRO8-2). Nenhuma frase aqui promete prazo,
 * resposta, acompanhamento continuo ou atendimento de emergencia.
 */
export const HELP_REQUEST_COPY = {
  limitTitle: "Isto não é um canal de emergência",
  limit:
    "Este não é um canal de emergência e não há prazo de resposta. Em risco imediato, use o botão SOS.",
  howItWorks:
    "O profissional vê o seu recado quando abrir a Elyra. Ele pode marcar como lido ou respondido e responder pelo caminho que vocês já usam, como a agenda.",
  retention: `O texto é apagado ${HELP_REQUEST_POLICY.retentionDays} dias depois que o recado termina. Fica só o registro de que ele existiu.`,
  waiting: "Você já tem um recado aguardando com este profissional. Ele pode ser cancelado enquanto não foi lido.",
  noTargets:
    "Para enviar um recado é preciso ter um acompanhamento ativo com um profissional verificado.",
  professionalNote:
    "Recados não têm prazo e não são emergência. Marcar como respondido avisa a pessoa, sem texto: a resposta acontece pelo caminho que vocês já usam.",
} as const;

export const HELP_REQUEST_ERROR_MESSAGE = {
  invalid_request: "Recado inválido.",
  invalid_body: `Escreva entre 1 e ${HELP_REQUEST_POLICY.maxLength} caracteres.`,
  idempotency_mismatch: "Este recado já foi enviado. Recarregue a página.",
  relationship_not_found: "Acompanhamento não encontrado.",
  relationship_inactive: "O acompanhamento não está ativo, então não é possível enviar um recado.",
  professional_unavailable: "Este profissional não está disponível para recados no momento.",
  help_request_waiting: "Você já tem um recado aguardando com este profissional.",
  help_request_limit: `Você pode enviar até ${HELP_REQUEST_POLICY.perDay} recados em 24 horas.`,
  help_request_not_found: "Recado não encontrado.",
  invalid_transition: "Este recado já mudou de situação. Recarregue a página.",
} as const;

export type HelpRequestErrorCode = keyof typeof HELP_REQUEST_ERROR_MESSAGE;

export function isHelpRequestErrorCode(value: unknown): value is HelpRequestErrorCode {
  return typeof value === "string" && value in HELP_REQUEST_ERROR_MESSAGE;
}
