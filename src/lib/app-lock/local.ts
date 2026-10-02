import {
  APP_LOCK_STATE,
  appLockDeadline,
  cooldownMsForAttempt,
  effectiveAppLockState,
  normalizeAppLockIdlePolicy,
  type AppLockSummary,
  type LocalAppLockRecord,
} from "@/lib/app-lock/contracts";
import { verifyLocalAppLockPin } from "@/lib/app-lock/crypto";
import type { OfflineStore } from "@/lib/offline/db";

export const APP_LOCK_CHANNEL = "elyra-app-lock";
export const APP_LOCK_SOURCE_ID = globalThis.crypto?.randomUUID?.() ?? "elyra-app-lock-source";

export type AppLockBroadcast = {
  type: "APP_LOCK_CHANGED";
  userId: string;
  summary: AppLockSummary;
  sourceId: string;
};

export function broadcastAppLock(userId: string, summary: AppLockSummary): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(APP_LOCK_CHANNEL);
  channel.postMessage({
    type: "APP_LOCK_CHANGED",
    userId,
    summary,
    sourceId: APP_LOCK_SOURCE_ID,
  } satisfies AppLockBroadcast);
  channel.close();
}

export function localAppLockSummary(
  record: LocalAppLockRecord,
  now: Date = new Date(),
): AppLockSummary {
  return {
    state: effectiveAppLockState(record, now),
    lockId: record.lockId,
    failedAttempts: record.failedAttempts,
    cooldownUntil: record.cooldownUntil,
    unlockedUntil: record.unlockedUntil,
    lastActivityAt: record.lastActivityAt ?? null,
    idlePolicy: normalizeAppLockIdlePolicy(record.idlePolicy),
  };
}

export async function persistLocalAppLock(
  store: OfflineStore,
  record: LocalAppLockRecord,
): Promise<void> {
  await store.putAppLock(record);
  await store.setDeviceAppLockId(record.userId, record.lockId);
}

export async function removeLocalAppLock(store: OfflineStore, userId: string): Promise<void> {
  await store.deleteAppLock(userId);
  await store.setDeviceAppLockId(userId, null);
}

export async function lockLocalAppLock(
  store: OfflineStore,
  userId: string,
): Promise<LocalAppLockRecord | null> {
  const current = await store.getAppLock(userId);
  if (!current) return null;
  const next: LocalAppLockRecord = {
    ...current,
    state: APP_LOCK_STATE.LOCKED,
    unlockedUntil: null,
  };
  await store.putAppLock(next);
  return next;
}

export async function touchLocalAppLock(
  store: OfflineStore,
  userId: string,
  now: Date = new Date(),
): Promise<LocalAppLockRecord | null> {
  const current = await store.getAppLock(userId);
  if (!current || effectiveAppLockState(current, now) !== APP_LOCK_STATE.UNLOCKED) return current;
  const idlePolicy = normalizeAppLockIdlePolicy(current.idlePolicy);
  const next: LocalAppLockRecord = {
    ...current,
    idlePolicy,
    lastActivityAt: now.toISOString(),
    unlockedUntil: appLockDeadline(idlePolicy, now),
  };
  await store.putAppLock(next);
  return next;
}

export type LocalUnlockResult = {
  status: "unlocked" | "invalid" | "cooldown" | "missing";
  record: LocalAppLockRecord | null;
};

export async function unlockLocalAppLock(
  store: OfflineStore,
  userId: string,
  pin: string,
  now: Date = new Date(),
): Promise<LocalUnlockResult> {
  const current = await store.getAppLock(userId);
  if (!current) return { status: "missing", record: null };

  const previousAttempt = current.lastAttemptAt ? Date.parse(current.lastAttemptAt) : Number.NaN;
  if (!Number.isNaN(previousAttempt) && now.getTime() + 5_000 < previousAttempt) {
    const rollback: LocalAppLockRecord = {
      ...current,
      state: APP_LOCK_STATE.COOLDOWN,
      failedAttempts: Math.max(9, current.failedAttempts),
      cooldownUntil: new Date(now.getTime() + 900_000).toISOString(),
      unlockedUntil: null,
      lastAttemptAt: now.toISOString(),
    };
    await store.putAppLock(rollback);
    return { status: "cooldown", record: rollback };
  }

  if (effectiveAppLockState(current, now) === APP_LOCK_STATE.COOLDOWN) {
    return { status: "cooldown", record: current };
  }

  const correct = await verifyLocalAppLockPin(pin, current);
  if (correct) {
    const idlePolicy = normalizeAppLockIdlePolicy(current.idlePolicy);
    const unlocked: LocalAppLockRecord = {
      ...current,
      state: APP_LOCK_STATE.UNLOCKED,
      failedAttempts: 0,
      cooldownUntil: null,
      unlockedUntil: appLockDeadline(idlePolicy, now),
      lastActivityAt: now.toISOString(),
      idlePolicy,
      lastAttemptAt: now.toISOString(),
    };
    await store.putAppLock(unlocked);
    return { status: "unlocked", record: unlocked };
  }

  const failedAttempts = current.failedAttempts + 1;
  const delay = cooldownMsForAttempt(failedAttempts);
  const failed: LocalAppLockRecord = {
    ...current,
    state: delay > 0 ? APP_LOCK_STATE.COOLDOWN : APP_LOCK_STATE.LOCKED,
    failedAttempts,
    cooldownUntil: delay > 0 ? new Date(now.getTime() + delay).toISOString() : null,
    unlockedUntil: null,
    lastAttemptAt: now.toISOString(),
  };
  await store.putAppLock(failed);
  return { status: "invalid", record: failed };
}

export async function alignLocalAppLock(
  store: OfflineStore,
  userId: string,
  server: AppLockSummary,
): Promise<LocalAppLockRecord | null> {
  if (server.state === APP_LOCK_STATE.DISABLED) {
    await removeLocalAppLock(store, userId);
    return null;
  }
  const current = await store.getAppLock(userId);
  if (!current || current.lockId !== server.lockId) {
    await store.deleteAppLock(userId);
    return null;
  }
  const next: LocalAppLockRecord = {
    ...current,
    state: server.state === APP_LOCK_STATE.UNLOCKED ? APP_LOCK_STATE.UNLOCKED : server.state,
    failedAttempts: server.failedAttempts,
    cooldownUntil: server.cooldownUntil,
    unlockedUntil: server.unlockedUntil,
    lastActivityAt: server.lastActivityAt,
    idlePolicy: server.idlePolicy,
  };
  await store.putAppLock(next);
  return next;
}
