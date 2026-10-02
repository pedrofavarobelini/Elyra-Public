import { getConsentedApiUser } from "@/server/auth";
import {
  createMultimodalSession,
  listMultimodalSessions,
} from "@/server/services/multimodal-service";
import { multimodalErrorResponse } from "../response";

export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({
      data: await listMultimodalSessions(auth.supabase, auth.user),
    });
  } catch (error) {
    return multimodalErrorResponse(error);
  }
}
export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await createMultimodalSession(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return multimodalErrorResponse(error);
  }
}
