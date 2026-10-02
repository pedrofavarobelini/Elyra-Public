import { describe, expect, it } from "vitest";

import { APP_LOCK_LOCAL_KDF } from "@/lib/app-lock/contracts";
import { createLocalAppLock, verifyLocalAppLockPin } from "@/lib/app-lock/crypto";

describe("verificador offline do App Lock", () => {
  it("confere o PIN correto e recusa o incorreto", async () => {
    const record = await createLocalAppLock("user-a", crypto.randomUUID(), "123456");
    await expect(verifyLocalAppLockPin("123456", record)).resolves.toBe(true);
    await expect(verifyLocalAppLockPin("654381", record)).resolves.toBe(false);
  });

  it("usa salt independente e nunca serializa o PIN", async () => {
    const first = await createLocalAppLock("user-a", crypto.randomUUID(), "123456");
    const second = await createLocalAppLock("user-a", crypto.randomUUID(), "123456");
    expect(first.salt).not.toBe(second.salt);
    expect(first.verifier).not.toBe(second.verifier);
    expect(JSON.stringify(first)).not.toContain("123456");
    expect(first.iterations).toBe(APP_LOCK_LOCAL_KDF.iterations);
  });

  it("recusa parametros KDF adulterados em vez de aceitar custo menor", async () => {
    const record = await createLocalAppLock("user-a", crypto.randomUUID(), "123456");

    await expect(
      verifyLocalAppLockPin("123456", { ...record, iterations: 1 }),
    ).resolves.toBe(false);
  });
});
