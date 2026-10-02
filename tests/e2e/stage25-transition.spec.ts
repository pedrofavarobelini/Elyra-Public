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
const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);

async function outboxCount(target: Page = page): Promise<number> {
  return target.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open("elyra-offline");
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("outbox")) return resolve(-1);
          const count = db.transaction("outbox", "readonly").objectStore("outbox").count();
          count.onsuccess = () => {
            resolve(count.result);
            db.close();
          };
        };
        request.onerror = () => resolve(-1);
      }),
  );
}

/** Quantos documentos esta aba carregou (o contador morre em cada carregamento). */
const documentLoads = (target: Page = page) =>
  target.evaluate(() => Number(sessionStorage.getItem("elyra-doc-loads") ?? "0"));

async function offlineReady(target: Page) {
  /*
   * O registrador do produto agenda o SW para depois do evento `load`, enquanto
   * `gotoHydrated` deliberadamente devolve no primeiro sinal de hidratacao. A
   * suite de transicao precisa preparar esse estado antes de medir a troca de
   * rede; registrar novamente e idempotente e, ao contrario do `catch`
   * silencioso da UI, deixa um erro real de instalacao aparecer no teste.
   */
  await target.waitForLoadState("load");
  await target.evaluate(() => navigator.serviceWorker.register("/sw.js", { scope: "/" }));
  await expect
    .poll(
      () =>
        target.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state ?? null;
        }),
      { timeout: 60_000 },
    )
    .toBe("activated");
  if (!(await target.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await target.reload({ waitUntil: "load" });
    await expect(target.locator("html[data-hydrated='true']")).toBeAttached();
  }
  await expect
    .poll(() => target.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await expect.poll(
    () =>
      target.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const request = indexedDB.open("elyra-offline");
            request.onsuccess = () => {
              const db = request.result;
              if (!db.objectStoreNames.contains("snapshots")) return resolve(0);
              const count = db.transaction("snapshots", "readonly").objectStore("snapshots").count();
              count.onsuccess = () => {
                resolve(count.result);
                db.close();
              };
            };
            request.onerror = () => resolve(0);
          }),
      ),
    { timeout: 30_000 },
  ).toBeGreaterThan(0);
}

test.beforeAll(async ({ browser, baseURL }, testInfo) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) throw new Error("QA local da Stage 25 nao configurado.");
  admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  email = `stage25-transition-${testInfo.project.name}-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  context = await browser.newContext({
    ...testInfo.project.use,
    baseURL,
    storageState: { cookies: [], origins: [] },
    serviceWorkers: "allow",
  });
  await context.addInitScript(() => {
    const key = "elyra-doc-loads";
    sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? "0") + 1));
  });
  page = await context.newPage();
  userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa Transicao" });
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

test("perder a rede durante o uso troca de estado sozinho, sem recarregar e sem perder o texto", async () => {
  const title = `Transicao ${run}`;
  await gotoHydrated(page, "/diario");
  await offlineReady(page);
  const loadsBefore = await documentLoads();

  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Anotação").fill("Escrito com rede, continuado sem ela.");
  await context.setOffline(true);

  // Sem F5, sem fechar o app: a propria tela passa a dizer que esta sem conexao.
  await expect(page.getByTestId("offline-banner")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-elyra-sync-status]")).toContainText("Sem conexão");
  await expect(page).toHaveURL(/\/diario$/);
  expect(await documentLoads()).toBe(loadsBefore);
  // O que estava sendo escrito continua ali.
  await expect(page.getByLabel("Título")).toHaveValue(title);

  await page.getByLabel("Anotação").fill("Escrito com rede, continuado sem ela. E salvo offline.");
  await page.getByRole("button", { name: "Salvar anotação" }).click();
  const card = page.getByRole("listitem").filter({ hasText: title });
  await expect(card.getByText("Aguardando sincronizar")).toBeVisible();
  expect(await outboxCount()).toBeGreaterThan(0);
});

test("a logo abre o Dashboard local quando esta sem conexao", async () => {
  await page.getByRole("link", { name: "Ir para o Dashboard" }).first().click();
  await expect(page).toHaveURL(/\/offline\?de=%2Fdashboard/);
  await expect(page.getByRole("heading", { name: /^Olá,/, level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("offline-freshness")).toContainText("Sem conexão");
});

test("no shell, trocar de tela nao recarrega a pagina", async () => {
  await expect(page.getByTestId("offline-freshness")).toBeVisible();
  const loads = await documentLoads();
  await page.evaluate(() => {
    (window as unknown as { elyraMark?: number }).elyraMark = 42;
  });

  const drawer = page.getByRole("button", { name: "Abrir menu de navegação" });
  if (await drawer.isVisible().catch(() => false)) await drawer.click();
  await page.getByRole("link", { name: "Metas", exact: true }).first().click();

  await expect(page.getByRole("heading", { name: "Metas", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/offline\?de=%2Fmetas/);
  expect(await documentLoads()).toBe(loads);
  expect(await page.evaluate(() => (window as unknown as { elyraMark?: number }).elyraMark)).toBe(42);

  // Voltar tambem e navegacao normal do aparelho.
  await page.goBack();
  await expect(page.getByRole("heading", { name: /^Olá,/, level: 1 })).toBeVisible();
});

test("a rede de volta sincroniza sozinha, sem tirar a pessoa da tela", async () => {
  const title = `Transicao ${run}`;
  await context.setOffline(false);

  await expect(page.getByTestId("offline-freshness")).toContainText("Conexão de volta", { timeout: 60_000 });
  await expect(page.getByRole("heading", { name: /^Olá,/, level: 1 })).toBeVisible();
  await expect.poll(() => outboxCount(), { timeout: 60_000 }).toBe(0);
  await expect(page.getByTestId("offline-freshness")).toContainText("Tudo sincronizado");

  const entries = await admin.from("journal_entries").select("id").eq("user_id", userId).eq("title", title);
  expect(entries.data).toHaveLength(1);
});

test("rede instavel nao duplica, nao recarrega em laco e assenta no fim", async () => {
  const title = `Instavel ${run}`;
  await gotoHydrated(page, "/diario");
  await offlineReady(page);
  const loads = await documentLoads();

  await context.setOffline(true);
  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Anotação").fill("Salvo no meio da oscilação.");
  await page.getByRole("button", { name: "Salvar anotação" }).click();
  await expect.poll(() => outboxCount()).toBeGreaterThan(0);

  // Oscila rapido: nenhuma dessas quedas curtas deve virar recarregamento.
  for (const offline of [false, true, false, true, false]) {
    await context.setOffline(offline);
    await page.waitForTimeout(700);
  }

  await expect.poll(() => outboxCount(), { timeout: 90_000 }).toBe(0);
  expect(await documentLoads()).toBe(loads);
  const entries = await admin.from("journal_entries").select("id").eq("user_id", userId).eq("title", title);
  expect(entries.data).toHaveLength(1);
  const all = await admin.from("journal_entries").select("id").eq("user_id", userId);
  expect(all.data).toHaveLength(2);
});

test("online: a logo leva ao Dashboard, tambem pelo teclado", async () => {
  await gotoHydrated(page, "/metas");
  const logo = page.getByRole("link", { name: "Ir para o Dashboard" }).first();
  await expect(logo).toBeVisible();

  await logo.click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: /^Olá,/, level: 1 })).toBeVisible();

  await gotoHydrated(page, "/metas");
  const loads = await documentLoads();
  const keyboardLogo = page.getByRole("link", { name: "Ir para o Dashboard" }).first();
  await keyboardLogo.focus();
  await expect(keyboardLogo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dashboard$/);
  // Navegacao do Next, sem recarregar o documento.
  expect(await documentLoads()).toBe(loads);
});
