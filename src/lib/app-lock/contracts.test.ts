import { describe, expect, it } from "vitest";

import {
  APP_LOCK_IDLE_POLICY,
  APP_LOCK_STATE,
  appLockDeadline,
  cooldownMsForAttempt,
  effectiveAppLockState,
  isValidAppLockPin,
} from "@/lib/app-lock/contracts";

describe("contrato do App Lock", () => {
  it("aceita somente PIN numerico de 6 a 8 digitos", () => {
    expect(isValidAppLockPin("123456")).toBe(true);
    expect(isValidAppLockPin("12345678")).toBe(true);
    for (const invalid of ["12345", "123456789", "12 4567", "abcdef", "１２３４５６"]) {
      expect(isValidAppLockPin(invalid)).toBe(false);
    }
  });

  it("aplica cooldown progressivo com teto de quinze minutos", () => {
    expect([1, 2, 3, 4].map(cooldownMsForAttempt)).toEqual([0, 0, 0, 0]);
    expect([5, 6, 7, 8, 9, 30].map(cooldownMsForAttempt)).toEqual([
      30_000, 60_000, 120_000, 300_000, 900_000, 900_000,
    ]);
  });

  it("deriva COOLDOWN e expira UNLOCKED sem booleanos paralelos", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    expect(effectiveAppLockState({
      state: APP_LOCK_STATE.LOCKED,
      cooldownUntil: "2026-09-20T12:00:30.000Z",
      unlockedUntil: null,
    }, now)).toBe(APP_LOCK_STATE.COOLDOWN);
    expect(effectiveAppLockState({
      state: APP_LOCK_STATE.UNLOCKED,
      cooldownUntil: null,
      unlockedUntil: "2026-09-20T11:59:59.000Z",
    }, now)).toBe(APP_LOCK_STATE.LOCKED);
  });

  it("deriva o prazo pela politica e nunca nao cria auto-unlock reverso", () => {
    const now = new Date("2026-09-20T12:00:00.000Z");
    expect(appLockDeadline(APP_LOCK_IDLE_POLICY.ONE_MINUTE, now))
      .toBe("2026-09-20T12:01:00.000Z");
    expect(appLockDeadline(APP_LOCK_IDLE_POLICY.THIRTY_MINUTES, now))
      .toBe("2026-09-20T12:30:00.000Z");
    expect(appLockDeadline(APP_LOCK_IDLE_POLICY.NEVER, now)).toBeNull();
    expect(effectiveAppLockState({
      state: APP_LOCK_STATE.UNLOCKED,
      cooldownUntil: null,
      unlockedUntil: null,
      idlePolicy: APP_LOCK_IDLE_POLICY.NEVER,
    }, now)).toBe(APP_LOCK_STATE.UNLOCKED);
    expect(effectiveAppLockState({
      state: APP_LOCK_STATE.LOCKED,
      cooldownUntil: null,
      unlockedUntil: null,
      idlePolicy: APP_LOCK_IDLE_POLICY.NEVER,
    }, now)).toBe(APP_LOCK_STATE.LOCKED);
  });
});
