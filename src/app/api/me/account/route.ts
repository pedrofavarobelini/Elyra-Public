import { ZodError } from "zod";
import { ProtectedQaEvidenceError } from "@/server/qa/protected-evidence";

import { accountDeletionRequestSchema } from "@/lib/contracts/subject-rights";
import {
  consumeRateLimit,
  rateLimitIdentity,
  rateLimitedResponse,
} from "@/lib/security/rate-limit";
import { getAuthenticatedApiUser } from "@/server/auth";
import {
  SubjectRightsError,
  deleteAccountAndData,
  getDeletionProgress,
} from "@/server/services/subject-rights-service";

/** Estado de uma exclusao em andamento — permite retomar depois de uma falha. */
export async function GET() {
  const { auth, denial } = await getAuthenticatedApiUser();
  if (denial) return denial;

  const progress = await getDeletionProgress(auth.supabase, auth.user);
  return Response.json(
    { data: progress },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Exclusao da conta e dos dados do titular.
 *
 * `DELETE` com corpo de confirmacao explicito: a frase exata evita que um clique
 * acidental — ou uma request forjada que apenas repetisse o metodo — apague uma
 * conta. Nao e controle de seguranca, e um segundo ato deliberado.
 *
 * O servico e idempotente: repetir depois de uma falha parcial retoma da etapa
 * seguinte em vez de recomecar.
 */
export async function DELETE(request: Request) {
  const { auth, denial } = await getAuthenticatedApiUser();
  if (denial) return denial;
  const { supabase, user } = auth;

  const limit = consumeRateLimit(
    "accountDeletion",
    rateLimitIdentity(user.id, request.headers.get("x-forwarded-for")),
  );
  if (!limit.allowed) return rateLimitedResponse(limit);

  try {
    accountDeletionRequestSchema.parse(await request.json());
  } catch {
    return Response.json(
      { error: "Confirmação ausente ou incorreta." },
      { status: 400 },
    );
  }

  try {
    const progress = await deleteAccountAndData(supabase, user);
    // A sessao morre junto: a conta deixou de existir e o cookie nao pode
    // continuar valendo.
    await supabase.auth.signOut({ scope: "global" });
    return Response.json(
      { data: progress },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ProtectedQaEvidenceError) {
      return Response.json(
        { error: error.message, code: error.code },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof ZodError) {
      return Response.json({ error: "Dados inválidos." }, { status: 400 });
    }
    if (error instanceof SubjectRightsError) {
      // Estado parcial fica consultavel em `GET`; o retry retoma de onde parou.
      return Response.json(
        {
          error:
            "A exclusão não foi concluída. O progresso foi salvo e pode ser retomado.",
        },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }
    throw error;
  }
}
