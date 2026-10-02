"use server";

import {
  CURRENT_TERMS_PRIVACY_VERSION,
  TERMS_CONTENT_UNAVAILABLE_MESSAGE,
  TERMS_DOCUMENTS_AVAILABLE,
  TERMS_PRIVACY_PURPOSE,
  hasActiveTermsGrant,
  type FirstAccessState,
} from "@/lib/contracts/consent";
import { redirectToInternalPath } from "@/lib/security/internal-redirect";
import {
  consumeRateLimit,
  rateLimitIdentity,
} from "@/lib/security/rate-limit";
import { requireAuthenticatedUser } from "@/server/auth";
import {
  appendAudit,
  appendConsentGrant,
} from "@/server/repositories/identity-repository";
import { getConsentHistory } from "@/server/services/consent-service";

/**
 * Registrar o aceite dos termos, no primeiro acesso autenticado.
 *
 * ## A recusa vive aqui, e nao no botao
 *
 * Enquanto os documentos nao existirem, esta acao **recusa**. Desabilitar o
 * botao na tela nao seria protecao: botao desabilitado e HTML, e HTML se
 * contorna com uma requisicao. A regra que importa vive no servidor.
 *
 * O que se recusa a fazer e especifico: gravar um `consent_event` afirmando que
 * a pessoa aceitou Termos de Uso e Politica de Privacidade que o produto nao
 * tem. Isso nao seria um registro fraco — seria um registro **falso**, e o log
 * de consentimento e append-only justamente para poder ser levado a serio.
 *
 * ## Idempotencia
 *
 * Antes de gravar, a acao pergunta se ja ha concessao vigente. Recarregar,
 * clicar duas vezes ou voltar por outra aba nao produz um segundo evento; a
 * pessoa apenas segue para o destino. Nao ha `unique` no banco de proposito: ele
 * quebraria o ciclo conceder -> revogar -> conceder que o 23-B provou.
 */
export async function acceptTermsAction(
  _previous: FirstAccessState,
  formData: FormData,
): Promise<FirstAccessState> {
  const { supabase, user } = await requireAuthenticatedUser();

  /*
    Chaveado pelo usuario: aqui ja ha sessao, e o que se quer conter e repeticao
    automatizada contra a acao que grava consentimento — nao a rede de onde ela
    parte.
  */
  if (!consumeRateLimit("consentAccept", rateLimitIdentity(user.id, null)).allowed) {
    return {
      status: "error",
      message: "Muitas tentativas. Aguarde alguns instantes e tente novamente.",
    };
  }

  // Revalidado aqui mesmo tendo vindo de campo oculto ja validado: o campo e
  // enviado pelo cliente, e quem envia escolhe o que manda.
  const destino = formData.get("next")?.toString();

  if (!TERMS_DOCUMENTS_AVAILABLE) {
    return { status: "error", message: TERMS_CONTENT_UNAVAILABLE_MESSAGE };
  }

  // Aceite explicito: a caixa nunca nasce marcada, e a acao nao presume o clique.
  if (formData.get("acceptedTerms") !== "on") {
    return {
      status: "error",
      message: "Marque a confirmação para continuar.",
    };
  }

  const history = await getConsentHistory(supabase);
  if (hasActiveTermsGrant(history)) redirectToInternalPath(destino);

  try {
    const consent = await appendConsentGrant(supabase, {
      userId: user.id,
      purpose: TERMS_PRIVACY_PURPOSE,
      documentVersion: CURRENT_TERMS_PRIVACY_VERSION,
    });
    await appendAudit(supabase, {
      actorUserId: user.id,
      action: "consent.first_access",
      entityType: "consent_event",
      entityId: consent.id,
      correlationId: crypto.randomUUID(),
    });
  } catch {
    return {
      status: "error",
      message: "Não foi possível registrar seu aceite. Tente novamente.",
    };
  }

  redirectToInternalPath(destino);
}
