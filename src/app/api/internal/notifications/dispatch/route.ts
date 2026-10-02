import { consumeRateLimit, rateLimitIdentity } from "@/lib/security/rate-limit";
import { dispatchNotificationEmails } from "@/server/jobs/notification-email-dispatcher";
import { requireInternalDispatchSecret } from "@/server/internal-dispatch-secret";

/**
 * Disparo do dispatcher de e-mail (ADR-0023). Chamado por agendador, nunca por
 * pessoa: nao le sessao, nao passa pelo aceite dos termos, nao devolve dado de
 * titular — so contagens.
 *
 * Sem segredo valido: 404 identico ao de uma rota inexistente. O rate limit vem
 * antes de tudo, inclusive para quem tenta adivinhar o segredo.
 */
export const dynamic = "force-dynamic";

const NOT_FOUND = () =>
  new Response("Not Found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const limit = consumeRateLimit(
    "notificationDispatch",
    rateLimitIdentity(null, request.headers.get("x-forwarded-for")),
  );
  if (!limit.allowed) {
    return Response.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }
  if (!requireInternalDispatchSecret(request.headers.get("authorization"))) return NOT_FOUND();

  const outcome = await dispatchNotificationEmails();
  const status = outcome.status === "unavailable" || outcome.status === "failed" ? 503 : 200;
  return Response.json({ data: outcome }, { status, headers: { "Cache-Control": "no-store" } });
}
