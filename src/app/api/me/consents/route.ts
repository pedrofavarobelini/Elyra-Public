import { getAuthenticatedApiUser } from "@/server/auth";
import { ConsentRepositoryError } from "@/server/repositories/consent-repository";
import { getConsentHistory } from "@/server/services/consent-service";

/**
 * Historico de consentimento do titular.
 *
 * Somente leitura, e de proposito: conceder e revogar continuam acontecendo nas
 * RPCs de cada finalidade (`set_ai_inference_consent`, `set_training_consent`,
 * `set_cycle_enabled`), que sao a unica autoridade sobre o log append-only.
 * Uma rota generica de escrita aqui criaria um segundo caminho para gravar
 * consentimento — e o segundo caminho e sempre o que esquece uma regra.
 */
export async function GET() {
  const { auth, denial } = await getAuthenticatedApiUser();
  if (denial) return denial;

  try {
    return Response.json(
      { data: await getConsentHistory(auth.supabase) },
      { headers: { "Cache-Control": "no-store, private" } },
    );
  } catch (error) {
    if (error instanceof ConsentRepositoryError) {
      return Response.json(
        { error: "Não foi possível carregar seu histórico de consentimento." },
        { status: 500 },
      );
    }
    throw error;
  }
}
