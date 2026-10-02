import { describe, expect, it } from "vitest";

import { APP_LOCK_IDLE_POLICY, APP_LOCK_STATE } from "@/lib/app-lock/contracts";
import { createLocalAppLock } from "@/lib/app-lock/crypto";
import { alignLocalAppLock, persistLocalAppLock, removeLocalAppLock, unlockLocalAppLock } from "@/lib/app-lock/local";
import { OFFLINE_SCHEMA_VERSION } from "@/lib/offline/contracts";
import { clearLocalUserData, createMemoryStore, type OfflineStore } from "@/lib/offline/db";

describe("estado local do App Lock", () => {
  it("isola registros por usuário e a limpeza de A não toca B", async () => {
    const store = createMemoryStore();
    const a = await createLocalAppLock("user-a", crypto.randomUUID(), "123456");
    const b = await createLocalAppLock("user-b", crypto.randomUUID(), "654381");
    await store.putAppLock(a);
    await store.putAppLock(b);
    await clearLocalUserData(store, "user-a");
    await expect(store.getAppLock("user-a")).resolves.toBeNull();
    await expect(store.getAppLock("user-b")).resolves.toEqual(b);
  });

  it("persiste tentativas e entra em cooldown no quinto erro", async () => {
    const store = createMemoryStore();
    const now = new Date("2026-09-20T12:00:00.000Z");
    await store.putAppLock(await createLocalAppLock("user-a", crypto.randomUUID(), "123456", now));
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await unlockLocalAppLock(store, "user-a", "000000", now);
      expect(result.status).toBe("invalid");
    }
    const persisted = await store.getAppLock("user-a");
    expect(persisted).toMatchObject({ state: APP_LOCK_STATE.COOLDOWN, failedAttempts: 5 });
    expect(Date.parse(persisted!.cooldownUntil!)).toBe(now.getTime() + 30_000);
    await expect(unlockLocalAppLock(store, "user-a", "123456", now)).resolves.toMatchObject({
      status: "cooldown",
    });
  });

  it("desbloqueia com PIN correto e reseta a penalidade", async () => {
    const store = createMemoryStore();
    const record = await createLocalAppLock("user-a", crypto.randomUUID(), "123456");
    await store.putAppLock({ ...record, state: APP_LOCK_STATE.LOCKED, failedAttempts: 3 });
    const result = await unlockLocalAppLock(store, "user-a", "123456");
    expect(result).toMatchObject({
      status: "unlocked",
      record: { state: APP_LOCK_STATE.UNLOCKED, failedAttempts: 0, cooldownUntil: null },
    });
  });

  it("remove material obsoleto quando a sessão tem outro lockId", async () => {
    const store = createMemoryStore();
    await store.putAppLock(await createLocalAppLock("user-a", crypto.randomUUID(), "123456"));
    await expect(alignLocalAppLock(store, "user-a", {
      state: APP_LOCK_STATE.LOCKED,
      lockId: crypto.randomUUID(),
      failedAttempts: 0,
      cooldownUntil: null,
      unlockedUntil: null,
      lastActivityAt: null,
      idlePolicy: APP_LOCK_IDLE_POLICY.FIVE_MINUTES,
    })).resolves.toBeNull();
    await expect(store.getAppLock("user-a")).resolves.toBeNull();
  });

  it("persiste a politica e renova o prazo a partir de atividade real", async () => {
    const store = createMemoryStore();
    const started = new Date("2026-09-20T12:00:00.000Z");
    const record = await createLocalAppLock(
      "user-a",
      crypto.randomUUID(),
      "123456",
      started,
      APP_LOCK_IDLE_POLICY.ONE_MINUTE,
    );
    await store.putAppLock(record);
    const touched = await import("@/lib/app-lock/local").then(({ touchLocalAppLock }) =>
      touchLocalAppLock(store, "user-a", new Date("2026-09-20T12:00:40.000Z")),
    );
    expect(touched).toMatchObject({
      idlePolicy: APP_LOCK_IDLE_POLICY.ONE_MINUTE,
      lastActivityAt: "2026-09-20T12:00:40.000Z",
      unlockedUntil: "2026-09-20T12:01:40.000Z",
    });
  });

  it("OFF-5: trocar o appLockId nunca desfaz uma verificacao gravada no meio (prazo offline renova)", async () => {
    const base = createMemoryStore();
    const old = "2026-09-01T00:00:00.000Z";
    const fresh = "2026-09-28T12:00:00.000Z";
    await base.putDevice({ key: "current", userId: "u1", displayName: "P", initials: "P", verifiedAt: old, schemaVersion: OFFLINE_SCHEMA_VERSION, appLockId: "lock-1" });
    // Ordem medida no navegador: a leitura do aparelho acontece antes da
    // verificacao online gravar; a escrita do App Lock chega depois dela.
    const stale = await base.getDevice();
    const store: OfflineStore = {
      ...base,
      getDevice: async () => stale,
      deleteAppLock: async (userId) => {
        await base.deleteAppLock(userId);
        await base.putDevice({ ...stale!, verifiedAt: fresh });
      },
    };
    await removeLocalAppLock(store, "u1");
    expect(await base.getDevice()).toMatchObject({ verifiedAt: fresh, appLockId: null });

    const lock = await createLocalAppLock("u1", crypto.randomUUID(), "123456");
    await persistLocalAppLock(base, lock);
    expect(await base.getDevice()).toMatchObject({ verifiedAt: fresh, appLockId: lock.lockId });
    // Aparelho de outra pessoa: nada muda.
    await base.setDeviceAppLockId("outra", null);
    expect(await base.getDevice()).toMatchObject({ appLockId: lock.lockId });
  });
});
