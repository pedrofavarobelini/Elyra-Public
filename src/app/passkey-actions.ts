"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { PasskeyCredentialJSON, PasskeyOptionsJSON } from "@/lib/passkeys";
import { consumeRateLimit, rateLimitIdentity } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedUser } from "@/server/auth";
import { MFA_VERIFICATION_PATH, mfaStatus } from "@/server/auth-mfa";
import { mfaPathFor, parseAuthContext } from "@/lib/contracts/auth-context";
import { postAuthDestination } from "@/server/auth-context";

const base64url = z.string().min(1).max(8192).regex(/^[A-Za-z0-9_-]+$/);
const attachment = z.enum(["platform", "cross-platform"]).nullable().optional();
const common = {
  id: base64url,
  rawId: base64url,
  type: z.literal("public-key"),
  clientExtensionResults: z.record(z.unknown()),
  authenticatorAttachment: attachment,
};
const registrationCredential = z.object({
  ...common,
  response: z.object({
    attestationObject: base64url,
    authenticatorData: base64url.optional(),
    clientDataJSON: base64url,
    publicKey: base64url.optional(),
    publicKeyAlgorithm: z.number().int().min(-65536).max(65536).optional(),
    transports: z.array(z.string().max(32)).max(16).optional(),
  }).strict(),
}).strict();
const authenticationCredential = z.object({
  ...common,
  response: z.object({
    authenticatorData: base64url,
    clientDataJSON: base64url,
    signature: base64url,
    userHandle: base64url.optional(),
  }).strict(),
}).strict();
const completion = <T extends z.ZodTypeAny>(credential: T) => z.object({
  challengeId: z.string().uuid(),
  credential,
}).strict();

export type PasskeyInfo = {
  id: string;
  friendlyName?: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type PasskeyStartResult =
  | { status: "ready"; challengeId: string; options: PasskeyOptionsJSON }
  | { status: "error"; code: string; message: string };

export type PasskeyFinishResult =
  | { status: "done"; passkey?: PasskeyInfo; next?: string }
  | { status: "error"; code: string; message: string };

const IDENTITY_MISMATCH = {
  code: "passkey_identity_mismatch",
  message: "A sessão não correspondeu à chave de acesso. Nenhum acesso foi mantido; use outra forma de entrar.",
} as const;

function messageFor(error: unknown): { code: string; message: string } {
  const code = typeof error === "object" && error && "code" in error && typeof error.code === "string"
    ? error.code
    : "passkey_unavailable";
  if (code === "passkey_disabled") {
    return { code, message: "Chaves de acesso ainda não estão habilitadas neste ambiente." };
  }
  if (code === "webauthn_credential_not_found") {
    return { code, message: "Esta chave de acesso não foi encontrada. Use outra forma de entrar." };
  }
  if (code === "webauthn_verification_failed") {
    return { code, message: "Esta chave não pôde ser verificada. Use outra forma de entrar." };
  }
  if (code === "webauthn_challenge_expired" || code === "webauthn_challenge_not_found") {
    return { code, message: "A tentativa expirou. Comece novamente." };
  }
  if (code === "webauthn_credential_exists") {
    return { code, message: "Esta chave já está cadastrada na conta." };
  }
  return { code, message: "Não foi possível usar a chave de acesso. Nada mudou; tente novamente." };
}

async function allowed(userId: string | null) {
  const requestHeaders = await headers();
  return consumeRateLimit("auth", rateLimitIdentity(userId, requestHeaders.get("x-forwarded-for"))).allowed;
}

function info(value: { id: string; friendly_name?: string; created_at: string; last_used_at?: string }): PasskeyInfo {
  return {
    id: value.id,
    ...(value.friendly_name ? { friendlyName: value.friendly_name } : {}),
    createdAt: value.created_at,
    ...(value.last_used_at ? { lastUsedAt: value.last_used_at } : {}),
  };
}

/**
 * Confirma que a sessão materializada pelo Supabase pertence ao usuário que a
 * operação acabou de autenticar. O GoTrue já vincula credential_id a user_id;
 * esta segunda checagem protege a fronteira SSR contra cookie residual ou uma
 * regressão do SDK experimental. Divergência encerra a sessão local e falha
 * fechada, sem registrar qualquer identificador.
 */
async function sessionMatchesUser(
  client: Awaited<ReturnType<typeof createClient>>,
  expectedUserId: string,
): Promise<boolean> {
  const current = await client.auth.getUser();
  return !current.error && current.data.user?.id === expectedUserId;
}

async function rejectIdentityMismatch(client: Awaited<ReturnType<typeof createClient>>) {
  try {
    await client.auth.signOut({ scope: "local" });
  } catch {
    // A resposta continua fail-closed mesmo se o provedor estiver indisponível.
  }
  console.warn("elyra.passkey_identity_mismatch");
  return { status: "error", ...IDENTITY_MISMATCH } as const;
}

export async function getPasskeysState(client: Awaited<ReturnType<typeof createClient>>): Promise<{
  available: boolean;
  passkeys: PasskeyInfo[];
}> {
  try {
    const result = await client.auth.passkey.list();
    if (result.error || !result.data) return { available: false, passkeys: [] };
    return { available: true, passkeys: result.data.map(info) };
  } catch {
    return { available: false, passkeys: [] };
  }
}

export async function startPasskeySignInAction(): Promise<PasskeyStartResult> {
  if (!(await allowed(null))) {
    return { status: "error", code: "rate_limited", message: "Muitas tentativas. Aguarde um minuto." };
  }
  const supabase = await createClient();
  try {
    const result = await supabase.auth.passkey.startAuthentication();
    if (result.error || !result.data) return { status: "error", ...messageFor(result.error) };
    return { status: "ready", challengeId: result.data.challenge_id, options: result.data.options as PasskeyOptionsJSON };
  } catch (error) {
    return { status: "error", ...messageFor(error) };
  }
}

export async function finishPasskeySignInAction(
  input: {
    challengeId: string;
    credential: PasskeyCredentialJSON;
  },

  // revalidados aqui (allowlist e caminho interno). Nao autorizam nada.
  entry: { context?: unknown; next?: unknown } = {},
): Promise<PasskeyFinishResult> {
  if (!(await allowed(null))) {
    return { status: "error", code: "rate_limited", message: "Muitas tentativas. Aguarde um minuto." };
  }
  const parsed = completion(authenticationCredential).safeParse(input);
  if (!parsed.success) return { status: "error", code: "invalid_response", message: "Resposta da chave inválida." };
  const supabase = await createClient();
  try {
    const payload = parsed.data as unknown as Parameters<
      typeof supabase.auth.passkey.verifyAuthentication
    >[0];
    const result = await supabase.auth.passkey.verifyAuthentication(payload);
    if (result.error || !result.data?.session || !result.data.user) {
      return { status: "error", ...messageFor(result.error) };
    }
    if (
      result.data.session.user.id !== result.data.user.id ||
      !(await sessionMatchesUser(supabase, result.data.user.id))
    ) {
      return rejectIdentityMismatch(supabase);
    }
    const destino = await postAuthDestination(supabase, result.data.user.id, {
      intent: parseAuthContext(entry.context),
      next: typeof entry.next === "string" ? entry.next : null,
    });
    const next = (await mfaStatus(supabase)) === "pending" ? mfaPathFor(destino, MFA_VERIFICATION_PATH) : destino;
    return { status: "done", next };
  } catch (error) {
    return { status: "error", ...messageFor(error) };
  }
}

export async function startPasskeyRegistrationAction(): Promise<PasskeyStartResult> {
  const auth = await requireAuthenticatedUser();
  if (!(await allowed(auth.user.id))) {
    return { status: "error", code: "unauthorized", message: "Entre novamente para cadastrar uma chave." };
  }
  if ((await mfaStatus(auth.supabase)) === "pending") {
    return { status: "error", code: "mfa_required", message: "Confirme o segundo fator antes de continuar." };
  }
  try {
    const result = await auth.supabase.auth.passkey.startRegistration();
    if (result.error || !result.data) return { status: "error", ...messageFor(result.error) };
    return {
      status: "ready",
      challengeId: result.data.challenge_id,
      options: result.data.options as unknown as PasskeyOptionsJSON,
    };
  } catch (error) {
    return { status: "error", ...messageFor(error) };
  }
}

export async function finishPasskeyRegistrationAction(input: {
  challengeId: string;
  credential: PasskeyCredentialJSON;
}): Promise<PasskeyFinishResult> {
  const auth = await requireAuthenticatedUser();
  if (!(await allowed(auth.user.id))) {
    return { status: "error", code: "unauthorized", message: "Entre novamente para cadastrar uma chave." };
  }
  if ((await mfaStatus(auth.supabase)) === "pending") {
    return { status: "error", code: "mfa_required", message: "Confirme o segundo fator antes de continuar." };
  }
  const parsed = completion(registrationCredential).safeParse(input);
  if (!parsed.success) return { status: "error", code: "invalid_response", message: "Resposta da chave inválida." };
  try {
    const payload = parsed.data as unknown as Parameters<
      typeof auth.supabase.auth.passkey.verifyRegistration
    >[0];
    const result = await auth.supabase.auth.passkey.verifyRegistration(payload);
    if (result.error || !result.data) return { status: "error", ...messageFor(result.error) };
    if (!(await sessionMatchesUser(auth.supabase, auth.user.id))) {
      return rejectIdentityMismatch(auth.supabase);
    }
    revalidatePath("/seguranca");
    return { status: "done", passkey: info(result.data) };
  } catch (error) {
    return { status: "error", ...messageFor(error) };
  }
}

export async function deletePasskeyAction(passkeyId: string): Promise<PasskeyFinishResult> {
  const parsed = z.string().uuid().safeParse(passkeyId);
  const auth = await requireAuthenticatedUser();
  if (!parsed.success || !(await allowed(auth.user.id))) {
    return { status: "error", code: "unauthorized", message: "Não foi possível remover esta chave." };
  }
  if ((await mfaStatus(auth.supabase)) === "pending") {
    return { status: "error", code: "mfa_required", message: "Confirme o segundo fator antes de continuar." };
  }
  try {
    const result = await auth.supabase.auth.passkey.delete({ passkeyId: parsed.data });
    if (result.error) return { status: "error", ...messageFor(result.error) };
    revalidatePath("/seguranca");
    return { status: "done" };
  } catch (error) {
    return { status: "error", ...messageFor(error) };
  }
}
