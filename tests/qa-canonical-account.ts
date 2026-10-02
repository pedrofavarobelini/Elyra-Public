import { createHash } from "node:crypto";
export const QA_CANONICAL_ACCOUNT_EMAIL = "qa.elyra.fixture@example.test";
export const QA_PROTECTED_FIXTURE_EMAIL = "protected.fixture@example.test";
export const QA_PROTECTED_FIXTURE_EMAIL_SHA256 = createHash("sha256").update(QA_PROTECTED_FIXTURE_EMAIL).digest("hex");
export const QA_CANONICAL_PASSWORD_ENV = "ELYRA_QA_CANONICAL_PASSWORD";
const normalize = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();
export function qaCanonicalPassword(environment: Readonly<Record<string, string | undefined>> = process.env): string {
  const password = environment[QA_CANONICAL_PASSWORD_ENV];
  if (!password) throw new Error(`${QA_CANONICAL_PASSWORD_ENV} absent; configure it only in ignored .env.local`);
  return password;
}
export function isQaCanonicalAccount(value: string | null | undefined): boolean { return normalize(value) === QA_CANONICAL_ACCOUNT_EMAIL; }
export function isQaProtectedFixtureAccount(value: string | null | undefined): boolean {
  return createHash("sha256").update(normalize(value)).digest("hex") === QA_PROTECTED_FIXTURE_EMAIL_SHA256;
}
export function isQaProtectedAccount(value: string | null | undefined): boolean { return isQaCanonicalAccount(value) || isQaProtectedFixtureAccount(value); }
export function assertNotQaCanonicalAccount(value: string | null | undefined): void {
  if (isQaCanonicalAccount(value)) throw new Error("Cleanup recusado: conta QA canonica sintetica protegida");
  if (isQaProtectedFixtureAccount(value)) throw new Error("Cleanup recusado: fixture sintetica protegida");
}
