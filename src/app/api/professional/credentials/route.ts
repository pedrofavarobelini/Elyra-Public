import { z } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { addCredential, editCredential, removeCredential } from "@/server/services/professional-onboarding-service";
import { onboardingErrorResponse } from "../onboarding/response";

/** Formacao, experiencia e certificacoes declaradas (F2/F5). So as proprias. */
const idSchema = z.string().uuid();

function idFrom(request: Request) {
  return idSchema.parse(new URL(request.url).searchParams.get("id"));
}

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await addCredential(auth.supabase, auth.user, await request.json()) }, { status: 201 });
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await editCredential(auth.supabase, idFrom(request), await request.json()) });
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    await removeCredential(auth.supabase, idFrom(request));
    return new Response(null, { status: 204 });
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}
