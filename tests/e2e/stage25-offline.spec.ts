import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";
import { axeBothSchemes } from "./offline-a11y";
import { cutNetwork, restoreNetwork } from "./offline-network";



test.describe.configure({ mode: "serial" });
// Service worker, reload sem rede e drenagem com backoff custam mais que 60 s.
test.setTimeout(180_000);

let admin: SupabaseClient<Database>;
let context: BrowserContext;
let page: Page;
let userId = "";
let email = "";
const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);

async function openDb<T>(target: Page, store: string, action: "count" | "getAll"): Promise<T> {
  return target.evaluate(
    async ({ store, action }) => {
      const dbs = await indexedDB.databases();
      if (!dbs.some((db) => db.name === "elyra-offline")) return (action === "count" ? -1 : []) as never;
      return new Promise((resolve) => {
        const request = indexedDB.open("elyra-offline");
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(store)) {
            db.close();
            resolve((action === "count" ? -1 : []) as never);
            return;
          }
          const read = db.transaction(store, "readonly").objectStore(store)[action]();
          read.onsuccess = () => {
            resolve(read.result as never);
            db.close();
          };
        };
        request.onerror = () => resolve((action === "count" ? -1 : []) as never);
      });
    },
    { store, action },
  ) as Promise<T>;
}

const outboxCount = (target: Page = page) => openDb<number>(target, "outbox", "count");

async function waitOfflineReady(target: Page) {
  await target.waitForFunction(
    async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return Boolean(registration?.active && navigator.serviceWorker.controller);
    },
    null,
    { timeout: 60_000 },
  );
  await expect.poll(() => openDb<number>(target, "device", "count"), { timeout: 30_000 }).toBe(1);
  await expect.poll(() => openDb<number>(target, "snapshots", "count"), { timeout: 30_000 }).toBeGreaterThan(0);
}

async function goOffline() {
  await cutNetwork(context);
}

async function goOnline() {
  await restoreNetwork(context);
}

test.beforeAll(async ({ browser, baseURL }, testInfo) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) throw new Error("QA local da Stage 25 nao configurado.");
  admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  email = `stage25-offline-${testInfo.project.name}-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  context = await browser.newContext({
    ...testInfo.project.use,
    baseURL,
    storageState: { cookies: [], origins: [] },
    serviceWorkers: "allow",
  });
  page = await context.newPage();
  userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa Offline" });
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

test("diario e humor sem rede: grava, abre sem internet, reconecta e sincroniza sem duplicar", async () => {
  const title = `Offline ${run}`;
  const note = `Nota offline ${run}`;

  await gotoHydrated(page, "/diario");
  await waitOfflineReady(page);

  await goOffline();
  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Anotação").fill("Escrito sem internet. Nada pode sumir.");
  await page.getByRole("button", { name: "Salvar anotação" }).click();
  const card = page.getByRole("listitem").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText("Aguardando sincronizar")).toBeVisible();
  await expect(page.locator("[data-elyra-sync-status]")).toContainText("Sem conexão");

  // Recarregar sem rede: o worker entrega o shell, que abre o diario local.
  await page.reload();
  await expect(page).toHaveURL(/\/offline\?de=%2Fdiario/);
  await expect(page.getByRole("heading", { name: "Diário", level: 1 })).toBeVisible();
  await expect(page.getByTestId("offline-freshness")).toContainText("Sem conexão");
  await expect(page.getByRole("listitem").filter({ hasText: title })).toBeVisible();

  // Humor no shell (navegacao sem rede volta ao shell com outra rota).
  await page.goto("/meu-humor").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "Meu Humor", level: 1 })).toBeVisible();
  await page.getByRole("radio", { name: "Tranquilo" }).check();
  await page.getByLabel("Observação").fill(note);
  await page.getByRole("button", { name: "Salvar check-in" }).click();
  await expect(page.getByText("Guardado neste aparelho")).toBeVisible();
  expect(await outboxCount()).toBe(2);

  // Nada chegou ao servidor enquanto offline.
  const before = await admin.from("journal_entries").select("id").eq("user_id", userId).eq("title", title);
  expect(before.data).toHaveLength(0);

  await goOnline();
  await expect.poll(() => outboxCount(), { timeout: 45_000 }).toBe(0);

  const entries = await admin.from("journal_entries").select("id, content").eq("user_id", userId).eq("title", title);
  expect(entries.data).toHaveLength(1);
  expect(entries.data?.[0]?.content).toBe("Escrito sem internet. Nada pode sumir.");
  const checkins = await admin.from("emotional_checkins").select("id").eq("user_id", userId).eq("note", note);
  expect(checkins.data).toHaveLength(1);
});

test("ACK perdido: a escrita chega, a resposta nao, e o reenvio nao duplica", async ({ browser, baseURL }, testInfo) => {
  const title = `AckPerdido ${run}`;
  // Contexto proprio, mesma sessao, sem worker: o cenario e fila + servidor, e a
  // interceptacao fica deterministica.
  const isolated = await browser.newContext({
    ...testInfo.project.use,
    baseURL,
    storageState: await context.storageState(),
    serviceWorkers: "block",
  });
  const tab = await isolated.newPage();
  try {
    await gotoHydrated(tab, "/diario");
    await tab.getByLabel("Título").fill(title);
    await tab.getByLabel("Anotação").fill("Resposta perdida no caminho.");
    await expect(tab.getByTestId("autosave-status")).toHaveText(/Rascunho/, { timeout: 30_000 });

    let aborted = 0;
    const trail: string[] = [];
    tab.on("request", (request) => {
      if (request.url().includes("/api/journal/entries")) trail.push(`req:${request.method()}:${(request.postData() ?? "").slice(0, 120)}`);
    });
    tab.on("response", async (response) => {
      if (response.url().includes("/api/journal/entries")) trail.push(`res:${response.status()}`);
    });
    await tab.route("**/api/journal/entries", async (route) => {
      const body = route.request().postData() ?? "";
      if (route.request().method() === "POST" && body.includes('"status":"saved"') && aborted === 0) {
        aborted += 1;
        const applied = await route.fetch(); // o servidor aplica a escrita
        trail.push(`intercepted:${applied.status()}:${(await applied.text()).slice(0, 160)}`);
        await route.abort("failed"); // o navegador nunca ve a resposta
        return;
      }
      await route.continue();
    });

    await tab.getByRole("button", { name: "Salvar anotação" }).click();
    // A escrita interceptada chegou ao servidor e a resposta foi descartada.
    await expect.poll(() => trail.some((item) => item.startsWith("intercepted:")), { timeout: 60_000 }).toBe(true);
    expect(trail.find((item) => item.startsWith("intercepted:"))).toMatch(/^intercepted:201/);

    // O reenvio da fila chega ao mesmo registro: um so, e com o estado final.
    await expect
      .poll(
        async () => {
          const rows = await admin
            .from("journal_entries")
            .select("id, status")
            .eq("user_id", userId)
            .eq("title", title);
          return `${rows.data?.length}:${rows.data?.[0]?.status}`;
        },
        { timeout: 60_000 },
      )
      .toBe("1:saved");
    await expect.poll(() => outboxCount(tab), { timeout: 60_000 }).toBe(0);
    expect(trail.filter((item) => item.startsWith("req:POST") && item.includes("AckPerdido")).length).toBeGreaterThanOrEqual(2);
  } finally {
    await isolated.close();
  }
});

test("metas sem rede: +1, +1 e pausar dao o mesmo estado final no servidor", async () => {
  const goalTitle = `Meta offline ${run}`;
  const goalId = crypto.randomUUID();
  await admin.from("goals").insert({
    id: goalId,
    user_id: userId,
    title: goalTitle,
    kind: "frequency",
    status: "active",
    recurrence: "daily",
    target: 3,
    unit: null,
  });
  await gotoHydrated(page, "/metas");
  await waitOfflineReady(page);

  await goOffline();
  const cardFor = () =>
    page.getByRole("heading", { name: goalTitle }).locator("xpath=ancestor::*[contains(@class,'rounded-card')][1]");
  await cardFor().getByRole("button", { name: "Registrar" }).click();
  await expect.poll(() => outboxCount()).toBe(1);
  await cardFor().getByRole("button", { name: "Registrar" }).click();
  await expect.poll(() => outboxCount()).toBe(2);
  await cardFor().getByRole("button", { name: "Pausar" }).click();
  await expect.poll(() => outboxCount()).toBe(3);
  await expect(cardFor().getByText("Aguardando sincronizar")).toBeVisible();

  await goOnline();
  await expect.poll(() => outboxCount(), { timeout: 45_000 }).toBe(0);

  const progress = await admin.from("goal_progress_entries").select("id").eq("goal_id", goalId);
  expect(progress.data).toHaveLength(2);
  const goal = await admin.from("goals").select("status").eq("id", goalId).single();
  expect(goal.data?.status).toBe("paused");
});

test("sono e meta nova sem rede: guardados no aparelho e gravados uma vez so", async () => {
  const goalTitle = `Meta criada offline ${run}`;
  await gotoHydrated(page, "/meu-humor");
  await waitOfflineReady(page);

  await goOffline();
  await page.locator("#sleep-hours").fill("7");
  await page.locator("#sleep-minutes").fill("15");
  await page.getByRole("button", { name: "Salvar sono" }).click();
  await expect(page.getByText("Guardado neste aparelho")).toBeVisible();
  await expect.poll(() => outboxCount()).toBe(1);

  await page.goto("/metas").catch(() => undefined);
  await expect(page).toHaveURL(/\/offline\?de=%2Fmetas/);
  await page.locator("#g-title").fill(goalTitle);
  await page.getByRole("button", { name: "Criar meta", exact: true }).click();
  await expect(page.getByRole("heading", { name: goalTitle })).toBeVisible();
  await expect.poll(() => outboxCount()).toBe(2);
  const before = await admin.from("goals").select("id").eq("user_id", userId).eq("title", goalTitle);
  expect(before.data).toHaveLength(0);

  await goOnline();
  await expect.poll(() => outboxCount(), { timeout: 45_000 }).toBe(0);
  const goals = await admin.from("goals").select("id").eq("user_id", userId).eq("title", goalTitle);
  expect(goals.data).toHaveLength(1);
  const sleep = await admin.from("sleep_records").select("duration_minutes").eq("user_id", userId).eq("duration_minutes", 435);
  expect(sleep.data).toHaveLength(1);
});

test("503 e sessao expirada: fila preservada, retry com backoff e sem laco de requests", async () => {
  const title = `Falhas ${run}`;
  await gotoHydrated(page, "/diario");
  await waitOfflineReady(page);
  await goOffline();
  await page.getByLabel("Título").fill(title);
  await page.getByLabel("Anotação").fill("Servidor instavel.");
  await page.getByRole("button", { name: "Salvar anotação" }).click();
  await expect.poll(() => outboxCount()).toBe(1);

  let attempts = 0;
  await page.route("**/api/journal/entries", async (route) => {
    attempts += 1;
    await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"indisponivel"}' });
  });
  await goOnline();
  await page.waitForTimeout(5_000);
  // Backoff 1s, 2s, 4s: em 5s, no maximo 3-4 tentativas — nunca um laco.
  expect(attempts).toBeGreaterThanOrEqual(1);
  expect(attempts).toBeLessThanOrEqual(4);
  expect(await outboxCount()).toBe(1);
  await axeBothSchemes(page, "retry com backoff (503)");

  await page.unroute("**/api/journal/entries");
  await page.route("**/api/journal/entries", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"sessao"}' }),
  );
  await page.getByRole("button", { name: /Sincroniz|pendente|alteraç/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Sincronizar agora" }).click().catch(() => undefined);
  await expect(page.locator("[data-elyra-sync-status]")).toContainText("Entre de novo para sincronizar", { timeout: 30_000 });
  expect(await outboxCount()).toBe(1);
  await page.keyboard.press("Escape");
  // O dialogo sai com fade: medir contraste no meio da animacao da falso positivo.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await axeBothSchemes(page, "erro de sessao na sincronizacao (401)");

  await page.unroute("**/api/journal/entries");
  await page.getByRole("button", { name: "Entre de novo para sincronizar" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sincronizar agora" }).click();
  await expect.poll(() => outboxCount(), { timeout: 30_000 }).toBe(0);
  await page.keyboard.press("Escape");
  const rows = await admin.from("journal_entries").select("id").eq("user_id", userId).eq("title", title);
  expect(rows.data).toHaveLength(1);
});

test("conflito real: edicao offline x edicao em outro aparelho, e manter as duas preserva ambas", async () => {
  const title = `Conflito ${run}`;
  const entryId = crypto.randomUUID();
  await admin.from("journal_entries").insert({
    id: entryId,
    user_id: userId,
    title,
    content: "Versao original",
    status: "saved",
  });
  await gotoHydrated(page, "/diario");
  await waitOfflineReady(page);

  await goOffline();
  const card = page.getByRole("listitem").filter({ hasText: title });
  await card.getByRole("button", { name: /Editar/ }).click();
  await page.getByLabel("Anotação").fill("Minha versao offline");
  await page.getByRole("button", { name: "Salvar anotação" }).click();
  await expect.poll(() => outboxCount()).toBe(1);

  // "Outro aparelho" muda a mesma anotacao enquanto este esta offline.
  await admin.from("journal_entries").update({ content: "Versao de outro aparelho" }).eq("id", entryId);

  await goOnline();
  await expect(page.locator("[data-elyra-sync-status]")).toContainText("Conflito para revisar", { timeout: 45_000 });
  await page.locator("[data-elyra-sync-status]").click();
  const dialog = page.getByRole("dialog", { name: "Sincronização" });
  await expect(dialog).toContainText("mudou em outro aparelho");
  await dialog.getByRole("button", { name: "Manter as duas versões" }).click();
  // A copia nasce na fila e sincroniza: espera o efeito no banco, nao a fila.
  await expect
    .poll(
      async () =>
        (
          await admin
            .from("journal_entries")
            .select("id")
            .eq("user_id", userId)
            .eq("title", `${title} (cópia deste aparelho)`)
        ).data?.length ?? 0,
      { timeout: 60_000 },
    )
    .toBe(1);
  await expect.poll(() => outboxCount(), { timeout: 45_000 }).toBe(0);
  await page.keyboard.press("Escape");

  const original = await admin.from("journal_entries").select("content").eq("id", entryId).single();
  expect(original.data?.content).toBe("Versao de outro aparelho");
  const copy = await admin
    .from("journal_entries")
    .select("content, title")
    .eq("user_id", userId)
    .eq("title", `${title} (cópia deste aparelho)`);
  expect(copy.data).toHaveLength(1);
  expect(copy.data?.[0]?.content).toBe("Minha versao offline");
});

test("ciclo sem rede: registro observado sincroniza pela data e nunca vira estimativa", async () => {
  const note = `Ciclo offline ${run}`;
  const enabled = await page.request.patch("/api/cycle/profile", { data: { enabled: true } });
  expect(enabled.ok()).toBe(true);
  await gotoHydrated(page, "/ciclo");
  await expect(page.getByRole("heading", { name: "Ciclo", level: 1 })).toBeVisible();
  await waitOfflineReady(page);
  // O snapshot local precisa saber que o ciclo esta ligado antes de cair a rede.
  await expect
    .poll(async () => {
      const snapshots = await openDb<{ data: { cycle?: { enabled?: boolean } } }[]>(page, "snapshots", "getAll");
      return snapshots.some((item) => item.data.cycle?.enabled === true);
    }, { timeout: 30_000 })
    .toBe(true);

  await goOffline();
  await page.getByRole("button", { name: "Registrar dados" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Moderado" }).click();
  await dialog.getByLabel("Observação").fill(note);
  await dialog.getByRole("button", { name: "Salvar registro" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(note)).toBeVisible();
  await expect.poll(() => outboxCount()).toBe(1);

  await goOnline();
  await expect.poll(() => outboxCount(), { timeout: 45_000 }).toBe(0);
  const records = await admin.from("cycle_daily_records").select("record_date, note").eq("user_id", userId);
  expect(records.data?.filter((record) => record.note === note)).toHaveLength(1);
  // So o dia observado foi gravado: nenhuma data futura/estimada entrou no banco.
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  expect(records.data?.every((record) => record.record_date <= todayIso)).toBe(true);

  // Excluir o registro do dia sem rede: some da tela e so sai do banco no sync.
  await goOffline();
  await page.getByRole("button", { name: "Excluir registros" }).click();
  await expect(page.getByText(note)).toHaveCount(0);
  await expect.poll(() => outboxCount()).toBe(1);
  const pending = await admin.from("cycle_daily_records").select("note").eq("user_id", userId).eq("note", note);
  expect(pending.data).toHaveLength(1);
  await goOnline();
  await expect.poll(() => outboxCount(), { timeout: 45_000 }).toBe(0);
  const deleted = await admin.from("cycle_daily_records").select("note").eq("user_id", userId).eq("note", note);
  expect(deleted.data).toHaveLength(0);
  await page.request.patch("/api/cycle/profile", { data: { enabled: false } });
});

test("leitura sem rede: dashboard, relatorios e historico com dados locais; area conectada avisa; axe e sem erro de pagina", async () => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await gotoHydrated(page, "/dashboard");
  await waitOfflineReady(page);

  await goOffline();
  await page.goto("/dashboard").catch(() => undefined);
  await expect(page).toHaveURL(/\/offline\?de=%2Fdashboard/);
  await expect(page.getByTestId("offline-freshness")).toContainText("Dados deste aparelho de");
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

  await page.goto("/relatorios").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "Relatórios e evolução", level: 1 })).toBeVisible();
  await page.goto("/historico").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "Histórico", level: 1 })).toBeVisible();

  await page.goto("/perfil").catch(() => undefined);
  await expect(page.getByRole("heading", { name: "Esta área precisa de conexão", level: 1 })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await goOnline();
  expect(pageErrors).toEqual([]);
});

test("exclusao sem rede: lixeira, restaurar e excluir em definitivo sobrevivem a fechar e reabrir, sem ressuscitar", async () => {
  const gone = `Excluir ${run}`;
  const back = `Restaurar ${run}`;
  const saved = async (title: string) =>
    (await admin.from("journal_entries").select("id, trashed_at").eq("user_id", userId).eq("title", title)).data ?? [];

  await gotoHydrated(page, "/diario");
  await waitOfflineReady(page);
  for (const title of [gone, back]) {
    await page.getByLabel("Título").fill(title);
    await page.getByLabel("Anotação").fill(`Texto de ${title}`);
    await page.getByRole("button", { name: "Salvar anotação" }).click();
    await expect.poll(async () => (await saved(title)).length, { timeout: 20_000 }).toBe(1);
    await expect(page.getByLabel("Título")).toHaveValue("");
  }
  await expect.poll(() => outboxCount()).toBe(0);

  await goOffline();
  await page.getByRole("button", { name: `Mover ${gone} para a lixeira` }).click();
  await page.getByRole("button", { name: `Mover ${back} para a lixeira` }).click();
  await page.getByRole("tab", { name: /Lixeira/ }).click();
  const trash = page.getByRole("tabpanel");
  await trash.getByRole("listitem").filter({ hasText: back }).getByRole("button", { name: "Restaurar anotação" }).click();
  await trash.getByRole("listitem").filter({ hasText: gone }).getByRole("button", { name: "Excluir em definitivo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Excluir em definitivo" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await outboxCount()).toBeGreaterThan(0);

  // Fechar o app sem rede e reabrir: a fila e o tombstone continuam no aparelho.
  await page.close();
  page = await context.newPage();
  await page.goto("/diario").catch(() => undefined);
  await expect(page).toHaveURL(/\/offline\?de=%2Fdiario/);
  await expect(page.getByRole("heading", { name: "Diário", level: 1 })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: back })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: gone })).toHaveCount(0);
  await page.getByRole("tab", { name: /Lixeira/ }).click();
  await expect(page.getByRole("tabpanel").getByRole("listitem").filter({ hasText: gone })).toHaveCount(0);
  expect(await outboxCount()).toBeGreaterThan(0);

  // Nada foi aplicado no servidor enquanto offline.
  expect(await saved(gone)).toHaveLength(1);
  expect((await saved(back))[0]?.trashed_at).toBeNull();

  await goOnline();
  await expect.poll(() => outboxCount(), { timeout: 45_000 }).toBe(0);
  expect(await saved(gone)).toHaveLength(0);
  const restored = await saved(back);
  expect(restored).toHaveLength(1);
  expect(restored[0]?.trashed_at).toBeNull();

  // Online de novo: a excluida nao volta, a restaurada continua.
  await gotoHydrated(page, "/diario");
  await expect(page.getByRole("listitem").filter({ hasText: back })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: gone })).toHaveCount(0);
});

test("Cache Storage nunca guarda dado pessoal: so shell e assets imutaveis", async () => {
  await gotoHydrated(page, "/diario");
  await waitOfflineReady(page);
  const cached = await page.evaluate(async () => {
    const entries: { url: string; body: string | null }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const url = new URL(request.url);
        const isHtml = url.pathname === "/offline";
        const response = isHtml ? await cache.match(request) : null;
        entries.push({ url: `${name} ${url.pathname}${url.search}`, body: response ? await response.text() : null });
      }
    }
    return entries;
  });
  expect(cached.length).toBeGreaterThan(0);
  const allowed = /^elyra-(shell|static)-\S+ (\/offline|\/_next\/static\/|\/_next\/image\?url=%2Fbrand%2F|\/_next\/image\?url=%2Fproduct%2F|\/brand\/|\/product\/[a-z0-9-]+\.(?:avif|webp)$|\/icons\/|\/manifest\.webmanifest)/;
  expect(cached.map((entry) => entry.url).filter((url) => !allowed.test(url))).toEqual([]);
  expect(cached.some((entry) => /\/api\/|\/dashboard|\/diario|\/meu-humor|\/metas|\/ciclo|\/perfil/.test(entry.url))).toBe(false);
  // O shell guardado nao carrega nome, e-mail nem texto do diario desta pessoa.
  const shell = cached.find((entry) => entry.body !== null);
  expect(shell?.body).toBeTruthy();
  expect(shell?.body).not.toContain("Pessoa Offline");
  expect(shell?.body).not.toContain(email);
  expect(shell?.body).not.toContain(run);
});

test("logout com alteracao so neste aparelho pede escolha antes de apagar", async () => {
  await gotoHydrated(page, "/perfil");
  await waitOfflineReady(page);
  await page.route("**/api/journal/entries", (route) => route.abort("failed"));
  await gotoHydrated(page, "/diario");
  await page.getByLabel("Título").fill(`Logout ${run}`);
  await page.getByLabel("Anotação").fill("Fila pendente no logout.");
  await page.getByRole("button", { name: "Salvar anotação" }).click();
  await expect.poll(() => outboxCount()).toBe(1);

  await gotoHydrated(page, "/perfil");
  await page.getByRole("button", { name: "Sair" }).click();
  const dialog = page.getByRole("dialog", { name: "Há alterações só neste aparelho" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(page).toHaveURL(/\/perfil$/);
  expect(await outboxCount()).toBe(1);

  // Diagnostico: a tela nao pode ficar re-renderizando com a fila parada.
  const mutations = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let count = 0;
        const observer = new MutationObserver((records) => {
          count += records.length;
        });
        observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(count);
        }, 5_000);
      }),
  );
  test.info().annotations.push({ type: "mutations-5s", description: String(mutations) });
  // Com a fila parada em backoff, a tela nao pode entrar em laco de render.
  expect(mutations).toBeLessThan(500);

  await page.getByRole("button", { name: "Sair" }).click();
  const confirm = page.getByRole("dialog").getByRole("button", { name: "Sair e apagar deste aparelho" });
  await expect(confirm).toBeVisible();
  await confirm.click({ noWaitAfter: true });
  await page.waitForURL(/\/entrar/, { timeout: 30_000 });
  expect(await outboxCount(page)).toBe(0);
  await expect.poll(() => openDb<number>(page, "device", "count")).toBe(0);
  await page.unroute("**/api/journal/entries");
});
