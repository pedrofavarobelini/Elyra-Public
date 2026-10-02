import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import { getOpenSlots, getWeekSlots } from "@/server/services/appointment-service";
import { schedulingErrorResponse } from "../response";

/** Horarios livres de um profissional com quem ha vinculo ativo (o banco confere). */
export async function GET(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "schedulingRead",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  const params = new URL(request.url).searchParams;
  try {
    return Response.json(
      {
        data: params.has("week") ? await getWeekSlots(auth.supabase, {
          professionalUserId: params.get("professional") ?? "", weekStart: params.get("week") ?? "",
        }) : await getOpenSlots(auth.supabase, {
          professionalUserId: params.get("professional") ?? "",
          from: params.get("from") ?? "",
          to: params.get("to") ?? "",
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return schedulingErrorResponse(error);
  }
}
