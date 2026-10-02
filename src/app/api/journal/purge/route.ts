import { getConsentedApiUser } from "@/server/auth";
import { JournalRepositoryError } from "@/server/repositories/journal-repository";
import { purgeExpiredJournalEntries } from "@/server/services/journal-service";

export async function POST() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await purgeExpiredJournalEntries(auth.supabase);
    return Response.json({ data });
  } catch (error) {
    if (error instanceof JournalRepositoryError) {
      return Response.json({ error: "Não foi possível expurgar a lixeira." }, { status: 500 });
    }
    throw error;
  }
}
