import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { assertNotQaCanonicalAccount, isQaCanonicalAccount, isQaProtectedFixtureAccount, isQaProtectedAccount, qaCanonicalPassword, QA_CANONICAL_ACCOUNT_EMAIL, QA_PROTECTED_FIXTURE_EMAIL, QA_PROTECTED_FIXTURE_EMAIL_SHA256, QA_CANONICAL_PASSWORD_ENV } from "./qa-canonical-account";
describe("synthetic public QA identities", () => {
  it("recognizes normalized canonical identity", () => expect(isQaCanonicalAccount(` ${QA_CANONICAL_ACCOUNT_EMAIL.toUpperCase()} `)).toBe(true));
  it("derives the digest from a disclosed synthetic fixture", () => expect(QA_PROTECTED_FIXTURE_EMAIL_SHA256).toBe(createHash("sha256").update(QA_PROTECTED_FIXTURE_EMAIL).digest("hex")));
  it("recognizes the protected fixture", () => expect(isQaProtectedFixtureAccount(QA_PROTECTED_FIXTURE_EMAIL)).toBe(true));
  it.each([QA_CANONICAL_ACCOUNT_EMAIL, QA_PROTECTED_FIXTURE_EMAIL])("guards cleanup of %s", (email) => { expect(isQaProtectedAccount(email)).toBe(true); expect(() => assertNotQaCanonicalAccount(email)).toThrow(/Cleanup recusado/); });
  it.each(["temporary@example.test", "", null, undefined])("allows only unrelated synthetic identity %s", (email) => { expect(isQaProtectedAccount(email)).toBe(false); expect(() => assertNotQaCanonicalAccount(email)).not.toThrow(); });
  it("fails clearly on missing local password", () => expect(() => qaCanonicalPassword({})).toThrow(/\.env\.local/));
  it("reads only explicitly supplied local password", () => expect(qaCanonicalPassword({ [QA_CANONICAL_PASSWORD_ENV]: "synthetic-test-value" })).toBe("synthetic-test-value"));
});
