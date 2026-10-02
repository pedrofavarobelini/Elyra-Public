import { ZodError } from "zod";

import { OnboardingRepositoryError } from "@/server/repositories/professional-onboarding-repository";
import { CredentialNotFoundError } from "@/server/services/professional-onboarding-service";

/**
 * Erros do onboarding em frases de quem esta preenchendo. O motivo vem de uma
 * lista fechada (repositorio); texto do Postgres nunca chega a tela.
 */
const REASON_MESSAGE: Record<string, { status: number; error: string }> = {
  "onboarding required": { status: 422, error: "Comece o cadastro antes de enviar." },
  "identity confirmation required": { status: 422, error: "Confirme a etapa Identidade antes de enviar." },
  "registry required": { status: 422, error: "Preencha a etapa Registro no conselho antes de enviar." },
  "already verified": { status: 409, error: "Seu registro já está verificado. Edite pelo Perfil profissional." },
  "credential locked": { status: 423, error: "Com o acesso suspenso, o registro não pode ser alterado." },
  "credential unchanged": {
    status: 422,
    error: "Este registro já foi conferido e não foi confirmado. Revise região e número antes de reenviar.",
  },
  "credential unavailable": { status: 409, error: "Este registro não pode ser vinculado a esta conta." },
  "credential limit reached": { status: 422, error: "Limite de itens atingido. Remova um item para adicionar outro." },
};

export function onboardingErrorResponse(error: unknown) {
  if (error instanceof SyntaxError) return Response.json({ error: "Pedido inválido." }, { status: 400 });
  if (error instanceof ZodError) {
    return Response.json({ error: error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  }
  if (error instanceof CredentialNotFoundError) {
    return Response.json({ error: "Item não encontrado." }, { status: 404 });
  }
  if (error instanceof OnboardingRepositoryError) {
    const mapped = REASON_MESSAGE[error.reason];
    if (mapped) return Response.json({ error: mapped.error, code: error.reason }, { status: mapped.status });
    if (error.code === "23505") {
      return Response.json({ error: "Este registro não pode ser vinculado a esta conta." }, { status: 409 });
    }
    if (error.code === "23514" || error.code === "22023") {
      return Response.json({ error: "Algum dado está fora do formato aceito." }, { status: 422 });
    }
    if (error.code === "42501") return Response.json({ error: "Ação não permitida." }, { status: 403 });
    return Response.json({ error: "Não foi possível salvar agora. Tente de novo." }, { status: 500 });
  }
  throw error;
}
