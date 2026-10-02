import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getVerifiedProfessionalApiUser } from "@/server/professional-gate";
import {
  createInvite,
  getMyInvites,
  revokeInvite,
} from "@/server/services/professional-service";
import { professionalErrorResponse } from "../response";

/**
 * Convites do profissional. O token so aparece na resposta do `POST`, uma
 * vez, e nunca pode ficar em cache intermediario.
 */
const NO_STORE = { "cache-control": "no-store, max-age=0", pragma: "no-cache" };

export async function GET() {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await getMyInvites(auth.supabase, auth.user) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "professionalInvite",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    return Response.json(
      { data: await createInvite(auth.supabase, auth.user) },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    return professionalErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    return Response.json({ data: await revokeInvite(auth.supabase, auth.user, id) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
