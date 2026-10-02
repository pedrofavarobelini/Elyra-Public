import { z, ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import {
  PedroCoreBlockedError,
  PedroCoreConfigurationError,
  PedroCoreContractError,
  PedroCoreTimeoutError,
  PedroCoreUnavailableError,
} from "@/server/pedrocore/client";
import { LearningRepositoryError } from "@/server/repositories/learning-repository";
import {
  LearningServiceError,
  exportSnapshotForLearning,
  listLearningExports,
} from "@/server/services/learning-service";



const submitSchema = z.object({
  reportSnapshotId: z
    .string({ message: "Informe o relatório a contribuir." })
    .uuid("Relatório inválido."),
});

/** Projecao minima. O recibo de governanca nunca devolve o payload submetido. */
function toGovernanceView(row: {
  fingerprint: string;
  status: string;
  rejection_code: string | null;
  candidate_id: string | null;
  candidate_lifecycle: string | null;
  produced_at: string;
  exported_at: string | null;
  revoked_at: string | null;
}) {
  return {
    fingerprint: row.fingerprint,
    status: row.status,
    rejectionCode: row.rejection_code,
    candidateId: row.candidate_id,
    candidateLifecycle: row.candidate_lifecycle,
    producedAt: row.produced_at,
    exportedAt: row.exported_at,
    revokedAt: row.revoked_at,
  };
}

export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    const rows = await listLearningExports(auth.supabase, auth.user);
    return Response.json({ data: rows.map(toGovernanceView) });
  } catch (error) {
    if (error instanceof LearningRepositoryError) {
      return Response.json(
        { error: "Não foi possível ler as contribuições." },
        { status: 500 },
      );
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;

  try {
    const { reportSnapshotId } = submitSchema.parse(await request.json());
    const result = await exportSnapshotForLearning(
      auth.supabase,
      auth.user,
      reportSnapshotId,
    );
    // `replayed` distingue "exportou agora" de "ja estava exportado". O mesmo
    // conteudo governado nunca gera um segundo Candidate.
    return Response.json({ data: result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Dados inválidos." },
        { status: 400 },
      );
    }
    if (error instanceof LearningServiceError) {
      const status =
        error.reason === "training_consent_missing"
          ? 403
          : error.reason === "snapshot_not_found"
            ? 404
            : error.reason === "snapshot_invalid"
              ? 422
              : 409;
      const message =
        error.reason === "training_consent_missing"
          ? "Autorize o uso para melhoria da IA antes de contribuir."
          : error.reason === "snapshot_not_found"
            ? "Relatório não encontrado."
            : error.reason === "snapshot_invalid"
              ? "Este relatório não tem proveniência válida para contribuir."
              : "Não foi possível registrar a contribuição.";
      return Response.json(
        { error: message, code: error.reason, rejectionCode: error.rejectionCode },
        { status },
      );
    }
    // Fronteira indisponivel e estado de governanca, nao stack trace. O
    // registro local ja foi gravado pelo servico, entao a pessoa recebe uma
    // resposta que diz a verdade — nada foi enviado — em vez de um 500 opaco.
    if (
      error instanceof PedroCoreConfigurationError ||
      error instanceof PedroCoreUnavailableError ||
      error instanceof PedroCoreTimeoutError ||
      error instanceof PedroCoreContractError ||
      error instanceof PedroCoreBlockedError
    ) {
      return Response.json(
        {
          error:
            "A contribuição não pode ser enviada agora. Nada saiu da Elyra e o seu relatório continua intacto.",
          code: "PEDROCORE_UNAVAILABLE",
        },
        { status: 503 },
      );
    }
    if (error instanceof LearningRepositoryError) {
      return Response.json(
        { error: "Não foi possível registrar a contribuição." },
        { status: 500 },
      );
    }
    throw error;
  }
}
