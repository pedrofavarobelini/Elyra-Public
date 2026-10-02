import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { JournalRepositoryError } from "@/server/repositories/journal-repository";
import { addCustomJournalTag } from "@/server/services/journal-service";

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await addCustomJournalTag(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Tag inválida." },
        { status: 400 },
      );
    }
    if (error instanceof JournalRepositoryError) {
      return Response.json({ error: "Não foi possível criar a tag." }, { status: 500 });
    }
    throw error;
  }
}
