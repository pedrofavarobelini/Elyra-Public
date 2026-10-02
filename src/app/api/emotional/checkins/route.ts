import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { EmotionalRepositoryError } from "@/server/repositories/emotional-repository";
import {
  addEmotionalCheckin,
  editEmotionalCheckin,
  EmotionalServiceError,
} from "@/server/services/emotional-service";

/**
 * Mapeia o erro para resposta, sem revelar o que nao e da pessoa.
 *
 * `P0002` da RPC significa "nao encontrado **ou** nao e seu" - os dois casos
 * chegam iguais aqui de proposito. Responder 404 para um e 403 para o outro
 * contaria que o check-in existe e pertence a outra pessoa.
 */
function errorResponse(error: unknown) {
  if (error instanceof ZodError || error instanceof EmotionalServiceError) {
    const message =
      error instanceof ZodError
        ? (error.issues[0]?.message ?? "Registro inválido.")
        : error.message;
    return Response.json({ error: message }, { status: 400 });
  }
  if (error instanceof EmotionalRepositoryError) {
    if (error.code === "P0002") {
      return Response.json(
        { error: "Check-in não encontrado." },
        { status: 404 },
      );
    }
    return Response.json({ error: "Não foi possível salvar." }, { status: 500 });
  }
  throw error;
}

export async function PATCH(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await editEmotionalCheckin(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await addEmotionalCheckin(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
