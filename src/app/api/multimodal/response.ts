import { ZodError } from "zod";
import { ProtectedQaEvidenceError } from "@/server/qa/protected-evidence";

import { MultimodalRepositoryError } from "@/server/repositories/multimodal-repository";
import { SessionAnalysisRepositoryError } from "@/server/repositories/session-analysis-repository";
import { MultimodalServiceError } from "@/server/services/multimodal-service";
import { SessionAnalysisServiceError } from "@/server/services/session-analysis-service";

export function multimodalErrorResponse(error: unknown) {
  if (error instanceof ProtectedQaEvidenceError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (error instanceof ZodError) {
    return Response.json(
      { error: error.issues[0]?.message ?? "Dados multimodais inválidos." },
      { status: 400 },
    );
  }
  if (error instanceof MultimodalServiceError) {
    const status = error.code.endsWith("NOT_FOUND")
      ? 404
      : error.code === "INVALID_MEDIA"
        ? 415
        : error.code === "INVALID_STATE"
          ? 409
          : 503;
    const message = error.code === "INVALID_MEDIA"
      ? "Mídia recusada por tipo, assinatura ou tamanho."
      : error.code === "CLEANUP_INCOMPLETE"
        ? "A exclusão não foi confirmada no Storage."
        : error.code.endsWith("NOT_FOUND")
          ? "Recurso multimodal não encontrado."
          : "Operação multimodal indisponível.";
    return Response.json({ error: message, code: error.code }, { status });
  }
  if (error instanceof SessionAnalysisServiceError) {
    const message =
      error.code === "SESSION_NOT_FOUND"
        ? "Sessão não encontrada."
        : error.code === "INVALID_STATE"
          ? "Esta sessão ainda não está pronta para processamento."
          : error.code === "PEDROCORE_INVALID_OUTPUT"
            ? "A interpretação recebida não respeita o contrato."
            : error.code === "PEDROCORE_UNAVAILABLE"
              ? "A interpretação por IA está indisponível. Transcrição e sinais continuam salvos."
              : "Não foi possível concluir o processamento da sessão.";
    return Response.json({ error: message, code: error.code }, { status: error.status });
  }
  if (error instanceof SessionAnalysisRepositoryError) {
    return Response.json(
      { error: "Não foi possível persistir a análise da sessão." },
      { status: 500 },
    );
  }
  if (error instanceof MultimodalRepositoryError) {
    return Response.json(
      { error: "Não foi possível persistir a operação multimodal." },
      { status: 500 },
    );
  }
  throw error;
}
