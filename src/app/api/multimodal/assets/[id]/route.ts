import { getConsentedApiUser } from "@/server/auth";
import { deleteMultimodalAsset } from "@/server/services/multimodal-service";
import { multimodalErrorResponse } from "../../response";



type Context = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;

  try {
    const { id } = await context.params;
    return Response.json({
      data: await deleteMultimodalAsset(auth.supabase, auth.user, id),
    });
  } catch (error) {
    return multimodalErrorResponse(error);
  }
}
