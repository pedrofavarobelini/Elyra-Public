import { ZodError } from "zod";

import { traceMutation } from "@/lib/observability/mutation-trace";
import { getConsentedApiUser } from "@/server/auth";
import { JournalRepositoryError } from "@/server/repositories/journal-repository";
import {
  changeJournalTrashState,
  JournalEntryNotFoundError,
  JournalServiceError,
  permanentlyDeleteJournalEntry,
  saveJournalEntry,
} from "@/server/services/journal-service";
import {
  OfflineConflictError,
  conflictResponse,
} from "@/server/services/offline-sync";


const ROUTE = "/api/journal/entries";

function errorResponse(error: unknown) {
  if (error instanceof OfflineConflictError) return conflictResponse(error);
  if (error instanceof ZodError || error instanceof JournalServiceError) {
    return Response.json(
      {
        error:
          error instanceof ZodError
            ? (error.issues[0]?.message ?? "Anotação inválida.")
            : error.message,
      },
      { status: 400 },
    );
  }
  // 404 antes do 500: uma anotacao fora de alcance e recusa esperada, nao falha

  // que eram a RLS trabalhando - em producao esse ruido esconderia a falha real
  // que o 5xx deveria denunciar.
  if (error instanceof JournalEntryNotFoundError) {
    return Response.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof JournalRepositoryError) {
    return Response.json({ error: "Não foi possível salvar o diário." }, { status: 500 });
  }
  throw error;
}

export async function POST(request: Request) {
  const traceId = traceMutation("HANDLER_RECEIVED", request, ROUTE);
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await saveJournalEntry(auth.supabase, auth.user, await request.json());
    traceMutation("SERVICE_FINISHED", request, ROUTE, traceId);
    const response = Response.json({ data }, { status: 201 });
    traceMutation("RESPONSE_CREATED", request, ROUTE, traceId);
    return response;
  } catch (error) {
    return errorResponse(error);
  } finally {
    traceMutation("HANDLER_RETURNING", request, ROUTE, traceId);
  }
}

export async function PATCH(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await changeJournalTrashState(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await permanentlyDeleteJournalEntry(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}
