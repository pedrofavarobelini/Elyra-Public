export const APP_LOCK_STATE = {
  DISABLED: "DISABLED",
  UNLOCKED: "UNLOCKED",
  LOCKED: "LOCKED",
  COOLDOWN: "COOLDOWN",
} as const;

export type AppLockState = (typeof APP_LOCK_STATE)[keyof typeof APP_LOCK_STATE];

export const APP_LOCK_PIN_PATTERN = /^\d{6,8}$/;
export const APP_LOCK_IDLE_POLICY = {
  ONE_MINUTE: "1m",
  FIVE_MINUTES: "5m",
  FIFTEEN_MINUTES: "15m",
  THIRTY_MINUTES: "30m",
  NEVER: "never",
} as const;
export type AppLockIdlePolicy =
  (typeof APP_LOCK_IDLE_POLICY)[keyof typeof APP_LOCK_IDLE_POLICY];
export const DEFAULT_APP_LOCK_IDLE_POLICY: AppLockIdlePolicy = APP_LOCK_IDLE_POLICY.FIVE_MINUTES;
export const APP_LOCK_IDLE_OPTIONS: ReadonlyArray<{
  value: AppLockIdlePolicy;
  label: string;
}> = [
  { value: APP_LOCK_IDLE_POLICY.ONE_MINUTE, label: "1 minuto" },
  { value: APP_LOCK_IDLE_POLICY.FIVE_MINUTES, label: "5 minutos" },
  { value: APP_LOCK_IDLE_POLICY.FIFTEEN_MINUTES, label: "15 minutos" },
  { value: APP_LOCK_IDLE_POLICY.THIRTY_MINUTES, label: "30 minutos" },
  { value: APP_LOCK_IDLE_POLICY.NEVER, label: "Nunca automaticamente" },
];
export const APP_LOCK_ACTIVITY_THROTTLE_MS = 10 * 1000;
export const APP_LOCK_LOCAL_KDF = {
  name: "PBKDF2-SHA256",
  version: 1,
  iterations: 600_000,
  keyBytes: 32,
  saltBytes: 16,
} as const;

export interface AppLockSummary {
  state: AppLockState;
  lockId: string | null;
  failedAttempts: number;
  cooldownUntil: string | null;
  unlockedUntil: string | null;
  lastActivityAt: string | null;
  idlePolicy: AppLockIdlePolicy;
}

export interface LocalAppLockRecord {
  userId: string;
  lockId: string;
  state: Exclude<AppLockState, "DISABLED">;
  salt: string;
  verifier: string;
  kdfVersion: 1;
  iterations: number;
  failedAttempts: number;
  cooldownUntil: string | null;
  unlockedUntil: string | null;
  lastActivityAt: string | null;
  idlePolicy: AppLockIdlePolicy;
  lastAttemptAt: string | null;
}

export function isAppLockIdlePolicy(value: unknown): value is AppLockIdlePolicy {
  return Object.values(APP_LOCK_IDLE_POLICY).includes(value as AppLockIdlePolicy);
}

export function normalizeAppLockIdlePolicy(value: unknown): AppLockIdlePolicy {
  return isAppLockIdlePolicy(value) ? value : DEFAULT_APP_LOCK_IDLE_POLICY;
}

export function appLockDeadline(
  policy: AppLockIdlePolicy,
  now: Date = new Date(),
): string | null {
  const duration = {
    [APP_LOCK_IDLE_POLICY.ONE_MINUTE]: 60_000,
    [APP_LOCK_IDLE_POLICY.FIVE_MINUTES]: 5 * 60_000,
    [APP_LOCK_IDLE_POLICY.FIFTEEN_MINUTES]: 15 * 60_000,
    [APP_LOCK_IDLE_POLICY.THIRTY_MINUTES]: 30 * 60_000,
    [APP_LOCK_IDLE_POLICY.NEVER]: null,
  }[policy];
  return duration === null ? null : new Date(now.getTime() + duration).toISOString();
}

export function isValidAppLockPin(pin: string): boolean {
  return APP_LOCK_PIN_PATTERN.test(pin);
}

export function cooldownMsForAttempt(failedAttempts: number): number {
  if (failedAttempts < 5) return 0;
  if (failedAttempts === 5) return 30_000;
  if (failedAttempts === 6) return 60_000;
  if (failedAttempts === 7) return 120_000;
  if (failedAttempts === 8) return 300_000;
  return 900_000;
}

export function effectiveAppLockState(
  value: Pick<AppLockSummary, "state" | "cooldownUntil" | "unlockedUntil"> &
    Partial<Pick<AppLockSummary, "idlePolicy">>,
  now: Date = new Date(),
): AppLockState {
  if (value.state === APP_LOCK_STATE.DISABLED) return APP_LOCK_STATE.DISABLED;
  const nowMs = now.getTime();
  const cooldown = value.cooldownUntil ? Date.parse(value.cooldownUntil) : Number.NaN;
  if (!Number.isNaN(cooldown) && cooldown > nowMs) return APP_LOCK_STATE.COOLDOWN;
  if (value.state === APP_LOCK_STATE.LOCKED || value.state === APP_LOCK_STATE.COOLDOWN) {
    return APP_LOCK_STATE.LOCKED;
  }
  if ("idlePolicy" in value && value.idlePolicy === APP_LOCK_IDLE_POLICY.NEVER) {
    return APP_LOCK_STATE.UNLOCKED;
  }
  const unlocked = value.unlockedUntil ? Date.parse(value.unlockedUntil) : Number.NaN;
  return !Number.isNaN(unlocked) && unlocked > nowMs
    ? APP_LOCK_STATE.UNLOCKED
    : APP_LOCK_STATE.LOCKED;
}

export function disabledAppLock(): AppLockSummary {
  return {
    state: APP_LOCK_STATE.DISABLED,
    lockId: null,
    failedAttempts: 0,
    cooldownUntil: null,
    unlockedUntil: null,
    lastActivityAt: null,
    idlePolicy: DEFAULT_APP_LOCK_IDLE_POLICY,
  };
}
