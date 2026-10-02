import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type FeedbackSubmission,
  type FeedbackView,
  type TranscriptCorrectionSubmission,
  type TranscriptCorrectionView,
} from "@/lib/contracts/feedback";
import type { Database } from "@/lib/supabase/database.types";
import {
  deleteSessionFeedback,
  findSessionFeedback,
  findTranscriptCorrections,
  insertTranscriptCorrection,
  revokeTranscriptCorrection,
  upsertSessionFeedback,
  type SessionFeedbackRow,
  type TranscriptCorrectionRow,
} from "@/server/repositories/feedback-repository";

type Client = SupabaseClient<Database>;

export type FeedbackOutcome =
  | { status: "saved" }
  /** O alvo declarado nao existe nesta sessao, ou nao e desta pessoa. */
  | { status: "invalid_target" }
  | { status: "removed" }
  | { status: "corrected"; revision: number }
  | { status: "correction_removed" }
  | { status: "unchanged" }
  | { status: "denied" }
  | { status: "no_transcript" };

/**
 * Feedback de produto e correcao humana.
 *
 * ## O que este service nao faz, e por que
 *
 * Ele **nao reenvia nada ao Veltrix**. Uma correcao nao dispara reinterpretacao,
 * e um polegar para baixo nao pede segunda opiniao. Reanalisar em silencio
 * gastaria uma chamada de IA que ninguem pediu e — pior — trocaria a
 * interpretacao que a pessoa ja leu por outra, sem que ela soubesse.
 *
 * Ele **nao inicia treinamento**. `FEEDBACK != TRAINING`. A elegibilidade nasce
 * `false` e o banco recusa liga-la por update direto; nao ha caminho nesta
 * camada que tente.
 *
 * Ele **nao toca no transcript original**. A correcao e uma linha propria que
 * guarda o original ao lado do corrigido — `ASR_ORIGINAL != USER_CORRECTION`.
 */

function feedbackRowToView(row: SessionFeedbackRow): FeedbackView {
  return {
    targetType: row.target_type as FeedbackView["targetType"],
    rating: row.rating as FeedbackView["rating"],
    reason: row.reason as FeedbackView["reason"],
    updatedAt: row.updated_at,
  };
}

function correctionRowToView(
  row: TranscriptCorrectionRow,
): TranscriptCorrectionView {
  return {
    revision: row.revision,
    correctedText: row.corrected_content,
    originalText: row.original_content,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export async function readSessionFeedback(
  client: Client,
  sessionId: string,
): Promise<FeedbackView[]> {
  return (await findSessionFeedback(client, sessionId)).map(feedbackRowToView);
}

/**
 * A correcao vigente, ou `null`.
 *
 * Vigente e a de maior revisao **nao revogada**. Uma correcao revogada nao
 * volta a ser o texto exibido, e tambem nao apaga o historico: ela fica na
 * tabela marcada, porque uma exportacao futura precisa saber o que foi revogado
 * para poder respeitar a revogacao.
 */
export async function readCurrentCorrection(
  client: Client,
  sessionId: string,
): Promise<TranscriptCorrectionView | null> {
  const rows = await findTranscriptCorrections(client, sessionId);
  const current = rows.find((row) => row.revoked_at === null);
  return current ? correctionRowToView(current) : null;
}

/**
 * O alvo declarado existe nesta sessao e pertence a esta pessoa?
 *
 * A RLS prova que a **sessao** e da pessoa, e nao prova nada sobre o alvo: sem
 * esta checagem dava para avaliar uma "transcricao" apontando para o id de uma
 * interpretacao, ou para a transcricao de outra sessao. Nao vaza nada - nada
 * disso permite LER o alvo -, mas grava proveniencia falsa, e um dataset futuro
 * herdaria o erro sem saber.
 *
 * A mesma regra existe como trigger no banco. As duas camadas sao deliberadas:
 * confiar so nesta deixaria escrita direta pelo PostgREST contornar tudo, e
 * confiar so no trigger daria a quem chama um erro de banco em vez de uma
 * resposta tipada.
 */
async function targetBelongsToSession(
  client: Client,
  userId: string,
  submission: FeedbackSubmission,
): Promise<boolean> {
  // `null` representa alvo que ja nao existe por retencao. Ausencia declarada,
  // e nao alvo inventado.
  if (submission.targetId === null) return true;

  const table =
    submission.targetType === "transcription"
      ? "session_transcripts"
      : "session_interpretations";

  const { data, error } = await client
    .from(table)
    .select("id")
    .eq("id", submission.targetId)
    .eq("session_id", submission.sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  // Erro de leitura nao vira "pode gravar": fail-closed.
  return !error && data !== null;
}

export async function submitFeedback(
  client: Client,
  userId: string,
  submission: FeedbackSubmission,
): Promise<FeedbackOutcome> {
  if (!(await targetBelongsToSession(client, userId, submission))) {
    return { status: "invalid_target" };
  }

  try {
    await upsertSessionFeedback(client, {
      session_id: submission.sessionId,
      user_id: userId,
      target_type: submission.targetType,
      target_id: submission.targetId,
      rating: submission.rating,
      reason: submission.reason,
    });
    return { status: "saved" };
  } catch {
    /*
      A RLS recusou, ou a sessao nao e desta pessoa. Nao distinguimos os dois
      para quem chamou: dizer "esta sessao existe, mas nao e sua" confirmaria a
      existencia de uma sessao alheia.
    */
    return { status: "denied" };
  }
}

export async function removeFeedback(
  client: Client,
  submission: Pick<FeedbackSubmission, "sessionId" | "targetType">,
): Promise<FeedbackOutcome> {
  try {
    await deleteSessionFeedback(
      client,
      submission.sessionId,
      submission.targetType,
    );
    return { status: "removed" };
  } catch {
    return { status: "denied" };
  }
}

/**
 * Registra a correcao humana da transcricao.
 *
 * O texto original vem do **servidor**, lido da transcricao persistida, e nunca
 * do cliente. Aceitar o original enviado pela pagina permitiria que ela
 * declarasse o que o ASR teria dito — e a comparacao entre original e corrigido
 * e exatamente a evidencia que esta tabela guarda.
 */
export async function submitTranscriptCorrection(
  client: Client,
  userId: string,
  submission: TranscriptCorrectionSubmission,
): Promise<FeedbackOutcome> {
  const { data: transcript } = await client
    .from("session_transcripts")
    .select("id,content,source,status")
    .eq("session_id", submission.sessionId)
    .maybeSingle();

  // Sem transcricao disponivel nao ha o que corrigir. Criar uma "correcao" de
  // texto inexistente inventaria uma fala que nunca foi reconhecida.
  if (!transcript?.content || transcript.status !== "available") {
    return { status: "no_transcript" };
  }

  const corrected = submission.correctedText.trim();
  if (corrected === transcript.content) return { status: "unchanged" };

  const existing = await findTranscriptCorrections(client, submission.sessionId);
  const revision = existing.reduce((top, row) => Math.max(top, row.revision), 0) + 1;

  try {
    const row = await insertTranscriptCorrection(client, {
      session_id: submission.sessionId,
      user_id: userId,
      transcript_id: transcript.id,
      // Copiado do servidor, no momento da correcao.
      original_content: transcript.content,
      corrected_content: corrected,
      original_source: transcript.source,
      revision,
      /*
        Explicito, e nao apenas o default da coluna.

        Escrever `false` aqui deixa a decisao visivel no codigo: quem ler este
        insert ve que a correcao NAO entra em dataset, em vez de precisar
        descobrir isso na definicao da tabela. O trigger recusaria `true` de
        qualquer forma.
      */
      training_eligible: false,
    });
    return { status: "corrected", revision: row.revision };
  } catch {
    return { status: "denied" };
  }
}

export async function revokeCorrection(
  client: Client,
  sessionId: string,
  revision: number,
): Promise<FeedbackOutcome> {
  try {
    await revokeTranscriptCorrection(client, sessionId, revision);
    return { status: "correction_removed" };
  } catch {
    return { status: "denied" };
  }
}
