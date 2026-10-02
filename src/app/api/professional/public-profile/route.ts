import { getConsentedApiUser } from "@/server/auth";
import { getMyPublicProfile, updateMyPublicProfile } from "@/server/services/professional-directory-service";
import { professionalErrorResponse } from "../response";


export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await getMyPublicProfile(auth.supabase, auth.user) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await updateMyPublicProfile(auth.supabase, auth.user, await request.json()) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
