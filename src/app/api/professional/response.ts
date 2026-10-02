import { ZodError } from "zod";

import { ProfessionalRepositoryError } from "@/server/repositories/professional-repository";
import { ProfessionalAccessError } from "@/server/services/professional-service";

export function professionalErrorResponse(error: unknown) {
  // Corpo que nem e JSON: pedido malformado, nunca 500.
  if (error instanceof SyntaxError) {
    return Response.json({ error: "Pedido inválido." }, { status: 400 });
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Dados profissionais inválidos." },
      { status: 400 },
    );
  }
  if (error instanceof ProfessionalAccessError) {
    if (error.code === "PROFESSIONAL_INVITE_UNAVAILABLE") {
      // Uma frase para todos os casos: inexistente, expirado, revogado, usado.
      return Response.json(
        {
          error: "Este código não está disponível. Confira o código ou peça um novo ao profissional.",
          code: error.code,
        },
        { status: error.status },
      );
    }
    return Response.json({ error: "Acesso profissional negado.", code: error.code }, { status: error.status });
  }
  if (error instanceof ProfessionalRepositoryError) {
    // Credencial ja vinculada a outra conta. Mensagem generica: nao diz de quem.
    if (error.code === "23505") {
      return Response.json(
        { error: "Este registro não pode ser vinculado a esta conta." },
        { status: 409 },
      );
    }
    // Limite do banco (convites vivos, tentativas de resgate).
    if (error.code === "54000") {
      return Response.json(
        { error: "Limite atingido. Tente novamente em alguns minutos." },
        { status: 429 },
      );
    }
    // Pedido bem formado que o banco recusa por regra (transicao, janela, TTL).
    if (error.code === "23514") {
      return Response.json(
        { error: "Perfil público incompleto: preencha os campos obrigatórios antes de publicar." },
        { status: 422 },
      );
    }
    if (error.code === "22023") {
      return Response.json(
        { error: "Operação profissional recusada pela regra vigente." },
        { status: 422 },
      );
    }
    const denied = error.code === "42501" || error.code === "PGRST116";
    return Response.json(
      { error: denied ? "Acesso profissional negado." : "Operação profissional indisponível." },
      { status: denied ? 403 : 500 },
    );
  }
  throw error;
}
