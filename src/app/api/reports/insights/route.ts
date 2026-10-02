import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import {
  AiInsightServiceError,
  createAiInsight,
} from "@/server/services/ai-insights-service";

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;

  const rate = consumeRateLimit(
    "pedrocore",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);

  try {
    const data = await createAiInsight(
      auth.supabase,
      auth.user,
      await request.json(),
    );
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: "Requisição de insight inválida.",
          code: "ELYRA_INPUT_SCHEMA_INVALID",
        },
        { status: 400 },
      );
    }
    if (error instanceof AiInsightServiceError) {
      return Response.json(
        {
          error:
            error.code === "AI_INFERENCE_CONSENT_REQUIRED"
              ? "Autorize explicitamente a interpretação por IA."
              : error.code === "ELYRA_IDEMPOTENCY_CONFLICT"
                ? "Esta chave de idempotência já foi usada com outro relatório."
                : "A interpretação por IA está indisponível. O relatório determinístico continua acessível.",
          code: error.code,
        },
        { status: error.status },
      );
    }
    throw error;
  }
}
