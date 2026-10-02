import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

import type { Database } from "@/lib/supabase/database.types";
import { cleanupQaUser } from "../qa-cleanup";
import { createConfirmedQaUser } from "../qa-identity";



export type Admin = SupabaseClient<Database>;

export function qaAdmin(): Admin {
  process.loadEnvFile?.(".env.local");
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface QaAccount {
  userId: string;
  email: string;
  password: string;
  displayName: string;
}

function run() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 14);
}

export async function createPersonalAccount(
  admin: Admin,
  project: string,
  displayName: string,
  { patient = false } = {},
): Promise<QaAccount> {
  const email = `playwright-${patient ? "patient-" : ""}${project}-${run()}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}3`;
  const userId = await createConfirmedQaUser(admin, { email, password, displayName });
  return { userId, email, password, displayName };
}

export type FixtureVerification =
  | "verified"
  | "pending"
  | "under_review"
  | "rejected"
  | "suspended"
  | "expired"
  | "needs_correction";

/** Perfil profissional com o status pedido. `expired` = verificado com revisao vencida. */
export async function createProfessionalAccount(
  admin: Admin,
  project: string,
  displayName: string,
  verification: FixtureVerification = "verified",
): Promise<QaAccount> {
  const account = await createPersonalAccount(admin, project, displayName);
  const now = Date.now();
  const status = verification === "expired" ? "verified" : verification;
  const reviewed = status === "verified" || status === "rejected" || status === "suspended";
  const { error } = await admin.from("professional_profiles").insert({
    user_id: account.userId,
    council_region: "06",
    registration_number: `QA-${account.userId.slice(0, 8)}`,
    specialty: "Psicologia",
    verification_status: status,
    // Revisao sempre antes do vencimento (`professional_profiles_verified_shape`).
    verification_reviewed_at: reviewed ? new Date(now - 2 * 86_400_000).toISOString() : null,
    verification_review_due_at:
      verification === "expired"
        ? new Date(now - 86_400_000).toISOString()
        : status === "verified"
          ? new Date(now + 365 * 86_400_000).toISOString()
          : null,
  });
  if (error) throw error;
  return account;
}

export async function cleanupAccounts(admin: Admin, userIds: string[]) {
  const created = userIds.filter(Boolean);
  if (created.length === 0) return;
  await admin.from("app_lock_sessions").delete().in("user_id", created);
  await admin.from("professional_connections").delete().in("professional_user_id", created);
  await admin.from("professional_connections").delete().in("client_user_id", created);
  for (const userId of created) await cleanupQaUser(admin as never, userId);
}

/** Login pela tela real, sem supor destino (a regra de destino e o que se testa). */
export async function signIn(page: Page, baseURL: string, account: QaAccount, query = "") {
  await page.goto(`${baseURL}/entrar${query}`);
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });
  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Senha", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/entrar") || url.pathname.startsWith("/entrar/verificacao"), {
    timeout: 30_000,
  });
}

export async function signOut(page: Page, baseURL: string) {
  await page.goto(`${baseURL}/seguranca`);
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await expect(page).toHaveURL(/\/entrar$/);
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function totp(secret: string, at: number = Date.now()): string {
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index >= 0) bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Math.floor(at / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter % 2 ** 32, 4);
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}
