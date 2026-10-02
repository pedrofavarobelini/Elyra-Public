import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getVerifiedProfessionalApiUser } from "@/server/professional-gate";
import {
  createOwnAvailabilityException,
  getOwnAvailabilityExceptions,
} from "@/server/services/appointment-service";
import { schedulingErrorResponse } from "../../response";

/** Excecoes da agenda (UX F6): aberturas e bloqueios do proprio profissional. */
export async function GET() {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await getOwnAvailabilityExceptions(auth.supabase, auth.user.id) });
  } catch (error) {
    return schedulingErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "schedulingWrite",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    return Response.json(
      { data: await createOwnAvailabilityException(auth.supabase, auth.user.id, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return schedulingErrorResponse(error);
  }
}
