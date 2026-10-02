import { ZodError } from "zod";

import { SCHEDULING_ERROR_MESSAGE } from "@/lib/contracts/scheduling";
import {
  SchedulingRepositoryError,
  SchedulingRuleError,
} from "@/server/repositories/scheduling-repository";

/**
 * Traducao de erro da agenda para HTTP.
 *
 * Regra de negocio recusada pelo banco vira 409 (conflito/estado) ou 422
 * (pedido bem formado fora da regra), com codigo estavel e frase fixa do
 * contrato. Recusa de acesso vira 403/404 sem dizer de quem e o horario.
 */
const STATUS_BY_CODE: Partial<Record<keyof typeof SCHEDULING_ERROR_MESSAGE, number>> = {
  slot_unavailable: 409,
  invalid_transition: 409,
  idempotency_mismatch: 409,
  week_changed: 409,
  appointment_not_found: 404,
  exception_not_found: 404,
  relationship_not_found: 404,
  verification_required: 403,
  relationship_inactive: 403,
  professional_unavailable: 403,
};

export function schedulingErrorResponse(error: unknown) {
  if (error instanceof SyntaxError) {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Dados da agenda inválidos." },
      { status: 400 },
    );
  }
  if (error instanceof SchedulingRuleError) {
    return Response.json(
      { error: SCHEDULING_ERROR_MESSAGE[error.code], code: error.code },
      { status: STATUS_BY_CODE[error.code] ?? 422 },
    );
  }
  if (error instanceof SchedulingRepositoryError) {
    const denied = error.code === "42501";
    return Response.json(
      { error: denied ? "Acesso negado." : "Agenda indisponível no momento." },
      { status: denied ? 403 : 500 },
    );
  }
  throw error;
}
