import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import {
  createAppointmentRequest,
  getMyAppointments,
} from "@/server/services/appointment-service";
import { schedulingErrorResponse } from "../response";

export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json(
      { data: await getMyAppointments(auth.supabase) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return schedulingErrorResponse(error);
  }
}

/**
 * Pedido de horario. A chave de idempotencia vem do cliente (uma por intencao);
 * repetir o mesmo corpo devolve o mesmo id, com 200 em vez de 201 nao sendo
 * distinguivel aqui — o banco decide e a resposta e sempre o id vigente.
 */
export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "schedulingWrite",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    return Response.json(
      { data: await createAppointmentRequest(auth.supabase, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return schedulingErrorResponse(error);
  }
}
