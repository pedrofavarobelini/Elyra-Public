import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { CycleRepositoryError } from "@/server/repositories/cycle-repository";
import { addCustomCycleSymptom } from "@/server/services/cycle-service";

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await addCustomCycleSymptom(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Sintoma inválido." },
        { status: 400 },
      );
    }
    if (error instanceof CycleRepositoryError) {
      return Response.json({ error: "Não foi possível criar o sintoma." }, { status: 500 });
    }
    throw error;
  }
}
