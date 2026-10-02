import { z } from "zod";



export const INVITE_CODE_PREFIX = "ELY";
export const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_CODE_SYMBOLS = 10;
/** 10 simbolos x log2(32) = 50 bits de CSPRNG. */
export const INVITE_CODE_ENTROPY_BITS = INVITE_CODE_SYMBOLS * Math.log2(INVITE_CODE_ALPHABET.length);

/** Forma canonica exibida e digerida pelo banco. */
export const INVITE_CODE_PATTERN = /^ELY-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

/**
 * Transicao (PRO-2): token longo de 43 caracteres base64url, 256 bits.
 * Continua aceito ate o ultimo expirar (72 h); nenhum e mais gerado.
 */
export const LEGACY_INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Mensagem unica para entrada que nao e um codigo. Nunca diz o que falta. */
export const INVITE_CODE_INPUT_ERROR = "Confira o código informado.";

/**
 * Normaliza o que a pessoa digitou ou colou.
 *
 * - espacos nas pontas, caixa, hifen/espaco como separador e o prefixo `ELY`
 *   opcional nao importam;
 * - `O`, `I` e `L` nao existem no alfabeto e sao lidos como `0`, `1`, `1`
 *   (regra Crockford): a correcao so toca glifos que nenhum codigo contem, entao
 *   um codigo valido nunca vira outro;
 * - `U` ou qualquer outro simbolo invalida (`null`).
 *
 * O banco repete exatamente esta regra (`professional_invite_lookup_digest`).
 */
export function normalizeInviteCode(input: string): string | null {
  const trimmed = input.trim();
  if (LEGACY_INVITE_TOKEN_PATTERN.test(trimmed)) return trimmed;
  if (trimmed.length > 32) return null;
  let compact = trimmed.replace(/[\s-]/g, "").toUpperCase();
  if (compact.length === 13 && compact.startsWith(INVITE_CODE_PREFIX)) compact = compact.slice(3);
  compact = compact.replace(/O/g, "0").replace(/[IL]/g, "1");
  if (!/^[0-9A-HJKMNP-TV-Z]{10}$/.test(compact)) return null;
  return `${INVITE_CODE_PREFIX}-${compact.slice(0, 5)}-${compact.slice(5)}`;
}

export function isShortInviteCode(value: string): boolean {
  return INVITE_CODE_PATTERN.test(value);
}

export const inviteTokenSchema = z
  .string()
  .max(64, INVITE_CODE_INPUT_ERROR)
  .transform((value, context) => {
    const normalized = normalizeInviteCode(value);
    if (!normalized) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: INVITE_CODE_INPUT_ERROR });
      return z.NEVER;
    }
    return normalized;
  });

export const inviteRedeemInputSchema = z
  .object({
    token: inviteTokenSchema,
    action: z.enum(["preview", "accept", "decline"]),
  })
  .strict();

export type InviteRedeemInput = z.infer<typeof inviteRedeemInputSchema>;

export const INVITE_STATES = [
  "created",
  "opened",
  "accepted",
  "consumed",
  "revoked",
  "expired",
] as const;

export type InviteState = (typeof INVITE_STATES)[number];

/**
 * Rotulos da interface. `consumed` e o estado interno de "recusado"; `revoked`
 * aparece como "Cancelado" porque "revogar" fica reservado para permissao.
 */
export const INVITE_STATE_LABEL: Record<InviteState, string> = {
  created: "Em aberto",
  opened: "Em aberto",
  accepted: "Aceito",
  consumed: "Recusado",
  revoked: "Cancelado",
  expired: "Expirado",
};

/** Validade decidida no banco (72 h). Exposta so para texto de interface. */
export const INVITE_TTL_HOURS = 72;

/** Resultado do aceite, decidido pelo banco (`accept_professional_invite_code`). */
export const INVITE_ACCEPT_OUTCOMES = [
  "created",
  "activated",
  "already_active",
  "already_paused",
  "already_accepted",
] as const;
export type InviteAcceptOutcome = (typeof INVITE_ACCEPT_OUTCOMES)[number];

/**
 * Frase principal depois do aceite. Nunca diz "criado" quando nada foi criado,
 * e sempre lembra que nada foi compartilhado por aceitar.
 */
export function inviteAcceptedMessage(
  outcome: InviteAcceptOutcome,
  status: string,
  professionalName: string,
): string {
  if (status === "paused") {
    return `Seu vínculo com ${professionalName} continua pausado. Nada foi compartilhado.`;
  }
  if (status !== "active") {
    return "Você já usou este convite, e o vínculo não está ativo.";
  }
  if (outcome === "already_active") {
    return `Você já estava conectado com ${professionalName}. Nada mudou no que é compartilhado.`;
  }
  return `Você está conectado com ${professionalName}. Nada foi compartilhado.`;
}

/**
 * Link de convite. O codigo vai no **fragmento** (`#`), que o navegador nunca
 * envia ao servidor nem coloca em `Referer`: ele nao aparece em log de acesso,
 * proxy ou analytics.
 */
export function inviteLink(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/convite#${token}`;
}

/** Le o codigo do fragmento; qualquer outra coisa e ignorada. */
export function tokenFromHash(hash: string): string | null {
  let candidate = hash.replace(/^#/, "");
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return null;
  }
  return normalizeInviteCode(candidate);
}
