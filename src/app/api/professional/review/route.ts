import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import {
  decideVerification,
  getVerificationQueue,
} from "@/server/services/professional-service";
import { professionalErrorResponse } from "../response";

/**
 * Fila e decisao de verificacao profissional (reviewer).
 *
 * A autorizacao e do PostgreSQL: reviewer ativo em `professional_reviewers`,
 * sessao `aal2` e nunca a propria conta. Esta rota nao usa `service_role` - a
 * decisao roda com a sessao do reviewer, e a RPC registra quem decidiu.
 */
export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await getVerificationQueue(auth.supabase, auth.user) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "professionalReview",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    return Response.json(
      { data: await decideVerification(auth.supabase, auth.user, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
