import { getConsentedApiUser } from "@/server/auth";
import { getMySessions } from "@/server/services/professional-session-service";
import { NO_STORE, sessionErrorResponse } from "./response";

export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await getMySessions(auth.supabase) }, { headers: NO_STORE });
  } catch (error) {
    return sessionErrorResponse(error);
  }
}
