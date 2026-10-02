import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import {
  decodeLastContext,
  encodeLastContext,
  LAST_CONTEXT_COOKIE,
  LAST_CONTEXT_MAX_AGE_SECONDS,
  resolvePostAuthPath,
  type AuthContext,
  type ProfessionalCapability,
} from "@/lib/contracts/auth-context";
import { professionalStateFrom, type ProfessionalState } from "@/lib/contracts/professional-state";
import { effectiveVerificationStatus } from "@/lib/contracts/professional-verification";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

/**
 * Estado profissional da propria conta (F1; RLS: so as linhas do dono).
 *
 * Serve para **navegacao** e para o portao das rotas `/pro` (so VERIFIED).
 * Nao autoriza dado de terceiro - isso e o banco. Falha de leitura vira
 * `NO_PROFILE` aqui (a pessoa fica na area pessoal); o portao usa
 * `readProfessionalState`, que distingue falha de ausencia.
 */
export async function getProfessionalCapability(client: Client, userId: string): Promise<ProfessionalCapability> {
  const read = await readProfessionalState(client, userId);
  return read.ok ? read.state : "NO_PROFILE";
}

export async function readProfessionalState(
  client: Client,
  userId: string,
): Promise<{ ok: true; state: ProfessionalState } | { ok: false }> {
  try {
    const [profile, onboarding] = await Promise.all([
      client
        .from("professional_profiles")
        .select("verification_status, verification_review_due_at")
        .eq("user_id", userId)
        .maybeSingle(),
      client.from("professional_onboarding").select("user_id").eq("user_id", userId).maybeSingle(),
    ]);
    if (profile.error || onboarding.error) return { ok: false };
    const effectiveStatus = profile.data
      ? effectiveVerificationStatus(profile.data.verification_status, profile.data.verification_review_due_at)
      : null;
    return { ok: true, state: professionalStateFrom({ effectiveStatus, hasOnboardingDraft: Boolean(onboarding.data) }) };
  } catch {
    return { ok: false };
  }
}

export async function readLastContext(userId: string): Promise<AuthContext | null> {
  try {
    const store = await cookies();
    return decodeLastContext(store.get(LAST_CONTEXT_COOKIE)?.value, userId);
  } catch {
    // Fora de uma requisicao nao ha preferencia - e ausencia nunca leva ao portal.
    return null;
  }
}

/**
 * Grava a preferencia. So funciona onde o Next permite escrever cookie
 * (Server Action e Route Handler); `httpOnly` porque nenhum script precisa ler.
 */
export async function rememberContext(userId: string, context: AuthContext) {
  const store = await cookies();
  store.set(LAST_CONTEXT_COOKIE, encodeLastContext(userId, context), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LAST_CONTEXT_MAX_AGE_SECONDS,
  });
}

/**
 * Destino depois de autenticar (senha, Google, passkey, MFA). Intencao
 * explicita vira a nova preferencia da conta.
 */
export async function postAuthDestination(
  client: Client,
  userId: string,
  input: { intent: AuthContext | null; next?: string | null },
): Promise<string> {
  const [capability, lastContext] = await Promise.all([
    getProfessionalCapability(client, userId),
    readLastContext(userId),
  ]);
  if (input.intent) {
    try {
      await rememberContext(userId, input.intent);
    } catch {
      // Server Component nao grava cookie; a preferencia e so conveniencia.
    }
  }
  return resolvePostAuthPath({ next: input.next, intent: input.intent, lastContext, capability });
}
