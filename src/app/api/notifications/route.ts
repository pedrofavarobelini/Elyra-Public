import { getConsentedApiUser } from "@/server/auth";
import { NotificationsRepositoryError } from "@/server/repositories/notifications-repository";
import { getNotificationsSnapshot } from "@/server/services/notifications-service";

export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;

  try {
    return Response.json(
      { data: await getNotificationsSnapshot(auth.supabase) },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    if (error instanceof NotificationsRepositoryError) {
      return Response.json(
        { error: "Não foi possível carregar as notificações." },
        { status: 500 },
      );
    }
    throw error;
  }
}
