import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import { updateSessionConsent } from "@/server/services/professional-session-service";
import { NO_STORE, sessionErrorResponse } from "../../response";

/** Consentimento da pessoa acompanhada; o banco recusa qualquer outra conta. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "sessionAccess",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    return Response.json(
      { data: await updateSessionConsent(auth.supabase, (await context.params).id, await request.json()) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return sessionErrorResponse(error);
  }
}
