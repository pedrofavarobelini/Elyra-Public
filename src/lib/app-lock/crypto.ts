import {
  DEFAULT_APP_LOCK_IDLE_POLICY,
  APP_LOCK_LOCAL_KDF,
  APP_LOCK_STATE,
  appLockDeadline,
  type AppLockIdlePolicy,
  type LocalAppLockRecord,
} from "@/lib/app-lock/contracts";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await globalThis.crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    APP_LOCK_LOCAL_KDF.keyBytes * 8,
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

export async function createLocalAppLock(
  userId: string,
  lockId: string,
  pin: string,
  now: Date = new Date(),
  idlePolicy: AppLockIdlePolicy = DEFAULT_APP_LOCK_IDLE_POLICY,
): Promise<LocalAppLockRecord> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(APP_LOCK_LOCAL_KDF.saltBytes));
  const verifier = await derive(pin, salt, APP_LOCK_LOCAL_KDF.iterations);
  return {
    userId,
    lockId,
    state: APP_LOCK_STATE.UNLOCKED,
    salt: toBase64(salt),
    verifier: toBase64(verifier),
    kdfVersion: APP_LOCK_LOCAL_KDF.version,
    iterations: APP_LOCK_LOCAL_KDF.iterations,
    failedAttempts: 0,
    cooldownUntil: null,
    unlockedUntil: appLockDeadline(idlePolicy, now),
    lastActivityAt: now.toISOString(),
    idlePolicy,
    lastAttemptAt: null,
  };
}

export async function verifyLocalAppLockPin(
  pin: string,
  record: LocalAppLockRecord,
): Promise<boolean> {
  if (
    record.kdfVersion !== APP_LOCK_LOCAL_KDF.version ||
    record.iterations !== APP_LOCK_LOCAL_KDF.iterations
  ) return false;
  const actual = await derive(pin, fromBase64(record.salt), record.iterations);
  return constantTimeEqual(actual, fromBase64(record.verifier));
}
