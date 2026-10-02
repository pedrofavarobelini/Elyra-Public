import { getConsentedApiUser } from "@/server/auth";
import {
  cleanupMultimodalSession,
  getMultimodalSession,
  setMultimodalSessionStatus,
} from "@/server/services/multimodal-service";
import { multimodalErrorResponse } from "../../response";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const { id } = await context.params;
    return Response.json({
      data: await getMultimodalSession(auth.supabase, id),
    });
  } catch (error) {
    return multimodalErrorResponse(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const { id } = await context.params;
    return Response.json({
      data: await setMultimodalSessionStatus(
        auth.supabase,
        id,
        await request.json(),
      ),
    });
  } catch (error) {
    return multimodalErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const { id } = await context.params;
    return Response.json({
      data: await cleanupMultimodalSession(auth.supabase, auth.user, id),
    });
  } catch (error) {
    return multimodalErrorResponse(error);
  }
}
