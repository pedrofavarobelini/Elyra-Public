import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getConsentedApiUser } from "@/server/auth";
import {
  SubjectRightsError,
  buildSubjectDataExport,
} from "@/server/services/subject-rights-service";

/**
 * Exportacao dos dados do titular.
 *
 * Entregue como anexo JSON na propria resposta autenticada: nao existe URL
 * publica, nem link assinado de longa duracao, nem arquivo intermediario em
 * Storage. O dado sai pela mesma sessao que o pediu e nao fica em lugar nenhum
 * depois.
 */
export async function GET(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const { supabase, user } = auth;

  // Operacao cara e rara: limite baixo corta repeticao automatizada sem
  // atrapalhar quem legitimamente exporta os proprios dados.
  const limit = consumeRateLimit(
    "subjectExport",
    rateLimitIdentity(user.id, request.headers.get("x-forwarded-for")),
  );
  if (!limit.allowed) return rateLimitedResponse(limit);

  try {
    const payload = await buildSubjectDataExport(supabase, user);
    const filename = `elyra-dados-${payload.generatedAt.slice(0, 10)}.json`;

    return new Response(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Dado pessoal nunca em cache compartilhado nem em disco de proxy.
        "Cache-Control": "no-store, no-cache, must-revalidate, private",
      },
    });
  } catch (error) {
    if (error instanceof SubjectRightsError) {
      // A causa nao volta para o cliente: `detail` nomeia a tabela e isso e
      // informacao de estrutura interna.
      return Response.json(
        { error: "Não foi possível gerar a exportação." },
        { status: 500 },
      );
    }
    throw error;
  }
}
