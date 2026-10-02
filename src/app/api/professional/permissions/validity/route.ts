import { getConsentedApiUser } from "@/server/auth";
import { updateGrantValidity } from "@/server/services/professional-service";
import { professionalErrorResponse } from "../../response";

/**
 * Vigencia do grant (`validFrom`/`validUntil`). Rota propria: conceder,
 * recortar a janela do dado e limitar a vigencia sao tres decisoes distintas
 * do titular, e nenhuma deve acontecer como efeito colateral de outra.
 */
export async function PUT(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await updateGrantValidity(auth.supabase, await request.json()) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
