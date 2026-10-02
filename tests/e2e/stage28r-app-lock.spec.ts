import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

let admin: SupabaseClient<Database>;
let context: BrowserContext;
let page: Page;
let userId = "";
let email = "";
let password = "";
const pin = "271828";
const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);

async function waitOfflineReady(target: Page) {
  await target.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return Boolean(registration?.active && navigator.serviceWorker.controller);
    },
    null,
    { timeout: 60_000 },
  );
  await expect.poll(
    () => target.evaluate(async () => {
      const databases = await indexedDB.databases();
      return databases.some((database) => database.name === "elyra-offline");
    }),
    { timeout: 30_000 },
  ).toBe(true);
}

async function activate(target: Page) {
  await target.getByRole("button", { name: "Ativar App Lock" }).click();
  const dialog = target.getByRole("dialog", { name: "Criar PIN da Elyra" });
  await dialog.getByLabel("Novo PIN").fill(pin);
  await dialog.getByLabel("Confirmar PIN").fill(pin);
  await dialog.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(target.getByRole("status")).toContainText("App Lock ativado");
}

async function unlock(target: Page, value = pin) {
  await target.getByLabel("PIN da Elyra").fill(value);
  await target.getByRole("button", { name: "Desbloquear", exact: true }).click();
}

test.beforeAll(async ({ browser, baseURL }, testInfo) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) throw new Error("QA local do App Lock não configurado.");
  admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  email = `stage28r-lock-${testInfo.project.name}-${run}@elyra.invalid`;
  password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  context = await browser.newContext({
    ...testInfo.project.use,
    baseURL,
    storageState: { cookies: [], origins: [] },
    serviceWorkers: "allow",
  });
  page = await context.newPage();
  userId = await createConfirmedQaUser(admin, {
    email,
    password,
    displayName: "Pessoa App Lock",
  });
  await loginThroughUi(page, baseURL, { email, password });
});

test.afterAll(async () => {
  await context?.setOffline(false).catch(() => undefined);
  await context?.close();
  if (userId) {
    await admin.from("audit_logs").delete().eq("actor_user_id", userId);
    assertNotQaCanonicalAccount(email);
    await admin.auth.admin.deleteUser(userId);
  }
});

test("ativa, bloqueia todas as entradas, limita tentativas, recupera, funciona offline e remove", async ({ baseURL }) => {
  test.skip(!baseURL, "baseURL ausente");

  await gotoHydrated(page, "/seguranca");
  await waitOfflineReady(page);
  await page.getByRole("button", { name: "Ativar App Lock" }).click();
  await page.getByRole("dialog", { name: "Criar PIN da Elyra" })
    .getByRole("button", { name: "Cancelar" })
    .click();
  const cancelled = await admin.from("app_lock_sessions").select("user_id").eq("user_id", userId);
  expect(cancelled.data).toHaveLength(0);
  await activate(page);

  await page.getByLabel("Bloquear após inatividade").selectOption("1m");
  await expect(page.getByRole("status")).toContainText("Tempo de inatividade atualizado");
  await expect.poll(async () => {
    const current = await admin.from("app_lock_sessions")
      .select("idle_policy")
      .eq("user_id", userId)
      .single();
    return current.data?.idle_policy;
  }).toBe("1m");
  await page.reload();
  await expect(page.getByLabel("Bloquear após inatividade")).toHaveValue("1m");

  const stored = await admin.from("app_lock_sessions").select("*").eq("user_id", userId).single();
  expect(stored.error).toBeNull();
  expect(stored.data?.state).toBe("UNLOCKED");
  expect(stored.data?.idle_policy).toBe("1m");
  expect(stored.data?.session_id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(stored.data?.pin_verifier).not.toContain(pin);
  expect(stored.data?.pin_salt).not.toContain(pin);
  expect(await page.evaluate((secret) => JSON.stringify(localStorage).includes(secret), pin)).toBe(false);
  expect(await page.evaluate(async (secret) => {
    return new Promise<boolean>((resolve) => {
      const request = indexedDB.open("elyra-offline");
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("appLocks", "readonly").objectStore("appLocks").getAll();
        read.onsuccess = () => {
          resolve(JSON.stringify(read.result).includes(secret));
          db.close();
        };
        read.onerror = () => resolve(true);
      };
      request.onerror = () => resolve(true);
    });
  }, pin)).toBe(false);

  const secondTab = await context.newPage();
  await gotoHydrated(secondTab, "/dashboard");
  await page.getByRole("button", { name: "Bloquear agora" }).click();
  await expect(page.getByRole("heading", { name: "Elyra bloqueada" })).toBeVisible();
  await expect(secondTab.getByRole("heading", { name: "Elyra bloqueada" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const api = await page.request.get(`${baseURL}/api/notifications`);
  expect(api.status()).toBe(423);
  await expect(api.json()).resolves.toMatchObject({ code: "APP_LOCK_REQUIRED" });

  await page.goto(`${baseURL}/diario`);
  await expect(page).toHaveURL(/\/bloqueio\?next=%2Fdiario/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Elyra bloqueada" })).toBeVisible();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await unlock(page, "000000");
    await expect(page.locator('p[role="alert"]')).toContainText("PIN incorreto");
  }
  await expect(page.getByRole("status")).toContainText(/Tente novamente|Aguarde/);
  await expect(page.getByRole("button", { name: "Desbloquear", exact: true })).toBeDisabled();
  const cooled = await admin.from("app_lock_sessions")
    .select("failed_attempts,cooldown_until,state")
    .eq("user_id", userId)
    .single();
  expect(cooled.data?.failed_attempts).toBe(5);
  expect(cooled.data?.cooldown_until).not.toBeNull();
  expect(cooled.data?.state).toBe("LOCKED");

  await secondTab.close();
  await page.getByRole("button", { name: "Sair e entrar novamente" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await expect.poll(async () => {
    const result = await admin.from("app_lock_sessions").select("user_id").eq("user_id", userId);
    return result.data?.length ?? -1;
  }).toBe(0);

  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await gotoHydrated(page, "/seguranca");
  await activate(page);
  await page.getByRole("button", { name: "Bloquear agora" }).click();
  await unlock(page);
  await expect(page).toHaveURL(/\/dashboard$/);

  await waitOfflineReady(page);
  await gotoHydrated(page, "/seguranca");
  await page.getByRole("button", { name: "Bloquear agora" }).click();
  await expect(page.getByRole("heading", { name: "Elyra bloqueada" })).toBeVisible();
  await context.setOffline(true);
  await page.goto(`${baseURL}/diario`).catch(() => undefined);
  await expect(page).toHaveURL(/\/offline\?de=%2Fdiario/);
  await expect(page.getByRole("button", { name: "Desbloquear offline" })).toBeVisible();
  await page.getByLabel("PIN da Elyra").fill(pin);
  await page.getByRole("button", { name: "Desbloquear offline" }).click();
  await expect(page.getByRole("heading", { name: "Diário", level: 1 })).toBeVisible();

  await context.setOffline(false);
  await page.goto(`${baseURL}/dashboard`);
  await expect(page.getByRole("heading", { name: "Elyra bloqueada" })).toBeVisible();
  await unlock(page);
  await expect(page).toHaveURL(/\/dashboard$/);

  await gotoHydrated(page, "/seguranca");
  await page.getByRole("button", { name: "Remover App Lock" }).click();
  const removal = page.getByRole("dialog", { name: "Remover App Lock" });
  await removal.getByLabel("PIN atual").fill(pin);
  await removal.getByRole("button", { name: "Remover", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("App Lock removido");
  await expect.poll(async () => {
    const result = await admin.from("app_lock_sessions").select("user_id").eq("user_id", userId);
    return result.data?.length ?? -1;
  }).toBe(0);

  await page.reload();
  await expect(page).toHaveURL(/\/seguranca$/);
  await expect(page.getByRole("button", { name: "Ativar App Lock" })).toBeVisible();
});
