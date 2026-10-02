"use server";

import { headers } from "next/headers";

import { consumeRateLimit, rateLimitIdentity } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { appendAudit } from "@/server/repositories/identity-repository";



export type MfaChallengeState =
  | { status: "idle" }
  | { status: "verified" }
  | { status: "error"; message: string };

const CODIGO_INVALIDO =
  "Código não confere. Abra o aplicativo autenticador e use o código atual.";
const SEM_FATOR =
  "Esta conta não tem verificação em duas etapas ativa. Entre normalmente.";
const INDISPONIVEL =
  "Não foi possível verificar agora. Nada mudou; tente de novo em instantes.";
const MUITAS_TENTATIVAS =
  "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.";

/** Aceita `123456` ou `123 456`; qualquer outra coisa nem chega ao servidor de auth. */
function normalizarCodigo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const limpo = raw.replace(/\s+/g, "");
  return /^\d{6}$/.test(limpo) ? limpo : null;
}

export async function verifyMfaChallengeAction(
  _previous: MfaChallengeState,
  formData: FormData,
): Promise<MfaChallengeState> {
  const codigo = normalizarCodigo(formData.get("code"));
  if (!codigo) return { status: "error", message: CODIGO_INVALIDO };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: INDISPONIVEL };

  const requestHeaders = await headers();
  const identity = rateLimitIdentity(user.id, requestHeaders.get("x-forwarded-for"));
  // Balde `auth`: adivinhar codigo de seis digitos e exatamente o abuso que ele corta.
  if (!consumeRateLimit("auth", identity).allowed) {
    return { status: "error", message: MUITAS_TENTATIVAS };
  }

  const fatores = await supabase.auth.mfa.listFactors();
  if (fatores.error || !fatores.data) {
    console.warn("elyra.mfa_factors_unavailable");
    return { status: "error", message: INDISPONIVEL };
  }
  const totp = (fatores.data?.totp ?? []).find((fator) => fator.status === "verified");
  if (!totp) return { status: "error", message: SEM_FATOR };

  const desafio = await supabase.auth.mfa.challenge({ factorId: totp.id });
  if (desafio.error || !desafio.data) {
    console.warn("elyra.mfa_challenge_failed");
    return { status: "error", message: INDISPONIVEL };
  }

  const verificacao = await supabase.auth.mfa.verify({
    factorId: totp.id,
    challengeId: desafio.data.id,
    code: codigo,
  });
  if (verificacao.error) {
    try {
      await appendAudit(supabase, {
        actorUserId: user.id,
        action: "auth.mfa.verify",
        entityType: "auth_factor",
        entityId: totp.id,
        outcome: "denied",
        correlationId: crypto.randomUUID(),
      });
    } catch {
      console.warn("elyra.mfa_audit_failed");
    }
    return { status: "error", message: CODIGO_INVALIDO };
  }

  try {
    await appendAudit(supabase, {
      actorUserId: user.id,
      action: "auth.mfa.verify",
      entityType: "auth_factor",
      entityId: totp.id,
      correlationId: crypto.randomUUID(),
    });
  } catch {
    console.warn("elyra.mfa_audit_failed");
  }

  return { status: "verified" };
}
