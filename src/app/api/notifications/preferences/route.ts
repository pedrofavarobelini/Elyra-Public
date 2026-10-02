import { ZodError } from "zod";

import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import { NotificationPreferencesRepositoryError } from "@/server/repositories/notification-preferences-repository";
import {
  NotificationChannelUnavailableError,
  NotificationPreferenceNotFoundError,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/server/services/notification-preferences-service";



export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;

  try {
    return Response.json(
      { data: await getNotificationPreferences(auth.supabase) },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    if (error instanceof NotificationPreferencesRepositoryError) {
      return Response.json(
        { error: "Não foi possível carregar suas preferências." },
        { status: 500 },
      );
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;

  /*
    Somente a mutacao. O `GET` acima fica sem teto de proposito: e leitura
    estavel e barata da propria matriz, e limita-la seria teto para marcar caixa.
  */
  const limit = consumeRateLimit(
    "notificationPreference",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!limit.allowed) return rateLimitedResponse(limit);

  try {
    const data = await updateNotificationPreferences(
      auth.supabase,
      await request.json(),
    );
    return Response.json(
      { data },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Preferência inválida." },
        { status: 400 },
      );
    }
    /*
      Canal indisponivel e 409, e nao 400: o pedido esta bem formado, e o que
      impede a escrita e o estado desta instalacao. Responder 400 mandaria quem
      chama procurar erro no proprio payload.
    */
    if (error instanceof NotificationChannelUnavailableError) {
      return Response.json(
        { error: "Este canal não está disponível nesta instalação." },
        { status: 409 },
      );
    }
    if (error instanceof NotificationPreferenceNotFoundError) {
      return Response.json(
        { error: "Preferência de notificação não encontrada." },
        { status: 404 },
      );
    }
    if (error instanceof NotificationPreferencesRepositoryError) {
      return Response.json(
        { error: "Não foi possível salvar a preferência." },
        { status: 500 },
      );
    }
    throw error;
  }
}
