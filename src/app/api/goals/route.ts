import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { GoalsRepositoryError } from "@/server/repositories/goals-repository";
import {
  changeGoalStatus,
  createGoal,
  editGoal,
  GoalNotFoundError,
  GoalsServiceError,
  removeGoal,
} from "@/server/services/goals-service";
import {
  OfflineConflictError,
  conflictResponse,
} from "@/server/services/offline-sync";

function errorResponse(error: unknown) {
  if (error instanceof OfflineConflictError) return conflictResponse(error);
  // Ausencia (ou meta de outra pessoa, invisivel pela RLS) e 404, nunca 500 (L-051).
  if (error instanceof GoalNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ZodError || error instanceof GoalsServiceError) {
    return Response.json(
      {
        error:
          error instanceof ZodError
            ? (error.issues[0]?.message ?? "Meta inválida.")
            : error.message,
      },
      { status: 400 },
    );
  }
  if (error instanceof GoalsRepositoryError) {
    return Response.json({ error: "Não foi possível salvar a meta." }, { status: 500 });
  }
  throw error;
}

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await createGoal(auth.supabase, auth.user, await request.json());
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await changeGoalStatus(auth.supabase, auth.user, await request.json());
    return Response.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await removeGoal(auth.supabase, auth.user, await request.json());
    return Response.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Edicao de titulo, alvo e unidade (PUT: substitui os campos editaveis). */
export async function PUT(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await editGoal(auth.supabase, auth.user, await request.json());
    return Response.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}
