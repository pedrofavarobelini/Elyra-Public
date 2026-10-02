import { consumeRateLimit, rateLimitedResponse, rateLimitIdentity } from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import {
  getProfessionalArea,
  saveOnboardingStep,
  submitProfessionalOnboarding,
} from "@/server/services/professional-onboarding-service";
import { onboardingErrorResponse } from "./response";

/**
 * Onboarding profissional (F2). Mesma conta, sem portao de VERIFIED: e o
 * caminho para chegar la. Cada escrita e da propria conta (RLS).
 */
export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const area = await getProfessionalArea(auth.supabase, auth.user);
    return Response.json({ data: { state: area.state, onboarding: area.onboarding, credentials: area.credentials } });
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await saveOnboardingStep(auth.supabase, auth.user, await request.json()) });
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}

export async function POST() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const budget = consumeRateLimit("professionalOnboardingSubmit", rateLimitIdentity(auth.user.id, null));
  if (!budget.allowed) return rateLimitedResponse(budget);
  try {
    return Response.json({ data: await submitProfessionalOnboarding(auth.supabase, auth.user) });
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}
