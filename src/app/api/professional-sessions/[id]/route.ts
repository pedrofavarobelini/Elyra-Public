import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import {
  applySessionAction,
  getSessionDetail,
} from "@/server/services/professional-session-service";
import { NO_STORE, sessionErrorResponse } from "../response";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const detail = await getSessionDetail(auth.supabase, (await context.params).id);
    if (!detail) {
      return Response.json({ error: "Sessão não encontrada." }, { status: 404, headers: NO_STORE });
    }
    return Response.json({ data: detail }, { headers: NO_STORE });
  } catch (error) {
    return sessionErrorResponse(error);
  }
}

/**
 * Entrar, sair, encerrar. "Entrar" emite e troca a credencial efemera aqui, no
 * servidor, na mesma requisicao: o token nunca chega ao navegador, a URL, ao
 * historico, ao referer nem a log.
 */
export async function PATCH(request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "sessionAccess",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    return Response.json(
      { data: await applySessionAction(auth.supabase, (await context.params).id, await request.json()) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return sessionErrorResponse(error);
  }
}
