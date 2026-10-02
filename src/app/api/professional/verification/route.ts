import { getConsentedApiUser } from "@/server/auth";
import { getMyVerificationHistory } from "@/server/services/professional-service";
import { professionalErrorResponse } from "../response";

/**
 * Historico da propria verificacao. Sem parametro de usuario: a RPC le
 * `auth.uid()` e nao expoe reviewer nem digest.
 */
export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await getMyVerificationHistory(auth.supabase, auth.user) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
