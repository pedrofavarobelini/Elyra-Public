import { consumeRateLimit, rateLimitIdentity, rateLimitedResponse } from "@/lib/security/rate-limit";
import { getVerifiedProfessionalApiUser } from "@/server/professional-gate";
import { getOwnAvailabilityWeek, updateOwnAvailabilityWeek } from "@/server/services/appointment-service";
import { schedulingErrorResponse } from "../../response";


async function handle(request: Request, write: boolean) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(write ? "schedulingWrite" : "schedulingRead", rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")));
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    const params = new URL(request.url).searchParams;
    const data = write ? await updateOwnAvailabilityWeek(auth.supabase, await request.json()) : await getOwnAvailabilityWeek(auth.supabase, {
      weekStart: params.get("week") ?? "", timezone: params.get("timezone") ?? "America/Sao_Paulo",
    });
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return schedulingErrorResponse(error); }
}
export const GET = (request: Request) => handle(request, false);
export const PUT = (request: Request) => handle(request, true);
