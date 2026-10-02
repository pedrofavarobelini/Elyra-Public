import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { EmotionalRepositoryError } from "@/server/repositories/emotional-repository";
import { addCustomEmotionalFactor } from "@/server/services/emotional-service";

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await addCustomEmotionalFactor(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Fator inválido." },
        { status: 400 },
      );
    }
    if (error instanceof EmotionalRepositoryError) {
      return Response.json({ error: "Não foi possível salvar." }, { status: 500 });
    }
    throw error;
  }
}
