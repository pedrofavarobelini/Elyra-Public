"use server";

import { headers } from "next/headers";

import {
  consumeRateLimit,
  rateLimitIdentity,
} from "@/lib/security/rate-limit";
import { requireAuthenticatedUser } from "@/server/auth";
import { appendAudit } from "@/server/repositories/identity-repository";

export type OtherSessionsState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

const OTHER_SESSIONS_DONE_MESSAGE =
  "Pronto. Os outros aparelhos vão precisar entrar de novo. Este aparelho continua conectado.";

const OTHER_SESSIONS_ERROR_MESSAGE =
  "Não foi possível encerrar as outras sessões agora. Nada mudou; tente de novo em instantes.";


export async function signOutOtherSessionsAction(): Promise<OtherSessionsState> {
  const { supabase, user } = await requireAuthenticatedUser();

  const requestHeaders = await headers();
  const identity = rateLimitIdentity(user.id, requestHeaders.get("x-forwarded-for"));
  if (!consumeRateLimit("auth", identity).allowed) {
    return {
      status: "error",
      message: "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.",
    };
  }

  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) {
    console.warn("elyra.sign_out_others_failed");
    return { status: "error", message: OTHER_SESSIONS_ERROR_MESSAGE };
  }

  try {
    await appendAudit(supabase, {
      actorUserId: user.id,
      action: "auth.sessions.others_revoked",
      entityType: "auth_session",
      entityId: user.id,
      correlationId: crypto.randomUUID(),
    });
  } catch {
    // A revogacao ja aconteceu; falhar a auditoria nao pode desfaze-la na tela.
    console.warn("elyra.sign_out_others_audit_failed");
  }

  return { status: "done", message: OTHER_SESSIONS_DONE_MESSAGE };
}
