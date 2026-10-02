import { getConsentedApiUser } from "@/server/auth";
import {
  changeConnection,
  getConnections,
} from "@/server/services/professional-service";
import { professionalErrorResponse } from "../response";

export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await getConnections(auth.supabase) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}

// L-434: nao existe mais POST. O vinculo nasce pelo codigo de convite
// (`/api/professional/invites/redeem`) ou pelo pedido no diretorio
// (`/api/professional/connection-requests`). O Next responde 405.

export async function PATCH(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await changeConnection(auth.supabase, await request.json()) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
