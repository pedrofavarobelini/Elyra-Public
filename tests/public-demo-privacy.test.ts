import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QA_CANONICAL_ACCOUNT_EMAIL, QA_PROTECTED_FIXTURE_EMAIL, QA_PROTECTED_FIXTURE_EMAIL_SHA256 } from "./qa-canonical-account";
describe("PUBLIC_DEMO_OWNER_DATA = 0", () => {
 it("uses declared synthetic identities and no opaque personal digest", () => {
  for (const email of [QA_CANONICAL_ACCOUNT_EMAIL, QA_PROTECTED_FIXTURE_EMAIL]) expect(email).toMatch(/(?:fixture|protected).*@example\.test$/);
  expect(QA_PROTECTED_FIXTURE_EMAIL_SHA256).toBe(createHash("sha256").update(QA_PROTECTED_FIXTURE_EMAIL).digest("hex"));
 });
 it("has no embedded demo password and refuses non-local targets before creating a client", () => {
  const code=readFileSync("scripts/demo-professional.mjs","utf8");
  expect(code).toContain('process.env.ELYRA_DEMO_PASSWORD ?? ""');
  expect(code).not.toMatch(/export const DEMO_PASSWORD\s*=\s*["'][^"']+["']/);
  expect(code.indexOf("const refusal = demoTargetRefusal")).toBeLessThan(code.indexOf("const admin = createClient"));
  expect(code).toContain('public.professional@demo.invalid');
  expect(code).not.toContain('log(DEMO_PASSWORD);');
 });
});
