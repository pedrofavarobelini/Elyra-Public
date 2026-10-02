import { z } from "zod";

import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import { applyAppointmentAction } from "@/server/services/appointment-service";
import { schedulingErrorResponse } from "../../response";

const idSchema = z.string().uuid("Horário inválido.");

/** Confirmar, cancelar ou registrar resultado. O banco decide quem pode o que. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "schedulingWrite",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    const id = idSchema.parse((await context.params).id);
    return Response.json({
      data: await applyAppointmentAction(auth.supabase, id, await request.json()),
    });
  } catch (error) {
    return schedulingErrorResponse(error);
  }
}
