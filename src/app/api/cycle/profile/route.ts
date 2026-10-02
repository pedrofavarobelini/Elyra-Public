import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { CycleRepositoryError } from "@/server/repositories/cycle-repository";
import { changeCycleEnabled } from "@/server/services/cycle-service";

export async function PATCH(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await changeCycleEnabled(auth.supabase, await request.json());
    return Response.json({ data });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Preferência de ciclo inválida." },
        { status: 400 },
      );
    }
    if (error instanceof CycleRepositoryError) {
      return Response.json(
        { error: "Não foi possível atualizar o acompanhamento do ciclo." },
        { status: 500 },
      );
    }
    throw error;
  }
}
