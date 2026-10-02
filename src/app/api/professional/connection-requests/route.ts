import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import { requestAccompaniment } from "@/server/services/professional-service";
import { professionalErrorResponse } from "../response";

/**
 * Fluxo B: a pessoa pede acompanhamento a partir da descoberta. Cria (ou
 * reabre) a mesma relationship do convite, em `pending`. Nada e compartilhado.
 * Toda recusa de regra (perfil fora da descoberta, limite) devolve frase fixa.
 */
export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "connectionRequest",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    const result = await requestAccompaniment(auth.supabase, await request.json());
    if (result.outcome === "unavailable") {
      return Response.json({ error: "Este perfil não está disponível para solicitações." }, { status: 404 });
    }
    if (result.outcome === "limit") {
      return Response.json(
        { error: "Não é possível enviar outra solicitação a este profissional agora. Tente novamente mais tarde." },
        { status: 429 },
      );
    }
    return Response.json({ data: { connectionId: result.connectionId, status: result.status } }, { status: 201 });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
