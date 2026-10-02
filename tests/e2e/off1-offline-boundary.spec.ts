import AxeBuilder from "@axe-core/playwright";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";
import { cutNetwork, restoreNetwork } from "./offline-network";

/**
 * OFF-1 (L-406, L-409): fronteira offline.
 *
 * - `/perfil` sem rede nunca mostra a pagina online: shell com "Esta area
 *   precisa de conexao" (abrir online e cair; recarregar; abrir direto;
 *   fechar e reabrir);
 * - Cache Storage so guarda o shell e estaticos publicos — nenhum HTML de
 *   rota autenticada;
 * - cada rota ONLINE_ONLY explica o porque (matriz canonica) e oferece
 *   "Tentar novamente"; com a rede de volta, a pagina real abre.
 */

test.describe.configure({ mode: "serial" });

let context: BrowserContext;
let page: Page;
let userId = "";
let email = "";
let admin: ReturnType<typeof createClient<Database>>;

const PUBLIC_CACHE = [/^\/offline$/, /^\/_next\/static\//, /^\/_next\/image$/, /^\/brand\//, /^\/icons\//, /^\/product\/[a-z0-9-]+\.(?:avif|webp)$/, /^\/manifest\.webmanifest$/];

async function waitOfflineReady(target: Page) {
  await target.waitForFunction(
    async () => Boolean((await navigator.serviceWorker.getRegistration())?.active && navigator.serviceWorker.controller),
    null,
    { timeout: 60_000 },
  );
  await expect
    .poll(
      () =>
        target.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const request = indexedDB.open("elyra-offline");
              request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains("snapshots")) return resolve(0);
                const count = db.transaction("snapshots").objectStore("snapshots").count();
                count.onsuccess = () => resolve(count.result);
                count.onerror = () => resolve(0);
              };
              request.onerror = () => resolve(0);
            }),
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
}

async function cachedPaths(target: Page) {
  return target.evaluate(async () => {
    const out: string[] = [];
    for (const key of await caches.keys()) {
      for (const request of await (await caches.open(key)).keys()) out.push(new URL(request.url).pathname);
    }
    return out;
  });
}

async function expectOnlineOnly(target: Page, route: string, reason: RegExp) {
  await target.goto(route).catch(() => undefined);
  await expect(target).toHaveURL(new RegExp(`/offline\\?de=${encodeURIComponent(route.split("?")[0]!).replaceAll("%", "%")}`));
  const card = target.getByTestId("online-only");
  await expect(card.getByRole("heading", { name: "Esta área precisa de conexão", level: 1 })).toBeVisible();
  await expect(card.getByTestId("online-only-reason")).toHaveText(reason);
  await expect(card.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
  return card;
}

test.beforeAll(async ({ browser, baseURL }, testInfo) => {
  process.loadEnvFile?.(".env.local");
  admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  email = `stage25-offline-${testInfo.project.name}-off1${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa OFF1" });
  context = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: "allow" });
  page = await context.newPage();
  await loginThroughUi(page, baseURL!, { email, password });
});

test.afterAll(async () => {
  await context?.close();
  if (userId) {
    await admin.from("audit_logs").delete().eq("actor_user_id", userId);
    assertNotQaCanonicalAccount(email);
    await admin.auth.admin.deleteUser(userId);
  }
});

test("perfil sem rede: abrir online e cair, recarregar, abrir direto, fechar e reabrir — nunca a pagina online", async () => {
  test.setTimeout(180_000);
  // A. abrir /perfil online.
  await gotoHydrated(page, "/perfil");
  await expect(page.getByRole("heading", { name: "Perfil", level: 1 })).toBeVisible();
  await gotoHydrated(page, "/dashboard");
  await waitOfflineReady(page);

  // B/C. fica offline e recarrega /perfil.
  await cutNetwork(context);
  await expectOnlineOnly(page, "/perfil", /Perfil, configurações e segurança dependem da sua conta online/);
  await page.reload().catch(() => undefined);
  await expect(page.getByTestId("online-only")).toBeVisible();

  // Nenhum dado do perfil online aparece (e-mail, "Ultimo acesso", botao Sair).
  await expect(page.getByText("Último acesso")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sair" })).toHaveCount(0);

  // "Tentar novamente" sem rede: fica no estado honesto.
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByTestId("online-only")).toBeVisible();

  // Cache Storage: so shell e estaticos publicos.
  const paths = await cachedPaths(page);
  expect(paths.length).toBeGreaterThan(0);
  expect(paths.filter((path) => !PUBLIC_CACHE.some((allowed) => allowed.test(path)))).toEqual([]);

  // D. fechar e reabrir o navegador (aba nova) ainda offline; E. abrir direto.
  await page.close();
  page = await context.newPage();
  await expectOnlineOnly(page, "/perfil", /conta online/);

  // Reconexao: "Tentar novamente" abre a pagina real.
  await restoreNetwork(context);
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByRole("heading", { name: "Perfil", level: 1 })).toBeVisible();
});

test("rotas ONLINE_ONLY explicam o porque; rotas locais abrem; axe sem violacao", async () => {
  test.setTimeout(180_000);
  await gotoHydrated(page, "/dashboard");
  await waitOfflineReady(page);
  await cutNetwork(context);
  try {
    for (const [route, reason] of [
      ["/configuracoes/privacidade", /Compartilhamento e privacidade só mudam com conexão/],
      ["/convite", /Aceitar um convite cria um vínculo/],
      ["/agenda", /participar desta sessão/],
      ["/pedidos", /Nada foi enviado\. Em risco imediato, use o botão SOS\./],
      ["/profissionais", /lista de profissionais precisa estar atualizada/],
      ["/notificacoes", /Nenhuma foi marcada como lida/],
      ["/sessoes", /Para começar ou abrir uma sessão/],
    ] as const) {
      const card = await expectOnlineOnly(page, route, reason);
      if (route === "/agenda") {
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(axe.violations.map((v) => v.id), route).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      }
      await expect(card).toHaveAttribute("data-area", /personal|account/);
    }
    // Rotas locais continuam abrindo (a fronteira nao engoliu o nucleo).
    await page.goto("/metas").catch(() => undefined);
    await expect(page.getByRole("heading", { name: "Metas", level: 1 })).toBeVisible();
    await expect(page.getByTestId("online-only")).toHaveCount(0);
  } finally {
    await restoreNetwork(context);
  }
});
