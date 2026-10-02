import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { IdentityRepositoryError } from "@/server/repositories/identity-repository";
import { updateProfile } from "@/server/services/identity-service";

export async function PATCH(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const { supabase, user } = auth;
  try {
    const profile = await updateProfile(supabase, user, await request.json());
    return Response.json({ data: profile });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Dados inválidos." },
        { status: 400 },
      );
    }
    if (error instanceof IdentityRepositoryError) {
      return Response.json({ error: "Não foi possível salvar." }, { status: 500 });
    }
    throw error;
  }
}
