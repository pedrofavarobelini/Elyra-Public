import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getVerifiedProfessionalApiUser } from "@/server/professional-gate";
import {
  getOwnAvailability,
  updateOwnAvailability,
} from "@/server/services/appointment-service";
import { schedulingErrorResponse } from "../response";

export async function GET() {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await getOwnAvailability(auth.supabase, auth.user.id) });
  } catch (error) {
    return schedulingErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "schedulingWrite",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    return Response.json({
      data: await updateOwnAvailability(auth.supabase, auth.user.id, await request.json()),
    });
  } catch (error) {
    return schedulingErrorResponse(error);
  }
}
