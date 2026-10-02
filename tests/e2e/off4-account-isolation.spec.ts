import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import { cutNetwork, outboxSize, restoreNetwork, waitOfflineReady } from "./offline-network";
import { cleanupAccounts, createPersonalAccount, qaAdmin, signIn } from "./professional-fixtures";

/**
 * OFF-4 — troca de conta no mesmo navegador (A → sair → B).
 *
 * A deixa dado local de todo tipo: diario pendente na fila (servidor bloqueado),
 * snapshot do nucleo e uma lista da Rede de Apoio. Ao sair, a limpeza unica
 * apaga tudo; B entra e nao ve nada de A — nem online, nem no shell offline, nem
 * no IndexedDB. Qualquer vazamento aqui e BLOCKER.
 */

test.setTimeout(240_000);

async function localInventory(page: Page) {
  return page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((db) => db.name);
    const dump = await new Promise<string>((resolve) => {
      if (!names.includes("elyra-offline")) return resolve("");
      const request = indexedDB.open("elyra-offline");
      request.onsuccess = () => {
        const db = request.result;
        const stores = [...db.objectStoreNames];
        if (stores.length === 0) return resolve("");
        const tx = db.transaction(stores);
        const out: unknown[] = [];
        let pending = stores.length;
        for (const store of stores) {
          const all = tx.objectStore(store).getAll();
          all.onsuccess = () => {
            out.push(all.result);
            if (--pending === 0) resolve(JSON.stringify(out));
          };
          all.onerror = () => {
            if (--pending === 0) resolve(JSON.stringify(out));
          };
        }
      };
      request.onerror = () => resolve("");
    });
    return { supportNetwork: names.includes("elyra-support-network"), dump };
  });
}

async function seedSupportList(page: Page) {
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
}

test("A sai com dado local pendente; B entra no mesmo navegador e nao ve nada de A", async ({ browser, baseURL }, testInfo) => {
  const admin = qaAdmin();
  const created: string[] = [];
  const marker = `Isolamento ${crypto.randomUUID().slice(0, 8)}`;
  try {
    const a = await createPersonalAccount(admin, testInfo.project.name, "Pessoa A Offline");
    created.push(a.userId);
    const b = await createPersonalAccount(admin, testInfo.project.name, "Pessoa B Offline");
    created.push(b.userId);

    const context = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: "allow" });
    const page = await context.newPage();
    try {
      await signIn(page, baseURL!, a);
      await gotoHydrated(page, "/diario");
      await waitOfflineReady(page);

      // Diario de A so neste aparelho: servidor bloqueado, fica na fila.
      await page.route("**/api/journal/entries", (route) => route.abort("failed"));
      await page.getByLabel("Título").fill(marker);
      await page.getByLabel("Anotação").fill("Texto que nunca pode aparecer para outra conta.");
      await page.getByRole("button", { name: "Salvar anotação" }).click();
      await expect.poll(() => outboxSize(page)).toBe(1);
      await seedSupportList(page);
      const before = await localInventory(page);
      expect(before.dump).toContain(marker);
      expect(before.supportNetwork).toBe(true);

      // Sair: ha alteracao so aqui, entao a Elyra pede escolha antes de apagar.
      await gotoHydrated(page, "/perfil");
      await page.getByRole("button", { name: "Sair" }).click();
      const confirm = page.getByRole("dialog").getByRole("button", { name: "Sair e apagar deste aparelho" });
      await confirm.click({ noWaitAfter: true });
      await page.waitForURL(/\/entrar/, { timeout: 30_000 });
      await page.unroute("**/api/journal/entries");

      const afterLogout = await localInventory(page);
      expect(afterLogout.supportNetwork).toBe(false);
      expect(afterLogout.dump).not.toContain(marker);
      expect(afterLogout.dump).not.toContain(a.userId);

      // B entra no mesmo navegador.
      await signIn(page, baseURL!, b);
      await gotoHydrated(page, "/diario");
      await waitOfflineReady(page);
      await expect(page.getByText(marker)).toHaveCount(0);

      // Nem no shell offline.
      await cutNetwork(context);
      await page.goto("/diario").catch(() => undefined);
      await expect(page).toHaveURL(/\/offline\?de=%2Fdiario/);
      await expect(page.getByRole("heading", { name: "Diário", level: 1 })).toBeVisible();
      await expect(page.getByText(marker)).toHaveCount(0);
      await restoreNetwork(context);

      const bInventory = await localInventory(page);
      expect(bInventory.dump).not.toContain(marker);
      expect(bInventory.dump).not.toContain(a.userId);
      expect(bInventory.dump).toContain(b.userId);

      // E nada de A chegou ao servidor (a fila foi apagada, nao enviada por B).
      const leaked = await admin.from("journal_entries").select("id").eq("title", marker);
      expect(leaked.data).toHaveLength(0);
    } finally {
      await context.close();
    }
  } finally {
    await cleanupAccounts(admin, created);
  }
});
