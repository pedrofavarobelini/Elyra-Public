import { getConsentedApiUser } from "@/server/auth";
import { CycleRepositoryError } from "@/server/repositories/cycle-repository";
import { permanentlyDeleteCycleData } from "@/server/services/cycle-service";

export async function DELETE() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await permanentlyDeleteCycleData(auth.supabase);
    return Response.json({ data });
  } catch (error) {
    if (error instanceof CycleRepositoryError) {
      return Response.json(
        { error: "Não foi possível excluir os dados do ciclo." },
        { status: 500 },
      );
    }
    throw error;
  }
}
