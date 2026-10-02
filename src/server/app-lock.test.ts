import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let deriveServerAppLockVerifier: typeof import("@/server/app-lock")["deriveServerAppLockVerifier"];
let verifyServerAppLockVerifier: typeof import("@/server/app-lock")["verifyServerAppLockVerifier"];

beforeAll(async () => {
  ({ deriveServerAppLockVerifier, verifyServerAppLockVerifier } = await import("@/server/app-lock"));
});

describe("verificador scrypt do App Lock", () => {
  it("confere o PIN correto e recusa o incorreto", async () => {
    const material = await deriveServerAppLockVerifier("123456");
    const persisted = {
      kdf_version: material.kdfVersion,
      scrypt_n: material.cost,
      scrypt_r: material.blockSize,
      scrypt_p: material.parallelization,
      pin_salt: material.salt,
      pin_verifier: material.verifier,
    };
    await expect(verifyServerAppLockVerifier("123456", persisted)).resolves.toBe(true);
    await expect(verifyServerAppLockVerifier("654381", persisted)).resolves.toBe(false);
  });

  it("produz salts e verificadores diferentes sem persistir o PIN", async () => {
    const first = await deriveServerAppLockVerifier("123456");
    const second = await deriveServerAppLockVerifier("123456");
    expect(first.salt).not.toBe(second.salt);
    expect(first.verifier).not.toBe(second.verifier);
    expect(JSON.stringify(first)).not.toContain("123456");
  });
});
