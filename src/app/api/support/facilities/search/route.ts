import { ZodError } from "zod";

import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import { SupportNetworkRepositoryError } from "@/server/repositories/support-network-repository";
import { browseSupportNetwork } from "@/server/services/support-network-service";

/**
 * SUP-2 — busca da Rede de Apoio (ADR-0032).
 *
 * POST, e nao GET, para o municipio nao ir para query string (access log,
 * historico, Referer). O corpo aceita so municipio, tipo oficial e pagina; o
 * schema e estrito, entao coordenada da pessoa e recusada (400), nunca
 * ignorada. A resposta so tem `SupportFacility` + procedencia do SUP-1.
 * Nada de corpo ou municipio em log.
 */
export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "supportNetworkRead",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);

  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 2_048) {
    return Response.json({ error: "Pedido grande demais." }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const body = await request.json();
    return Response.json({ data: await browseSupportNetwork(auth.supabase, body) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) {
      return Response.json({ error: "Busca inválida." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof SupportNetworkRepositoryError && error.code === "22023") {
      return Response.json({ error: "Busca inválida." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    // e o codigo do Postgres; nunca municipio, corpo ou dado da pessoa.
    // Cliente que desistiu no meio (aba fechada, rede caiu): ninguem recebe a resposta; nao e falha.
    if (error instanceof Error && error.message === "aborted") {
      return new Response(null, { status: 499, headers: { "Cache-Control": "no-store" } });
    }
    const repo = error instanceof SupportNetworkRepositoryError ? ` op=${error.operation} code=${error.code ?? "?"}` : "";
    console.error(`support_search_failed kind=${error instanceof Error ? error.name : typeof error}${repo}`);
    return Response.json(
      { error: "Não foi possível consultar a Rede de Apoio agora." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
