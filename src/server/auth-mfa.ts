import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";



export const MFA_VERIFICATION_PATH = "/entrar/verificacao" as const;

/** Codigo devolvido pelas rotas de API quando a sessao ainda esta em `aal1`. */
export const MFA_REQUIRED_CODE = "MFA_REQUIRED" as const;
export const MFA_REQUIRED_MESSAGE =
  "Confirme o código do seu aplicativo autenticador para continuar." as const;

export type MfaStatus = "not_required" | "pending" | "satisfied";

type AalClient = Pick<SupabaseClient, "auth">;


export async function mfaStatus(client: AalClient): Promise<MfaStatus> {
  const mfa = client.auth?.mfa;
  if (typeof mfa?.getAuthenticatorAssuranceLevel !== "function") {
    throw new Error("mfa_verification_unavailable");
  }
  let result;
  try {
    result = await mfa.getAuthenticatorAssuranceLevel();
  } catch {
    // Nao propagar mensagem do provedor: ela pode conter detalhes de sessao.
    throw new Error("mfa_verification_unavailable");
  }
  const { data, error } = result;
  if (
    error || !data ||
    !["aal1", "aal2"].includes(data.currentLevel ?? "") ||
    !["aal1", "aal2"].includes(data.nextLevel ?? "")
  ) throw new Error("mfa_verification_unavailable");
  if (data.nextLevel !== "aal2") return "not_required";
  return data.currentLevel === "aal2" ? "satisfied" : "pending";
}

/** Ha fator TOTP verificado nesta conta? */
export async function hasVerifiedTotp(client: AalClient): Promise<boolean> {
  const mfa = client.auth?.mfa;
  if (typeof mfa?.listFactors !== "function") {
    throw new Error("mfa_factors_unavailable");
  }
  let result;
  try {
    result = await mfa.listFactors();
  } catch {
    throw new Error("mfa_factors_unavailable");
  }
  const { data, error } = result;
  if (error || !data) throw new Error("mfa_factors_unavailable");
  return (data.totp ?? []).some((factor) => factor.status === "verified");
}
