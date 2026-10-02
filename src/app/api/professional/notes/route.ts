import { getVerifiedProfessionalApiUser } from "@/server/professional-gate";
import {
  createNote,
  editNote,
  getNotes,
  removeNote,
} from "@/server/services/professional-service";
import { professionalErrorResponse } from "../response";

export async function GET(request: Request) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  try {
    const connectionId = new URL(request.url).searchParams.get("connectionId") ?? "";
    return Response.json({ data: await getNotes(auth.supabase, auth.user, connectionId) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  try {
    return Response.json(
      { data: await createNote(auth.supabase, auth.user, await request.json()) },
      { status: 201 },
    );
  } catch (error) {
    return professionalErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await editNote(auth.supabase, auth.user, await request.json()) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    return Response.json({ data: await removeNote(auth.supabase, auth.user, id) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
