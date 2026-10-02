import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import { redeemInvite } from "@/server/services/professional-service";
import { professionalErrorResponse } from "../../response";

/**
 * Resgate de convite pela pessoa convidada.
 *
 * O token chega no **corpo** do `POST`, nunca em query string: URL vai para
 * log de acesso, historico e `Referer`. A resposta de falha e uma so para todo
 * motivo (anti-enumeracao).
 */
export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "professionalInviteRedeem",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    return Response.json(
      { data: await redeemInvite(auth.supabase, await request.json()) },
      { headers: { "cache-control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
