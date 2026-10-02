import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import { cutNetwork, restoreNetwork, waitOfflineReady } from "./offline-network";
import { cleanupAccounts, createProfessionalAccount, qaAdmin, signIn } from "./professional-fixtures";

/**
 * OFF-4 — fronteira profissional offline e logout unico.
 *
 * - `/pro/*` sem rede: tela profissional propria (nunca o workspace pessoal),
 *   razao especifica (sessao/agenda), "Tentar novamente", SOS e link para a area
 *   pessoal; nenhum dado de acompanhamento no aparelho;
 * - rede caindo com a tela aberta: pedir acompanhamento e conferir convite ficam
 *   desabilitados ANTES do clique, com o motivo; voltando, reabilitam;
 * - logout a partir da area profissional apaga os dados pessoais deste aparelho
 *   (snapshot, fila, aparelho) e a lista da Rede de Apoio.
 */

test("area profissional sem rede: tela profissional, razao por rota, sem workspace pessoal", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const admin = qaAdmin();
  const created: string[] = [];
  try {
    const pro = await createProfessionalAccount(admin, testInfo.project.name, "Pro Offline QA");
    created.push(pro.userId);
    const context = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: "allow" });
    const page = await context.newPage();
    await signIn(page, baseURL!, pro);
    await gotoHydrated(page, "/dashboard");
    await waitOfflineReady(page);
    await cutNetwork(context);
    try {
      for (const [route, reason] of [
        ["/pro/agenda", /Confirmar, recusar ou abrir horários precisa de conexão/],
        ["/pro/sessoes/00000000-0000-4000-8000-000000000000", /Você precisa de conexão para participar desta sessão/],
        ["/pro/pacientes", /Você precisa de conexão para acessar o ambiente profissional/],
      ] as const) {
        await page.goto(route).catch(() => undefined);
        const screen = page.getByTestId("professional-offline");
        await expect(screen, route).toBeVisible();
        await expect(screen).toHaveAttribute("data-context", "professional");
        await expect(screen.getByText("Área profissional")).toBeVisible();
        await expect(screen.getByTestId("online-only-reason")).toHaveText(reason);
        await expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
        // Nunca o workspace pessoal: nem navegacao pessoal nem dado local.
        await expect(page.getByRole("navigation", { name: "Navegação principal" })).toHaveCount(0);
        await expect(page.getByTestId("offline-freshness")).toHaveCount(0);
        await expect(page.getByRole("button", { name: /SOS/ })).toBeVisible();
      }
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
      expect(axe.violations.map((v) => v.id)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      // A area pessoal continua funcionando sem rede.
      await page.getByRole("link", { name: /Ir para a sua área pessoal/ }).click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("offline-freshness")).toBeVisible();
    } finally {
      await restoreNetwork(context);
      await context.close();
    }
  } finally {
    await cleanupAccounts(admin, created);
  }
});

test("rede caindo com a tela aberta: acoes sensiveis desabilitadas antes do clique; voltando, reabilitam", async ({ page, context }) => {
  const admin = qaAdmin();
  const { data: peer } = await admin.from("professional_public_profiles").select("slug").eq("display_name", "Rafael Demo").maybeSingle();
  test.skip(!peer?.slug, "seed DEMO ausente: rode `npm run demo:professional -- --seed`");

  await gotoHydrated(page, `/profissionais/${peer!.slug}`);
  const card = page.getByTestId("directory-accompaniment");
  // Corte real (setOffline sozinho deixa o probe do monitor escapar pelo worker).
  await cutNetwork(context);
  await expect(card.getByTestId("requires-connection-note")).toHaveText("Sem conexão: esta ação precisa de internet. Nada foi alterado.");
  for (const button of await card.getByRole("button").all()) await expect(button).toBeDisabled();
  await restoreNetwork(context);
  await expect(card.getByTestId("requires-connection-note")).toHaveCount(0, { timeout: 20_000 });

  // Convite: conferir/aceitar so com rede (o recado usa o mesmo componente).
  await gotoHydrated(page, "/convite");
  await cutNetwork(context);
  await expect(page.getByTestId("requires-connection-note")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ver convite" })).toBeDisabled();
  await restoreNetwork(context);
  await expect(page.getByTestId("requires-connection-note")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Ver convite" })).toBeEnabled();
});

test("logout pela area profissional apaga os dados pessoais deste aparelho e a lista da Rede de Apoio", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const admin = qaAdmin();
  const created: string[] = [];
  try {
    const pro = await createProfessionalAccount(admin, testInfo.project.name, "Pro Logout QA");
    created.push(pro.userId);
    const context = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: "allow" });
    const page = await context.newPage();
    await signIn(page, baseURL!, pro);
    await gotoHydrated(page, "/dashboard");
    await waitOfflineReady(page);
    // Uma lista da Rede de Apoio guardada (municipio consultado).
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const request = indexedDB.open("elyra-support-network", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("lists", { keyPath: "key" });
          request.onsuccess = () => {
            const tx = request.result.transaction("lists", "readwrite");
            tx.objectStore("lists").put({ key: "354960|*", cachedAt: Date.now() });
            tx.oncomplete = () => {
              request.result.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );

    await gotoHydrated(page, "/pro/configuracoes/seguranca");
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(page).toHaveURL(/\/entrar/);

    const after = await page.evaluate(async () => {
      const names = (await indexedDB.databases()).map((db) => db.name);
      const counts = await new Promise<{ snapshots: number; device: number; outbox: number }>((resolve) => {
        const request = indexedDB.open("elyra-offline");
        request.onsuccess = () => {
          const db = request.result;
          const count = (store: string) =>
            new Promise<number>((done) => {
              if (!db.objectStoreNames.contains(store)) return done(0);
              const c = db.transaction(store).objectStore(store).count();
              c.onsuccess = () => done(c.result);
              c.onerror = () => done(-1);
            });
          void Promise.all([count("snapshots"), count("device"), count("outbox")]).then(([snapshots, device, outbox]) =>
            resolve({ snapshots, device, outbox }),
          );
        };
        request.onerror = () => resolve({ snapshots: -1, device: -1, outbox: -1 });
      });
      return { supportNetwork: names.includes("elyra-support-network"), ...counts };
    });
    expect(after).toEqual({ supportNetwork: false, snapshots: 0, device: 0, outbox: 0 });
    await context.close();
  } finally {
    await cleanupAccounts(admin, created);
  }
});
