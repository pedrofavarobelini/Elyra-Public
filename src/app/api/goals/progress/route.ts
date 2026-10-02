import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { GoalsRepositoryError } from "@/server/repositories/goals-repository";
import {
  addGoalProgress,
  GoalsServiceError,
} from "@/server/services/goals-service";

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await addGoalProgress(auth.supabase, auth.user, await request.json());
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError || error instanceof GoalsServiceError) {
      return Response.json(
        {
          error:
            error instanceof ZodError
              ? (error.issues[0]?.message ?? "Progresso inválido.")
              : error.message,
        },
        { status: 400 },
      );
    }
    if (error instanceof GoalsRepositoryError) {
      return Response.json({ error: "Não foi possível registrar o progresso." }, { status: 500 });
    }
    throw error;
  }
}
