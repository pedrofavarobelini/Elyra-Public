import { createHmac } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";



test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Codigo TOTP de 6 digitos para o instante dado. */
function totp(secret: string, at: number = Date.now()): string {
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

let admin: SupabaseClient<Database>;
let context: BrowserContext;
let page: Page;
let userId = "";
let email = "";
let password = "";
let secret = "";
const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);

test.beforeAll(async ({ browser, baseURL }, testInfo) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) throw new Error("QA local da Stage 27 nao configurado.");
  admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  email = `stage27-mfa-${testInfo.project.name}-${run}@elyra.invalid`;
  password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  context = await browser.newContext({
    ...testInfo.project.use,
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  page = await context.newPage();
  userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa MFA" });
  await loginThroughUi(page, baseURL, { email, password });
});

test.afterAll(async () => {
  await context?.close();
  if (userId) {
    await admin.from("audit_logs").delete().eq("actor_user_id", userId);
    assertNotQaCanonicalAccount(email);
    await admin.auth.admin.deleteUser(userId);
  }
});

test("a tela de seguranca ativa a verificacao em duas etapas com codigo real", async () => {
  await gotoHydrated(page, "/seguranca");
  const card = page.getByRole("heading", { name: "Verificação em duas etapas" }).locator("xpath=ancestor::*[contains(@class,'rounded-card')][1]");
  await expect(card).toContainText("Não ativa");

  await card.getByRole("button", { name: "Ativar verificação em duas etapas" }).click();
  // O segredo aparece em texto justamente para quem nao pode apontar a camera.
  const segredo = card.locator("p.font-mono");
  await expect(segredo).toBeVisible({ timeout: 30_000 });
  secret = ((await segredo.textContent()) ?? "").trim();
  expect(secret.length).toBeGreaterThan(15);
  await expect(card.getByRole("img", { name: /QR Code/ })).toBeVisible();

  await card.getByLabel("Código gerado pelo aplicativo").fill(totp(secret));
  await card.getByRole("button", { name: "Confirmar e ativar" }).click();

  await expect(card).toContainText("Ativa", { timeout: 30_000 });
  // Estado real no servidor, e nao so na tela.
  await expect
    .poll(async () => {
      const { data } = await admin.auth.admin.getUserById(userId);
      return (data.user?.factors ?? []).filter((factor) => factor.status === "verified").length;
    }, { timeout: 30_000 })
    .toBe(1);
});

test("codigo errado nao ativa nada e nao diz o motivo exato", async () => {
  // Conta separada: esta prova nao pode depender do estado da anterior.
  const outroEmail = `stage27-mfa-erro-${run}@elyra.invalid`;
  const outraSenha = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  const outroId = await createConfirmedQaUser(admin, {
    email: outroEmail,
    password: outraSenha,
    displayName: "Pessoa MFA Erro",
  });
  const ctx = await context.browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  const aba = await ctx.newPage();
  try {
    await loginThroughUi(aba, new URL(page.url()).origin, { email: outroEmail, password: outraSenha });
    await gotoHydrated(aba, "/seguranca");
    const card = aba.getByRole("heading", { name: "Verificação em duas etapas" }).locator("xpath=ancestor::*[contains(@class,'rounded-card')][1]");
    await card.getByRole("button", { name: "Ativar verificação em duas etapas" }).click();
    await expect(card.locator("p.font-mono")).toBeVisible({ timeout: 30_000 });
    await card.getByLabel("Código gerado pelo aplicativo").fill("000000");
    await card.getByRole("button", { name: "Confirmar e ativar" }).click();
    await expect(card.getByRole("alert")).toContainText("Código não confere", { timeout: 30_000 });
    const { data } = await admin.auth.admin.getUserById(outroId);
    expect((data.user?.factors ?? []).filter((f) => f.status === "verified")).toHaveLength(0);
  } finally {
    await ctx.close();
    await admin.from("audit_logs").delete().eq("actor_user_id", outroId);
    assertNotQaCanonicalAccount(outroEmail);
    await admin.auth.admin.deleteUser(outroId);
  }
});

test("com 2FA ativa, a senha sozinha nao abre o app: o portao exige o codigo", async () => {
  const ctx = await context.browser()!.newContext({ storageState: { cookies: [], origins: [] } });
  const aba = await ctx.newPage();
  try {
    await aba.goto("/entrar");
    await aba.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });
    await aba.getByLabel("E-mail").fill(email);
    await aba.getByLabel("Senha", { exact: true }).fill(password);
    await aba.getByRole("button", { name: "Entrar", exact: true }).click();

    // A senha sozinha nao leva ao Dashboard: o destino e a confirmacao do codigo.
    await expect(aba).toHaveURL(/\/entrar\/verificacao/, { timeout: 60_000 });
    await expect(aba.getByRole("heading", { name: "Verificação em duas etapas" })).toBeVisible();

    // E digitar a URL na barra tambem nao burla: o portao vive no servidor.
    await aba.goto("/diario").catch(() => undefined);
    await expect(aba).toHaveURL(/\/entrar\/verificacao/, { timeout: 30_000 });

    await aba.getByLabel("Código do aplicativo").fill("000000");
    await aba.getByRole("button", { name: "Confirmar e entrar" }).click();
    await expect(aba).toHaveURL(/\/entrar\/verificacao/);
    await expect(aba.locator("form [role=alert]")).toContainText("Código não confere");

    await aba.getByLabel("Código do aplicativo").fill(totp(secret));
    await aba.getByRole("button", { name: "Confirmar e entrar" }).click();

    await expect(aba).toHaveURL(/\/dashboard/, { timeout: 60_000 });
    await expect(aba.getByRole("heading", { name: /^Olá,/, level: 1 })).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("desativar exige o codigo atual e volta o estado no servidor", async () => {
  await gotoHydrated(page, "/seguranca");
  const card = page.getByRole("heading", { name: "Verificação em duas etapas" }).locator("xpath=ancestor::*[contains(@class,'rounded-card')][1]");
  await expect(card).toContainText("Ativa");

  await card.getByRole("button", { name: "Desativar" }).click();
  await card.getByLabel("Código atual para confirmar").fill("000000");
  await card.getByRole("button", { name: "Confirmar e desativar" }).click();
  await expect(card.getByRole("alert")).toContainText("Código não confere", { timeout: 30_000 });

  await card.getByLabel("Código atual para confirmar").fill(totp(secret));
  await card.getByRole("button", { name: "Confirmar e desativar" }).click();

  await expect
    .poll(async () => {
      const { data } = await admin.auth.admin.getUserById(userId);
      return (data.user?.factors ?? []).filter((factor) => factor.status === "verified").length;
    }, { timeout: 30_000 })
    .toBe(0);
});
