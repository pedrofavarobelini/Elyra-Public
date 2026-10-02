import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { CycleRepositoryError } from "@/server/repositories/cycle-repository";
import {
  CycleNotFoundError,
  CycleServiceError,
  deleteCycleDailyRecord,
  saveCycleDailyRecord,
} from "@/server/services/cycle-service";
import {
  OfflineConflictError,
  conflictResponse,
} from "@/server/services/offline-sync";

function errorResponse(error: unknown) {
  if (error instanceof OfflineConflictError) return conflictResponse(error);
  // Ausencia (ou linha de outra pessoa, invisivel pela RLS) e 404, nunca 500 (L-051).
  if (error instanceof CycleNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ZodError || error instanceof CycleServiceError) {
    return Response.json(
      {
        error:
          error instanceof ZodError
            ? (error.issues[0]?.message ?? "Registro do ciclo inválido.")
            : error.message,
      },
      { status: 400 },
    );
  }
  if (error instanceof CycleRepositoryError) {
    return Response.json(
      { error: "Não foi possível salvar o registro do ciclo." },
      { status: 500 },
    );
  }
  throw error;
}

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await saveCycleDailyRecord(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await deleteCycleDailyRecord(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}
