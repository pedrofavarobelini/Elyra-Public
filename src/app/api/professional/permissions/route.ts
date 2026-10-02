import { getConsentedApiUser } from "@/server/auth";
import {
  getPermissions,
  updateDataWindow,
  updatePermission,
} from "@/server/services/professional-service";
import { professionalErrorResponse } from "../response";

export async function GET(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const connectionId = new URL(request.url).searchParams.get("connectionId") ?? "";
    return Response.json({ data: await getPermissions(auth.supabase, connectionId) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await updatePermission(auth.supabase, await request.json()) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}

/**
 * `PATCH` define a janela de tempo do dado; `PUT` concede ou revoga o escopo.
 *
 * Verbos diferentes porque sao decisoes diferentes: recortar o periodo de um
 * escopo ja concedido nao e um caso particular de conceder.
 */
export async function PATCH(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await updateDataWindow(auth.supabase, await request.json()) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
