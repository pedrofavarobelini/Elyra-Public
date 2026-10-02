import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getVerifiedProfessionalApiUser } from "@/server/professional-gate";
import { getTranscriptForProfessional } from "@/server/services/professional-session-service";
import { NO_STORE, sessionErrorResponse } from "../../response";

/**
 * Transcricao para o profissional da sessao, so com o consentimento desta
 * sessao. O texto nunca e logado; a resposta nunca vai para cache.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { auth, denial } = await getVerifiedProfessionalApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "sessionAccess",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    const result = await getTranscriptForProfessional(auth.supabase, (await context.params).id);
    if (!result) {
      return Response.json({ error: "Sessão não encontrada." }, { status: 404, headers: NO_STORE });
    }
    if (result.outcome === "not_allowed") {
      return Response.json(
        { error: "A pessoa não liberou a leitura da transcrição desta sessão.", code: "not_allowed" },
        { status: 403, headers: NO_STORE },
      );
    }
    return Response.json({ data: result }, { headers: NO_STORE });
  } catch (error) {
    return sessionErrorResponse(error);
  }
}
