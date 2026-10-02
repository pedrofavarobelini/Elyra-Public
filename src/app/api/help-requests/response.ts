import { ZodError } from "zod";

import { HELP_REQUEST_ERROR_MESSAGE } from "@/lib/contracts/help-requests";
import {
  HelpRequestRepositoryError,
  HelpRequestRuleError,
} from "@/server/repositories/help-request-repository";

/**
 * Traducao de erro dos pedidos de ajuda para HTTP. Codigo estavel + frase fixa
 * do contrato; nunca o texto do pedido, nunca de quem e o pedido.
 */
const STATUS_BY_CODE: Partial<Record<keyof typeof HELP_REQUEST_ERROR_MESSAGE, number>> = {
  help_request_waiting: 409,
  invalid_transition: 409,
  idempotency_mismatch: 409,
  help_request_limit: 429,
  help_request_not_found: 404,
  relationship_not_found: 404,
  relationship_inactive: 403,
  professional_unavailable: 403,
};

export function helpRequestErrorResponse(error: unknown) {
  if (error instanceof SyntaxError) {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }
  if (error instanceof ZodError) {
    return Response.json({ error: error.issues[0]?.message ?? "Pedido inválido." }, { status: 400 });
  }
  if (error instanceof HelpRequestRuleError) {
    return Response.json(
      { error: HELP_REQUEST_ERROR_MESSAGE[error.code], code: error.code },
      { status: STATUS_BY_CODE[error.code] ?? 422 },
    );
  }
  if (error instanceof HelpRequestRepositoryError) {
    const denied = error.code === "42501";
    return Response.json(
      { error: denied ? "Acesso negado." : "Pedidos indisponíveis no momento." },
      { status: denied ? 403 : 500 },
    );
  }
  throw error;
}
