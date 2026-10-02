import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { ReportsRepositoryError } from "@/server/repositories/reports-repository";
import { createReportSnapshot } from "@/server/services/reports-service";

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const data = await createReportSnapshot(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Relatório inválido." },
        { status: 400 },
      );
    }
    if (error instanceof ReportsRepositoryError) {
      return Response.json(
        { error: "Não foi possível criar o snapshot do relatório." },
        { status: 500 },
      );
    }
    throw error;
  }
}
