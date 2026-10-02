import { consumeRateLimit, rateLimitIdentity, rateLimitedResponse } from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import { decideCredential, getCredentialQueue } from "@/server/services/professional-onboarding-service";
import { onboardingErrorResponse } from "../../onboarding/response";

/**
 * Conferencia de credenciais (F5) pelo reviewer. Sem service_role: roda com a
 * sessao do reviewer; o banco exige reviewer ativo, `aal2` e nunca a propria
 * conta, e registra quem decidiu.
 */
export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await getCredentialQueue(auth.supabase) });
  } catch (error) {
    return onboardingErrorResponse(error);
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
    return Response.json({ data: await decideCredential(auth.supabase, await request.json()) }, { status: 201 });
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}
