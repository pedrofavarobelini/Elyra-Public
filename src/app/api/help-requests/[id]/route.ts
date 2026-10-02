import { z } from "zod";

import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import { applyHelpRequestAction } from "@/server/services/help-request-service";
import { helpRequestErrorResponse } from "../response";

const idSchema = z.string().uuid("Pedido inválido.");

/**
 * Cancelar, marcar lido/respondido ou encerrar. O banco decide quem pode o
 * que; profissional sem vinculo ativo ou sem verificacao vigente recebe o
 * mesmo 404 de "nao existe".
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "helpRequestWrite",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    const id = idSchema.parse((await context.params).id);
    return Response.json(
      { data: await applyHelpRequestAction(auth.supabase, id, await request.json()) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return helpRequestErrorResponse(error);
  }
}
