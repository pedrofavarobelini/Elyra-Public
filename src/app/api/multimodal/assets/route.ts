import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import { uploadMultimodalAsset } from "@/server/services/multimodal-service";
import { multimodalErrorResponse } from "../response";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;

  const rate = consumeRateLimit(
    "upload",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: "Arquivo ausente." }, { status: 400 });
    }
    const durationValue = form.get("durationMs");
    const data = await uploadMultimodalAsset(
      auth.supabase,
      auth.user,
      {
        sessionId: form.get("sessionId"),
        mediaKind: form.get("mediaKind"),
        durationMs: durationValue === null || durationValue === ""
          ? null
          : durationValue,
      },
      file,
    );
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return multimodalErrorResponse(error);
  }
}
