"use server";

import { revalidatePath } from "next/cache";

import {
  feedbackSubmissionSchema,
  transcriptCorrectionSubmissionSchema,
  FEEDBACK_ACTION_MESSAGE,
  type FeedbackActionState,
} from "@/lib/contracts/feedback";
import { requireAuthenticatedUser } from "@/server/auth";
import {
  removeFeedback,
  revokeCorrection,
  submitFeedback,
  submitTranscriptCorrection,
} from "@/server/services/feedback-service";

/**
 * Acoes de feedback e correcao.
 *
 * ## Uma acao por card, e nao uma por botao
 *
 * Avaliar e desavaliar sao a mesma decisao sobre o mesmo alvo, e por isso vivem
 * numa acao so. Com duas, a tela ganhava dois estados independentes e passava a
 * exibir o **primeiro** que tivesse mensagem: quem removesse a avaliacao
 * continuava lendo "sua avaliacao foi registrada" — a tela afirmando o oposto do
 * que acabara de acontecer. Um estado, uma mensagem, sem ordem para desempatar.
 *
 * ## Identidade
 *
 * Vem **sempre** da sessao autenticada, e nunca do formulario. Um `user_id`
 * vindo do cliente permitiria avaliar e corrigir em nome de outra pessoa — a RLS
 * recusaria, mas depender disso deixaria a intencao errada viva no codigo.
 */

async function authenticated() {
  const { supabase, user } = await requireAuthenticatedUser();
  return { client: supabase, userId: user.id };
}

/**
 * Avalia, reavalia ou remove a avaliacao de um alvo.
 *
 * `rating=clear` e a remocao. Ela e um valor do mesmo campo porque e a mesma
 * decisao: o que a pessoa acha daquele alvo, incluindo "nada".
 */
export async function rateAction(
  _state: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const session = await authenticated();

  const sessionId = String(formData.get("sessionId") ?? "");
  const targetType = String(formData.get("targetType") ?? "");
  const rating = String(formData.get("rating") ?? "");

  if (rating === "clear") {
    const parsed = feedbackSubmissionSchema.safeParse({
      sessionId,
      targetType,
      targetId: null,
      // A forma exige uma nota; o `delete` nao a usa. Validar assim mesmo
      // garante que `sessionId` e `targetType` chegaram bem formados.
      rating: "positive",
      reason: null,
    });
    if (!parsed.success) {
      return { message: FEEDBACK_ACTION_MESSAGE.invalid, ok: false };
    }

    const removed = await removeFeedback(session.client, {
      sessionId: parsed.data.sessionId,
      targetType: parsed.data.targetType,
    });
    if (removed.status !== "removed") {
      return { message: FEEDBACK_ACTION_MESSAGE.denied, ok: false };
    }
    revalidatePath(`/sessoes/${sessionId}`);
    return { message: FEEDBACK_ACTION_MESSAGE.removed, ok: true };
  }

  const parsed = feedbackSubmissionSchema.safeParse({
    sessionId,
    targetType,
    targetId: formData.get("targetId") || null,
    rating,
    reason: formData.get("reason") || null,
  });
  if (!parsed.success) {
    return { message: FEEDBACK_ACTION_MESSAGE.invalid, ok: false };
  }

  const outcome = await submitFeedback(
    session.client,
    session.userId,
    parsed.data,
  );
  if (outcome.status === "invalid_target") {
    return { message: FEEDBACK_ACTION_MESSAGE.invalidTarget, ok: false };
  }
  if (outcome.status !== "saved") {
    return { message: FEEDBACK_ACTION_MESSAGE.denied, ok: false };
  }

  revalidatePath(`/sessoes/${parsed.data.sessionId}`);
  return { message: FEEDBACK_ACTION_MESSAGE.saved, ok: true };
}

/**
 * Salva ou revoga a correcao da transcricao.
 *
 * Como na avaliacao, as duas sao a mesma decisao sobre o mesmo texto e
 * compartilham um estado. Nenhuma delas toca o transcript original.
 */
export async function correctionAction(
  _state: FeedbackActionState,
  formData: FormData,
): Promise<FeedbackActionState> {
  const session = await authenticated();

  const sessionId = String(formData.get("sessionId") ?? "");

  if (formData.get("intent") === "revoke") {
    const revision = Number(formData.get("revision"));
    if (!Number.isInteger(revision) || revision < 1) {
      return { message: FEEDBACK_ACTION_MESSAGE.invalid, ok: false };
    }
    const revoked = await revokeCorrection(session.client, sessionId, revision);
    if (revoked.status !== "correction_removed") {
      return { message: FEEDBACK_ACTION_MESSAGE.denied, ok: false };
    }
    revalidatePath(`/sessoes/${sessionId}`);
    return { message: FEEDBACK_ACTION_MESSAGE.correctionRemoved, ok: true };
  }

  const parsed = transcriptCorrectionSubmissionSchema.safeParse({
    sessionId,
    correctedText: formData.get("correctedText"),
  });
  if (!parsed.success) {
    return { message: FEEDBACK_ACTION_MESSAGE.invalid, ok: false };
  }

  const outcome = await submitTranscriptCorrection(
    session.client,
    session.userId,
    parsed.data,
  );
  if (outcome.status === "unchanged") {
    return { message: FEEDBACK_ACTION_MESSAGE.unchanged, ok: false };
  }
  if (outcome.status !== "corrected") {
    return { message: FEEDBACK_ACTION_MESSAGE.denied, ok: false };
  }

  revalidatePath(`/sessoes/${parsed.data.sessionId}`);
  return { message: FEEDBACK_ACTION_MESSAGE.corrected, ok: true };
}
