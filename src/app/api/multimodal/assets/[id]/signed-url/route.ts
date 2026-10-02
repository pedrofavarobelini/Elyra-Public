import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import { createMultimodalAssetSignedUrl } from "@/server/services/multimodal-service";
import { multimodalErrorResponse } from "../../../response";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;

  const rate = consumeRateLimit(
    "signedUrl",
    rateLimitIdentity(auth.user.id, _request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    const { id } = await context.params;
    return Response.json({
      data: await createMultimodalAssetSignedUrl(auth.supabase, id),
    });
  } catch (error) {
    return multimodalErrorResponse(error);
  }
}
