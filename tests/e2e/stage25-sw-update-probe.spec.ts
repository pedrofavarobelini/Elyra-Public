import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";



const probeDir = process.env.ELYRA_SW_UPDATE_PROBE_DIR;
test.skip(!probeDir, "Sonda manual: defina ELYRA_SW_UPDATE_PROBE_DIR.");
test.setTimeout(25 * 60_000);

async function outboxCount(page: import("@playwright/test").Page) {
  return page.evaluate(
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

const workerBuild = (page: import("@playwright/test").Page) =>
  page.evaluate(async () => {
    const text = await (await fetch("/sw.js", { cache: "no-store" })).text();
    return /build (\S+) \*\//.exec(text)?.[1] ?? null;
  });

const cacheNames = (page: import("@playwright/test").Page) => page.evaluate(() => caches.keys());

test("atualizacao real do worker preserva a fila e sincroniza depois sem duplicar", async ({ browser, baseURL }) => {
  process.loadEnvFile?.(".env.local");
  const admin: SupabaseClient<Database> = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  const email = `stage25-swprobe-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  const title = `Update ${run}`;
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, serviceWorkers: "allow" });
  const page = await context.newPage();
  const userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa Update" });

  try {
    await loginThroughUi(page, baseURL ?? "", { email, password });
    await gotoHydrated(page, "/diario");
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.getRegistration())?.active && navigator.serviceWorker.controller), null, { timeout: 60_000 });
    const buildA = await workerBuild(page);
    expect(buildA).toBeTruthy();

    // Escrita que nao consegue chegar ao servidor: fica so na fila deste aparelho.
    await page.route("**/api/journal/entries", (route) => route.abort("failed"));
    await page.getByLabel("Título").fill(title);
    await page.getByLabel("Anotação").fill("Escrito antes da atualizacao. Nao pode sumir.");
    await page.getByRole("button", { name: "Salvar anotação" }).click();
    await expect.poll(() => outboxCount(page)).toBe(1);

    writeFileSync(join(probeDir!, "ready-for-b"), String(buildA));
    await expect.poll(() => existsSync(join(probeDir!, "b-up")), { timeout: 20 * 60_000, intervals: [2_000] }).toBe(true);

    await expect.poll(() => workerBuild(page).catch(() => null), { timeout: 60_000 }).not.toBe(buildA);
    const buildB = await workerBuild(page);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.update());

    const prompt = page.locator("[data-elyra-update]");
    await expect(prompt).toBeVisible({ timeout: 60_000 });
    await expect(prompt).toContainText("Suas alterações ficam guardadas");
    expect(await outboxCount(page)).toBe(1);

    await Promise.all([
      page.waitForEvent("load", { timeout: 60_000 }),
      prompt.getByRole("button", { name: "Atualizar" }).click(),
    ]);
    await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });

    const names = await cacheNames(page);
    expect(names.some((name) => name.endsWith(String(buildB)))).toBe(true);
    expect(names.some((name) => name.endsWith(String(buildA)))).toBe(false);
    expect(await outboxCount(page)).toBe(1);
    await expect(page.getByRole("listitem").filter({ hasText: title }).getByText("Aguardando sincronizar")).toBeVisible();
    const beforeSync = await admin.from("journal_entries").select("id").eq("user_id", userId).eq("title", title);
    expect(beforeSync.data).toHaveLength(0);

    await page.unroute("**/api/journal/entries");
    await gotoHydrated(page, "/diario");
    await expect.poll(() => outboxCount(page), { timeout: 60_000 }).toBe(0);
    const saved = await admin.from("journal_entries").select("id, content").eq("user_id", userId).eq("title", title);
    expect(saved.data).toHaveLength(1);
    expect(saved.data?.[0]?.content).toBe("Escrito antes da atualizacao. Nao pode sumir.");
    test.info().annotations.push({ type: "builds", description: `${buildA} -> ${buildB}` });
  } finally {
    await context.close();
    await admin.from("audit_logs").delete().eq("actor_user_id", userId);
    assertNotQaCanonicalAccount(email);
    await admin.auth.admin.deleteUser(userId);
  }
});
