import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { EmotionalRepositoryError } from "@/server/repositories/emotional-repository";
import { saveSleepRecord } from "@/server/services/emotional-service";
import {
  OfflineConflictError,
  conflictResponse,
} from "@/server/services/offline-sync";

export async function PUT(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await saveSleepRecord(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data });
  } catch (error) {
    if (error instanceof OfflineConflictError) return conflictResponse(error);
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Registro de sono inválido." },
        { status: 400 },
      );
    }
    if (error instanceof EmotionalRepositoryError) {
      return Response.json({ error: "Não foi possível salvar." }, { status: 500 });
    }
    throw error;
  }
}
