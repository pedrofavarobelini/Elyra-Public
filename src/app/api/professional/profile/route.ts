import { getConsentedApiUser } from "@/server/auth";
import {
  getProfessionalProfile,
  updateProfessionalProfile,
} from "@/server/services/professional-service";
import { professionalErrorResponse } from "../response";

export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await getProfessionalProfile(auth.supabase, auth.user) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await updateProfessionalProfile(
      auth.supabase,
      await request.json(),
    );
    return Response.json({ data });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
