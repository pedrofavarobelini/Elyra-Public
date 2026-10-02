import { z } from "zod";

import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getVerifiedProfessionalApiUser } from "@/server/professional-gate";
import { removeOwnAvailabilityException } from "@/server/services/appointment-service";
import { schedulingErrorResponse } from "../../../response";

const idSchema = z.string().uuid("Exceção inválida.");

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "schedulingWrite",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    const id = idSchema.parse((await params).id);
    return Response.json({ data: await removeOwnAvailabilityException(auth.supabase, auth.user.id, id) });
  } catch (error) {
    return schedulingErrorResponse(error);
  }
}
