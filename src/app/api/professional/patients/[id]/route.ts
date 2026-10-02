import { getVerifiedProfessionalApiUser } from "@/server/professional-gate";
import { getProfessionalPatient } from "@/server/services/professional-service";
import { professionalErrorResponse } from "../../response";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  try {
    const { id } = await params;
    return Response.json({ data: await getProfessionalPatient(auth.supabase, auth.user, id) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
