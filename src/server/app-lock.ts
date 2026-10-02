import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_APP_LOCK_IDLE_POLICY,
  APP_LOCK_STATE,
  appLockDeadline,
  cooldownMsForAttempt,
  disabledAppLock,
  effectiveAppLockState,
  normalizeAppLockIdlePolicy,
  type AppLockIdlePolicy,
  type AppLockSummary,
} from "@/lib/app-lock/contracts";
import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;
type Row = Database["public"]["Tables"]["app_lock_sessions"]["Row"];

const SCRYPT = {
  version: 1,
  cost: 32_768,
  blockSize: 8,
  parallelization: 1,
  keyBytes: 32,
  saltBytes: 16,
  maxmem: 64 * 1024 * 1024,
} as const;

export class AppLockUnavailableError extends Error {
  constructor(readonly reason: string) {
    super("app_lock_unavailable");
    this.name = "AppLockUnavailableError";
  }
}

function derive(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(pin, salt, SCRYPT.keyBytes, {
      cost: SCRYPT.cost,
      blockSize: SCRYPT.blockSize,
      parallelization: SCRYPT.parallelization,
      maxmem: SCRYPT.maxmem,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}

export async function deriveServerAppLockVerifier(pin: string, suppliedSalt?: Buffer) {
  const salt = suppliedSalt ?? randomBytes(SCRYPT.saltBytes);
  const verifier = await derive(pin, salt);
  return {
    salt: salt.toString("base64"),
    verifier: verifier.toString("base64"),
    kdfVersion: SCRYPT.version,
    cost: SCRYPT.cost,
    blockSize: SCRYPT.blockSize,
    parallelization: SCRYPT.parallelization,
  };
}

export async function verifyServerAppLockVerifier(
  pin: string,
  material: Pick<Row, "kdf_version" | "scrypt_n" | "scrypt_r" | "scrypt_p" | "pin_salt" | "pin_verifier">,
): Promise<boolean> {
  if (
    material.kdf_version !== SCRYPT.version ||
    material.scrypt_n !== SCRYPT.cost ||
    material.scrypt_r !== SCRYPT.blockSize ||
    material.scrypt_p !== SCRYPT.parallelization
  ) return false;
  const expected = Buffer.from(material.pin_verifier, "base64");
  const actual = await derive(pin, Buffer.from(material.pin_salt, "base64"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function summary(row: Row, now: Date = new Date()): AppLockSummary {
  const idlePolicy = normalizeAppLockIdlePolicy(row.idle_policy);
  const state = effectiveAppLockState({
    state: row.state === APP_LOCK_STATE.UNLOCKED ? APP_LOCK_STATE.UNLOCKED : APP_LOCK_STATE.LOCKED,
    cooldownUntil: row.cooldown_until,
    unlockedUntil: row.unlocked_until,
    idlePolicy,
  }, now);
  return {
    state,
    lockId: row.lock_id,
    failedAttempts: row.failed_attempts,
    cooldownUntil: row.cooldown_until,
    unlockedUntil: row.unlocked_until,
    lastActivityAt: row.last_activity_at,
    idlePolicy,
  };
}

async function currentRow(client: Client, userId: string): Promise<Row | null> {
  const result = await client
    .from("app_lock_sessions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (result.error) throw new AppLockUnavailableError(result.error.code ?? "select");
  return result.data;
}

async function currentSessionId(client: Client): Promise<string> {
  const result = await client.auth.getClaims();
  const sessionId = result.data?.claims?.session_id;
  if (result.error || typeof sessionId !== "string" || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
    throw new AppLockUnavailableError("session_claim");
  }
  return sessionId;
}

export async function getAppLockSummary(
  client: Client,
  userId: string,
  now: Date = new Date(),
): Promise<AppLockSummary> {
  const row = await currentRow(client, userId);
  if (!row) return disabledAppLock();
  const value = summary(row, now);
  if (value.state === APP_LOCK_STATE.LOCKED && row.state === APP_LOCK_STATE.UNLOCKED) {
    const update = await client
      .from("app_lock_sessions")
      .update({ state: APP_LOCK_STATE.LOCKED })
      .eq("user_id", userId)
      .eq("session_id", row.session_id)
      .eq("state", APP_LOCK_STATE.UNLOCKED);
    if (update.error) throw new AppLockUnavailableError(update.error.code ?? "expire");
  }
  return value;
}

export async function activateAppLock(
  client: Client,
  userId: string,
  lockId: string,
  pin: string,
  idlePolicy: AppLockIdlePolicy = DEFAULT_APP_LOCK_IDLE_POLICY,
  now: Date = new Date(),
): Promise<AppLockSummary> {
  if (await currentRow(client, userId)) throw new Error("app_lock_already_enabled");
  const sessionId = await currentSessionId(client);
  const material = await deriveServerAppLockVerifier(pin);
  const unlockedUntil = appLockDeadline(idlePolicy, now);
  const result = await client.from("app_lock_sessions").insert({
    user_id: userId,
    session_id: sessionId,
    lock_id: lockId,
    state: APP_LOCK_STATE.UNLOCKED,
    pin_salt: material.salt,
    pin_verifier: material.verifier,
    kdf_version: SCRYPT.version,
    scrypt_n: SCRYPT.cost,
    scrypt_r: SCRYPT.blockSize,
    scrypt_p: SCRYPT.parallelization,
    failed_attempts: 0,
    cooldown_until: null,
    last_activity_at: now.toISOString(),
    unlocked_until: unlockedUntil,
    idle_policy: idlePolicy,
  }).select("*").single();
  if (result.error || !result.data) {
    throw new AppLockUnavailableError(result.error?.code ?? "insert");
  }
  return summary(result.data, now);
}

export async function lockAppLock(client: Client, userId: string): Promise<AppLockSummary> {
  const row = await currentRow(client, userId);
  if (!row) return disabledAppLock();
  const result = await client.from("app_lock_sessions").update({
    state: APP_LOCK_STATE.LOCKED,
    unlocked_until: null,
  }).eq("user_id", userId).eq("session_id", row.session_id).select("*").single();
  if (result.error || !result.data) throw new AppLockUnavailableError(result.error?.code ?? "lock");
  return summary(result.data);
}

export async function touchAppLock(
  client: Client,
  userId: string,
  now: Date = new Date(),
): Promise<AppLockSummary> {
  const row = await currentRow(client, userId);
  if (!row) return disabledAppLock();
  if (summary(row, now).state !== APP_LOCK_STATE.UNLOCKED) return lockAppLock(client, userId);
  const result = await client.from("app_lock_sessions").update({
    last_activity_at: now.toISOString(),
    unlocked_until: appLockDeadline(normalizeAppLockIdlePolicy(row.idle_policy), now),
  }).eq("user_id", userId).eq("session_id", row.session_id).eq("state", APP_LOCK_STATE.UNLOCKED)
    .select("*").maybeSingle();
  if (result.error || !result.data) throw new AppLockUnavailableError(result.error?.code ?? "touch");
  return summary(result.data, now);
}

export type UnlockResult =
  | { status: "unlocked"; summary: AppLockSummary }
  | { status: "invalid" | "cooldown"; summary: AppLockSummary };

export async function unlockAppLock(
  client: Client,
  userId: string,
  pin: string,
  now: Date = new Date(),
): Promise<UnlockResult> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await currentRow(client, userId);
    if (!row) return { status: "invalid", summary: disabledAppLock() };
    const before = summary(row, now);
    if (before.state === APP_LOCK_STATE.COOLDOWN) return { status: "cooldown", summary: before };
    const correct = await verifyServerAppLockVerifier(pin, row);
    const failedAttempts = correct ? 0 : row.failed_attempts + 1;
    const delay = correct ? 0 : cooldownMsForAttempt(failedAttempts);
    const update = await client.from("app_lock_sessions").update(correct ? {
      state: APP_LOCK_STATE.UNLOCKED,
      failed_attempts: 0,
      cooldown_until: null,
      last_activity_at: now.toISOString(),
      unlocked_until: appLockDeadline(normalizeAppLockIdlePolicy(row.idle_policy), now),
    } : {
      state: APP_LOCK_STATE.LOCKED,
      failed_attempts: failedAttempts,
      cooldown_until: delay > 0 ? new Date(now.getTime() + delay).toISOString() : null,
      unlocked_until: null,
      last_activity_at: now.toISOString(),
    }).eq("user_id", userId).eq("session_id", row.session_id)
      .eq("failed_attempts", row.failed_attempts).select("*").maybeSingle();
    if (update.error) throw new AppLockUnavailableError(update.error.code ?? "attempt");
    if (!update.data) continue;
    return {
      status: correct ? "unlocked" : "invalid",
      summary: summary(update.data, now),
    };
  }
  throw new AppLockUnavailableError("attempt_race");
}

export async function updateAppLockIdlePolicy(
  client: Client,
  userId: string,
  idlePolicy: AppLockIdlePolicy,
  now: Date = new Date(),
): Promise<AppLockSummary> {
  const row = await currentRow(client, userId);
  if (!row) return disabledAppLock();
  const unlocked = summary(row, now).state === APP_LOCK_STATE.UNLOCKED;
  const result = await client.from("app_lock_sessions").update({
    idle_policy: idlePolicy,
    last_activity_at: unlocked ? now.toISOString() : row.last_activity_at,
    unlocked_until: unlocked ? appLockDeadline(idlePolicy, now) : null,
  }).eq("user_id", userId).eq("session_id", row.session_id).select("*").single();
  if (result.error || !result.data) {
    throw new AppLockUnavailableError(result.error?.code ?? "idle_policy");
  }
  return summary(result.data, now);
}

export async function disableAppLock(
  client: Client,
  userId: string,
  pin: string,
  now: Date = new Date(),
): Promise<UnlockResult> {
  const verified = await unlockAppLock(client, userId, pin, now);
  if (verified.status !== "unlocked") return verified;
  const removal = await client.from("app_lock_sessions").delete().eq("user_id", userId);
  if (removal.error) throw new AppLockUnavailableError(removal.error.code ?? "delete");
  return { status: "unlocked", summary: disabledAppLock() };
}

export async function clearCurrentAppLock(client: Client, userId: string): Promise<void> {
  const result = await client.from("app_lock_sessions").delete().eq("user_id", userId);
  if (result.error) throw new AppLockUnavailableError(result.error.code ?? "clear");
}
