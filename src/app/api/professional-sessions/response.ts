import { ZodError } from "zod";

import { SESSION_ERROR_MESSAGE } from "@/lib/contracts/professional-sessions";
import {
  SessionRepositoryError,
  SessionRuleError,
} from "@/server/repositories/professional-session-repository";

const STATUS: Partial<Record<keyof typeof SESSION_ERROR_MESSAGE, number>> = {
  session_not_found: 404,
  not_found: 404,
  session_closed: 409,
  invalid_transition: 409,
  credential_invalid: 409,
  verification_required: 403,
  relationship_inactive: 403,
  rate_limited: 429,
};

/** Toda resposta de sessao e `no-store`: nada de sessao em cache, nunca. */
export const NO_STORE = { "Cache-Control": "no-store, max-age=0", Pragma: "no-cache" } as const;

export function sessionErrorResponse(error: unknown) {
  if (error instanceof SyntaxError) {
    return Response.json({ error: "Pedido inválido." }, { status: 400, headers: NO_STORE });
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Pedido inválido." },
      { status: 400, headers: NO_STORE },
    );
  }
  if (error instanceof SessionRuleError) {
    return Response.json(
      { error: SESSION_ERROR_MESSAGE[error.code], code: error.code },
      { status: STATUS[error.code] ?? 422, headers: NO_STORE },
    );
  }
  if (error instanceof SessionRepositoryError) {
    const denied = error.code === "42501";
    return Response.json(
      { error: denied ? "Acesso negado." : "Sessão indisponível no momento." },
      { status: denied ? 403 : 500, headers: NO_STORE },
    );
  }
  throw error;
}
