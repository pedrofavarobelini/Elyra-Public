import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import {
  getMyHelpRequests,
  getMyHelpRequestTargets,
  sendHelpRequest,
} from "@/server/services/help-request-service";
import { helpRequestErrorResponse } from "./response";

/** Os pedidos de quem pergunta (nos dois papeis) e para quem ela pode escrever. */
export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const [requests, targets] = await Promise.all([
      getMyHelpRequests(auth.supabase),
      getMyHelpRequestTargets(auth.supabase),
    ]);
    return Response.json({ data: { requests, targets } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return helpRequestErrorResponse(error);
  }
}

/** Enviar. A chave de idempotencia vem do cliente, uma por intencao de envio. */
export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "helpRequestWrite",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    return Response.json(
      { data: await sendHelpRequest(auth.supabase, await request.json()) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return helpRequestErrorResponse(error);
  }
}
