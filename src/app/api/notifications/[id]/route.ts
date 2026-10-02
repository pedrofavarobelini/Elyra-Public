import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { NotificationsRepositoryError } from "@/server/repositories/notifications-repository";
import {
  NotificationNotFoundError,
  readNotification,
} from "@/server/services/notifications-service";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(_request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;

  try {
    const { id } = await context.params;
    return Response.json({ data: await readNotification(auth.supabase, id) });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Notificação inválida." },
        { status: 400 },
      );
    }
    if (error instanceof NotificationNotFoundError) {
      return Response.json(
        { error: "Notificação não encontrada." },
        { status: 404 },
      );
    }
    if (error instanceof NotificationsRepositoryError) {
      return Response.json(
        { error: "Não foi possível atualizar a notificação." },
        { status: 500 },
      );
    }
    throw error;
  }
}
