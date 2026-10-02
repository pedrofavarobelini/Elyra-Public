"use server";

import { z } from "zod";

import {
  APP_LOCK_IDLE_POLICY,
  APP_LOCK_PIN_PATTERN,
  type AppLockIdlePolicy,
  type AppLockSummary,
} from "@/lib/app-lock/contracts";
import { requireAuthenticatedUser } from "@/server/auth";
import {
  activateAppLock,
  AppLockUnavailableError,
  disableAppLock,
  lockAppLock,
  touchAppLock,
  unlockAppLock,
  updateAppLockIdlePolicy,
} from "@/server/app-lock";

const pinSchema = z.string().regex(APP_LOCK_PIN_PATTERN).max(8);
const activationSchema = z.object({
  lockId: z.string().uuid(),
  pin: pinSchema,
  idlePolicy: z.enum(Object.values(APP_LOCK_IDLE_POLICY) as [AppLockIdlePolicy, ...AppLockIdlePolicy[]]),
}).strict();
const idlePolicySchema = z.enum(
  Object.values(APP_LOCK_IDLE_POLICY) as [AppLockIdlePolicy, ...AppLockIdlePolicy[]],
);

export type AppLockActionResult =
  | { status: "done"; summary: AppLockSummary }
  | { status: "invalid" | "cooldown"; summary: AppLockSummary; message: string }
  | { status: "error"; code: string; message: string };

function unavailable(error: unknown): AppLockActionResult {
  if (error instanceof AppLockUnavailableError) {
    return {
      status: "error",
      code: "app_lock_unavailable",
      message: "Não foi possível verificar o bloqueio agora. Tente novamente.",
    };
  }
  return {
    status: "error",
    code: "app_lock_failed",
    message: "Não foi possível concluir esta ação do App Lock.",
  };
}

export async function activateAppLockAction(input: unknown): Promise<AppLockActionResult> {
  const parsed = activationSchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", code: "invalid_pin", message: "Use um PIN de 6 a 8 dígitos." };
  }
  const { supabase, user } = await requireAuthenticatedUser();
  try {
    return {
      status: "done",
      summary: await activateAppLock(
        supabase,
        user.id,
        parsed.data.lockId,
        parsed.data.pin,
        parsed.data.idlePolicy,
      ),
    };
  } catch (error) {
    return unavailable(error);
  }
}

export async function updateAppLockIdlePolicyAction(input: unknown): Promise<AppLockActionResult> {
  const parsed = idlePolicySchema.safeParse(input);
  if (!parsed.success) {
    return { status: "error", code: "invalid_idle_policy", message: "Escolha um prazo válido." };
  }
  const { supabase, user } = await requireAuthenticatedUser();
  try {
    return {
      status: "done",
      summary: await updateAppLockIdlePolicy(supabase, user.id, parsed.data),
    };
  } catch (error) {
    return unavailable(error);
  }
}

export async function lockAppLockAction(): Promise<AppLockActionResult> {
  const { supabase, user } = await requireAuthenticatedUser();
  try {
    return { status: "done", summary: await lockAppLock(supabase, user.id) };
  } catch (error) {
    return unavailable(error);
  }
}

export async function touchAppLockAction(): Promise<AppLockActionResult> {
  const { supabase, user } = await requireAuthenticatedUser();
  try {
    return { status: "done", summary: await touchAppLock(supabase, user.id) };
  } catch (error) {
    return unavailable(error);
  }
}

export async function unlockAppLockAction(pin: unknown): Promise<AppLockActionResult> {
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success) {
    return { status: "error", code: "invalid_pin", message: "Use um PIN de 6 a 8 dígitos." };
  }
  const { supabase, user } = await requireAuthenticatedUser({ allowLocked: true });
  try {
    const result = await unlockAppLock(supabase, user.id, parsed.data);
    if (result.status === "unlocked") return { status: "done", summary: result.summary };
    return {
      status: result.status,
      summary: result.summary,
      message: result.status === "cooldown"
        ? "Muitas tentativas. Aguarde antes de tentar novamente."
        : "PIN incorreto.",
    };
  } catch (error) {
    return unavailable(error);
  }
}

export async function disableAppLockAction(pin: unknown): Promise<AppLockActionResult> {
  const parsed = pinSchema.safeParse(pin);
  if (!parsed.success) {
    return { status: "error", code: "invalid_pin", message: "Use um PIN de 6 a 8 dígitos." };
  }
  const { supabase, user } = await requireAuthenticatedUser();
  try {
    const result = await disableAppLock(supabase, user.id, parsed.data);
    if (result.status === "unlocked") return { status: "done", summary: result.summary };
    return {
      status: result.status,
      summary: result.summary,
      message: result.status === "cooldown"
        ? "Muitas tentativas. Aguarde antes de tentar novamente."
        : "PIN incorreto.",
    };
  } catch (error) {
    return unavailable(error);
  }
}
