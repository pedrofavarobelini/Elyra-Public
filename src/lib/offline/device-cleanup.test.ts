import { beforeEach, describe, expect, it, vi } from "vitest";

const cleared = vi.hoisted(() => ({ support: 0 }));
vi.mock("@/lib/support-network/offline-cache", () => ({
  clearSupportNetworkCache: () => {
    cleared.support += 1;
  },
}));

import { OFFLINE_SCHEMA_VERSION, OUTBOX_DOMAIN, OUTBOX_KIND } from "./contracts";
import { createMemoryStore } from "./db";
import { enqueue } from "./sync-engine";
import { clearDeviceOnLogout } from "./device-cleanup";

describe("limpeza unica de logout (OFF-4)", () => {
  beforeEach(() => {
    cleared.support = 0;
  });

  async function seeded(userId: string) {
    const store = createMemoryStore();
    await store.putDevice({ key: "current", userId, displayName: "P", initials: "P", verifiedAt: new Date().toISOString(), schemaVersion: OFFLINE_SCHEMA_VERSION });
    await store.putSnapshot({ userId, savedAt: new Date().toISOString(), data: { journal: [{ id: "x" }] } });
    await enqueue(store, { userId, domain: OUTBOX_DOMAIN.JOURNAL, kind: OUTBOX_KIND.CREATE, entityId: "e", dependsOn: null, request: { path: "/api/journal/entries", method: "POST", body: {} } });
    return store;
  }

  it("com userId: apaga fila, snapshot, aparelho e a lista da Rede de Apoio", async () => {
    const store = await seeded("u1");
    await clearDeviceOnLogout({ userId: "u1", store });
    expect(await store.getSnapshot("u1")).toBeNull();
    expect(await store.listOutbox("u1")).toEqual([]);
    expect(await store.getDevice()).toBeNull();
    expect(cleared.support).toBe(1);
  });

  it("sem userId (logout na area profissional): apaga o usuario registrado no aparelho", async () => {
    const store = await seeded("u2");
    await clearDeviceOnLogout({ store });
    expect(await store.getSnapshot("u2")).toBeNull();
    expect(await store.getDevice()).toBeNull();
    expect(cleared.support).toBe(1);
  });
});
