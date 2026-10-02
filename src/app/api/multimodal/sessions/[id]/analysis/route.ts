import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";

import { getConsentedApiUser } from "@/server/auth";
import {
  getSessionAnalysis,
  runSessionAnalysis,
} from "@/server/services/session-analysis-service";
import { multimodalErrorResponse } from "../../../response";

/**
 * Fronteira do processamento pos-sessao.
 *
 * A ADR-0005 escreveu "Server Action"; esta e a mesma fronteira de servidor do
 * Next.js, no formato que o repositorio inteiro ja usa. A decisao da ADR — o
 * calculo acontece on-device e o servidor recebe texto e numeros ja tipados —
 * e respeitada integralmente.
 *
 * `POST` processa; `GET` le o que ficou persistido. Nenhum dos dois conhece
 * provider, credencial ou payload de fronteira: isso vive no service.
 */

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const { id } = await context.params;
    return Response.json({
      data: await getSessionAnalysis(auth.supabase, auth.user, id),
    });
  } catch (error) {
    return multimodalErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;

  // O processamento pode atravessar a fronteira PedroCore, entao ele partilha o
  // mesmo balde de rate limit das demais chamadas de inferencia.
  const rate = consumeRateLimit(
    "pedrocore",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);

  try {
    const { id } = await context.params;
    const data = await runSessionAnalysis(
      auth.supabase,
      auth.user,
      id,
      await request.json(),
    );
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return multimodalErrorResponse(error);
  }
}
