"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";

import { consumeRateLimit, rateLimitIdentity } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/server/auth";
import { appendAudit } from "@/server/repositories/identity-repository";



export type EnrollmentStart =
  | { status: "ready"; factorId: string; qrCode: string; secret: string }
  | { status: "error"; message: string };

export type MfaFormState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

const INDISPONIVEL =
  "Não foi possível concluir agora. Nada mudou; tente de novo em instantes.";
const CODIGO_INVALIDO =
  "Código não confere. Use o código atual do aplicativo autenticador.";
const MUITAS_TENTATIVAS =
  "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.";
const ATIVADO =
  "Verificação em duas etapas ativada. A partir do próximo login, a Elyra vai pedir o código.";
const DESATIVADO =
  "Verificação em duas etapas desativada. Sua conta volta a entrar apenas com a senha.";

function normalizarCodigo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const limpo = raw.replace(/\s+/g, "");
  return /^\d{6}$/.test(limpo) ? limpo : null;
}

async function contexto() {
  const { supabase, user } = await requireAuthenticatedUser();
  const requestHeaders = await headers();
  const identity = rateLimitIdentity(user.id, requestHeaders.get("x-forwarded-for"));
  return { supabase, user, identity };
}

async function auditar(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  action: string,
  entityId: string,
  outcome?: "denied",
) {
  try {
    await appendAudit(supabase, {
      actorUserId: userId,
      action,
      entityType: "auth_factor",
      entityId,
      ...(outcome ? { outcome } : {}),
      correlationId: crypto.randomUUID(),
    });
  } catch {
    // A operacao de credencial ja aconteceu; auditoria falha nao a desfaz.
    console.warn("elyra.mfa_audit_failed");
  }
}

/** Passo 1: cria o fator (ainda `unverified`) e devolve QR e segredo. */
export async function startTotpEnrollmentAction(): Promise<EnrollmentStart> {
  const ctx = await contexto();
  if (!consumeRateLimit("auth", ctx.identity).allowed) {
    return { status: "error", message: MUITAS_TENTATIVAS };
  }

  /*
    Fator `unverified` de uma tentativa anterior e removido antes de criar outro:
    o GoTrue limita fatores por conta, e deixar lixo acumulado faria o segundo
    "Ativar" falhar sem a pessoa entender por que.
  */
  const existentes = await ctx.supabase.auth.mfa.listFactors();
  if (existentes.error || !existentes.data) {
    console.warn("elyra.mfa_factors_unavailable");
    return { status: "error", message: INDISPONIVEL };
  }
  for (const fator of existentes.data?.totp ?? []) {
    if (fator.status !== "verified") {
      const cleanup = await ctx.supabase.auth.mfa.unenroll({ factorId: fator.id });
      if (cleanup.error) {
        console.warn("elyra.mfa_enrollment_cleanup_failed");
        return { status: "error", message: INDISPONIVEL };
      }
    }
  }

  const enroll = await ctx.supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `Elyra ${new Date().toISOString().slice(0, 10)}`,
  });
  if (enroll.error || !enroll.data?.totp) {
    console.warn("elyra.mfa_enroll_failed");
    return { status: "error", message: INDISPONIVEL };
  }

  await auditar(ctx.supabase, ctx.user.id, "auth.mfa.enroll_started", enroll.data.id);
  return {
    status: "ready",
    factorId: enroll.data.id,
    qrCode: enroll.data.totp.qr_code,
    secret: enroll.data.totp.secret,
  };
}

/** Passo 2: confirma o codigo e deixa o fator `verified`. */
export async function confirmTotpEnrollmentAction(
  _previous: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const factorId = formData.get("factorId");
  const codigo = normalizarCodigo(formData.get("code"));
  if (typeof factorId !== "string" || !factorId) {
    return { status: "error", message: INDISPONIVEL };
  }
  if (!codigo) return { status: "error", message: CODIGO_INVALIDO };

  const ctx = await contexto();
  if (!consumeRateLimit("auth", ctx.identity).allowed) {
    return { status: "error", message: MUITAS_TENTATIVAS };
  }

  const desafio = await ctx.supabase.auth.mfa.challenge({ factorId });
  if (desafio.error || !desafio.data) {
    console.warn("elyra.mfa_challenge_failed");
    return { status: "error", message: INDISPONIVEL };
  }

  const verificado = await ctx.supabase.auth.mfa.verify({
    factorId,
    challengeId: desafio.data.id,
    code: codigo,
  });
  if (verificado.error) {
    await auditar(ctx.supabase, ctx.user.id, "auth.mfa.enroll_confirmed", factorId, "denied");
    return { status: "error", message: CODIGO_INVALIDO };
  }

  await auditar(ctx.supabase, ctx.user.id, "auth.mfa.enroll_confirmed", factorId);
  revalidatePath("/seguranca");
  return { status: "done", message: ATIVADO };
}

/** Desativa: exige o codigo atual — desligar 2FA nao pode ser mais facil que ligar. */
export async function disableTotpAction(
  _previous: MfaFormState,
  formData: FormData,
): Promise<MfaFormState> {
  const codigo = normalizarCodigo(formData.get("code"));
  if (!codigo) return { status: "error", message: CODIGO_INVALIDO };

  const ctx = await contexto();
  if (!consumeRateLimit("auth", ctx.identity).allowed) {
    return { status: "error", message: MUITAS_TENTATIVAS };
  }

  const fatores = await ctx.supabase.auth.mfa.listFactors();
  if (fatores.error || !fatores.data) {
    console.warn("elyra.mfa_factors_unavailable");
    return { status: "error", message: INDISPONIVEL };
  }
  const totp = (fatores.data?.totp ?? []).find((fator) => fator.status === "verified");
  if (!totp) return { status: "error", message: INDISPONIVEL };

  const desafio = await ctx.supabase.auth.mfa.challenge({ factorId: totp.id });
  if (desafio.error || !desafio.data) return { status: "error", message: INDISPONIVEL };

  const verificado = await ctx.supabase.auth.mfa.verify({
    factorId: totp.id,
    challengeId: desafio.data.id,
    code: codigo,
  });
  if (verificado.error) {
    await auditar(ctx.supabase, ctx.user.id, "auth.mfa.disabled", totp.id, "denied");
    return { status: "error", message: CODIGO_INVALIDO };
  }

  const removido = await ctx.supabase.auth.mfa.unenroll({ factorId: totp.id });
  if (removido.error) {
    console.warn("elyra.mfa_unenroll_failed");
    return { status: "error", message: INDISPONIVEL };
  }

  await auditar(ctx.supabase, ctx.user.id, "auth.mfa.disabled", totp.id);
  revalidatePath("/seguranca");
  return { status: "done", message: DESATIVADO };
}
