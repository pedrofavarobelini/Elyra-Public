import { REALTIME_UNAVAILABLE_COPY } from "@/lib/contracts/professional-sessions";
import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import {
  RealtimeUnavailableError,
  authorizeSessionMediaFor,
  realtimeAvailabilityFor,
  recordSessionMediaEventFor,
} from "@/server/services/realtime-session-service";
import { NO_STORE, sessionErrorResponse } from "../../response";

type Context = { params: Promise<{ id: string }> };

function unavailable() {
  return Response.json(
    { error: REALTIME_UNAVAILABLE_COPY, code: "realtime_unavailable" },
    { status: 503, headers: NO_STORE },
  );
}

/** Pre-call: o servico de chamada responde? So um booleano, sem token. */
export async function GET(request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "sessionMedia",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    return Response.json(
      { data: await realtimeAvailabilityFor(auth.supabase, (await context.params).id) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return sessionErrorResponse(error);
  }
}

/**
 * PRO-7R: autorizacao de midia (entrar na chamada ou revalidar durante ela).
 * A resposta do `join` leva token curto e chave E2EE: `no-store`, nunca em
 * cache (SW NETWORK_ONLY), nunca em log.
 */
export async function POST(request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "sessionMedia",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    const grant = await authorizeSessionMediaFor(
      auth.supabase,
      auth.user.id,
      (await context.params).id,
      await request.json(),
    );
    return Response.json({ data: grant }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof RealtimeUnavailableError) return unavailable();
    return sessionErrorResponse(error);
  }
}

/** Entrada, saida e reconexao na chamada: so metadado na trilha. */
export async function PUT(request: Request, context: Context) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const rate = consumeRateLimit(
    "sessionMedia",
    rateLimitIdentity(auth.user.id, request.headers.get("x-forwarded-for")),
  );
  if (!rate.allowed) return rateLimitedResponse(rate);
  try {
    return Response.json(
      { data: await recordSessionMediaEventFor(auth.supabase, (await context.params).id, await request.json()) },
      { headers: NO_STORE },
    );
  } catch (error) {
    return sessionErrorResponse(error);
  }
}
