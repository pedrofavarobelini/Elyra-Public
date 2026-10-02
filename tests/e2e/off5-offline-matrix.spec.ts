import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { offlinePolicyFor } from "@/lib/offline/route-policy";
import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";
import { cutNetwork, outboxSize, restoreNetwork, waitOfflineReady } from "./offline-network";

/**
 * OFF-5 — QA offline completo, no navegador real, com corte real de rede.
 *
 * - matriz de rotas: o esperado de cada rota vem da `route-policy` canonica
 *   (nunca de uma lista paralela): nucleo/suporte abrem locais; ONLINE_ONLY
 *   explica o porque; area profissional tem tela propria; axe claro e escuro;
 * - inventario de storage: nenhum token, senha, coordenada ou dado profissional;
 * - medidas reais (sem orcamento ficticio): abrir offline, abrir o IndexedDB,
 *   tamanho do Cache Storage e da fila;
 * - cache expirado: lista da Rede de Apoio > 30 dias nunca aparece como atual;
 *   aparelho verificado ha > 14 dias nao abre o nucleo sem rede.
 */

test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

let admin: SupabaseClient<Database>;
let context: BrowserContext;
let page: Page;
let userId = "";
let email = "";
let password = "";
const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);

const ROUTES = [
  // Pessoal
  "/dashboard",
  "/meu-humor",
  "/historico",
  "/diario",
  "/metas",
  "/ciclo",
  "/relatorios",
  "/perfil",
  "/configuracoes",
  "/notificacoes",
  "/seguranca",
  // Sessoes
  "/sessoes",
  "/sessoes/nova",
  "/agenda",
  // Professional Care
  "/profissionais",
  "/profissionais/qualquer-perfil",
  "/convite",
  "/pedidos",
  "/configuracoes/privacidade",
  "/pro",
  "/pro/agenda",
  "/pro/sessoes",
  "/pro/solicitacoes",
  // Rede de Apoio
  "/rede-de-apoio",
  "/conteudos-de-apoio",
] as const;

async function axe(target: Page, label: string) {
  const result = await new AxeBuilder({ page: target }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude(".maplibregl-canvas").analyze();
  expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
  expect(await target.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${label}: sem rolagem lateral`).toBeLessThanOrEqual(0);
}

/** Confere uma rota sem rede contra a politica canonica. Devolve a classe observada. */
async function checkRoute(target: Page, route: string) {
  const policy = offlinePolicyFor(route);
  await target.goto(route).catch(() => undefined);
  await expect(target, route).toHaveURL(/\/offline\?de=/);
  if (policy.area === "professional") {
    const screen = target.getByTestId("professional-offline");
    await expect(screen, route).toBeVisible();
    await expect(screen.getByTestId("online-only-reason")).toHaveText(policy.explanation);
    await expect(target.getByTestId("offline-freshness")).toHaveCount(0);
    return "professional";
  }
  if (policy.shell === "online_only") {
    const card = target.getByTestId("online-only");
    await expect(card.getByRole("heading", { name: "Esta área precisa de conexão", level: 1 }), route).toBeVisible();
    await expect(card.getByTestId("online-only-reason")).toHaveText(policy.explanation);
    await expect(card.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
    return "online_only";
  }
  await expect(target.getByRole("heading", { level: 1 }).first(), route).toBeVisible();
  await expect(target.getByTestId("online-only")).toHaveCount(0);
  await expect(target.getByTestId("professional-offline")).toHaveCount(0);
  if (policy.shell === "core") await expect(target.getByTestId("offline-freshness"), route).toContainText("Sem conexão");
  return policy.shell;
}

async function idbDump(target: Page, name: string) {
  return target.evaluate(async (dbName) => {
    if (!(await indexedDB.databases()).some((db) => db.name === dbName)) return "";
    return new Promise<string>((resolve) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => {
        const db = request.result;
        const stores = [...db.objectStoreNames];
        if (stores.length === 0) return resolve("");
        const tx = db.transaction(stores);
        const out: Record<string, unknown> = {};
        let pending = stores.length;
        for (const store of stores) {
          const all = tx.objectStore(store).getAll();
          all.onsuccess = () => {
            out[store] = all.result;
            if (--pending === 0) resolve(JSON.stringify(out));
          };
          all.onerror = () => {
            if (--pending === 0) resolve(JSON.stringify(out));
          };
        }
        tx.oncomplete = () => db.close();
      };
      request.onerror = () => resolve("");
    });
  }, name);
}

test.beforeAll(async ({ browser, baseURL }, testInfo) => {
  process.loadEnvFile?.(".env.local");
  admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  email = `stage25-offline-${testInfo.project.name}-off5${run}@elyra.invalid`;
  password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa OFF5" });
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

test("matriz de rotas sem rede bate com a route-policy canonica; axe claro e escuro", async () => {
  await gotoHydrated(page, "/diario");
  await waitOfflineReady(page);
  await cutNetwork(context);
  const observed: Record<string, string> = {};
  try {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      for (const route of ROUTES) {
        const kind = await checkRoute(page, route);
        observed[`${scheme} ${route}`] = kind;
        await axe(page, `${scheme} ${route}`);
      }
    }
  } finally {
    await page.emulateMedia({ colorScheme: "light" });
    await restoreNetwork(context);
  }
  const summary = ROUTES.map((route) => {
    const policy = offlinePolicyFor(route);
    return `${route}=${observed[`light ${route}`]}(read=${policy.read},write=${policy.write})`;
  });
  test.info().annotations.push({ type: "route-matrix", description: summary.join(" · ") });
  expect(Object.keys(observed)).toHaveLength(ROUTES.length * 2);
});

test("inventario de storage: sem token, senha, coordenada ou dado profissional; medidas reais", async () => {
  // Uma escrita pendente real (fila), para a fila entrar no inventario.
  await gotoHydrated(page, "/diario");
  await waitOfflineReady(page);
  await cutNetwork(context);
  const marker = `Inventario ${run}`;
  try {
    await page.getByLabel("Título").fill(marker);
    await page.getByLabel("Anotação").fill("Texto do diario guardado so neste aparelho.");
    await page.getByRole("button", { name: "Salvar anotação" }).click();
    await expect.poll(() => outboxSize(page)).toBe(1);

    const started = Date.now();
    await page.goto("/dashboard").catch(() => undefined);
    await expect(page.getByTestId("offline-freshness")).toBeVisible();
    const offlineStartMs = Date.now() - started;

    const measures = await page.evaluate(async () => {
      const t0 = performance.now();
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("elyra-offline");
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
      const idbOpenMs = performance.now() - t0;
      let cacheBytes = 0;
      let cacheEntries = 0;
      const cacheUrls: string[] = [];
      for (const key of await caches.keys()) {
        const cache = await caches.open(key);
        for (const request of await cache.keys()) {
          const response = await cache.match(request);
          cacheBytes += response ? (await response.clone().arrayBuffer()).byteLength : 0;
          cacheEntries += 1;
          cacheUrls.push(new URL(request.url).pathname);
        }
      }
      const estimate = await navigator.storage.estimate();
      const local: Record<string, string> = {};
      for (let i = 0; i < localStorage.length; i += 1) local[localStorage.key(i)!] = localStorage.getItem(localStorage.key(i)!) ?? "";
      const session: Record<string, string> = {};
      for (let i = 0; i < sessionStorage.length; i += 1) session[sessionStorage.key(i)!] = sessionStorage.getItem(sessionStorage.key(i)!) ?? "";
      return {
        idbOpenMs,
        cacheBytes,
        cacheEntries,
        cacheUrls,
        usage: estimate.usage ?? null,
        local,
        session,
        dbs: (await indexedDB.databases()).map((db) => db.name),
      };
    });
    const offline = await idbDump(page, "elyra-offline");
    const everything = JSON.stringify(measures.local) + JSON.stringify(measures.session) + offline + measures.cacheUrls.join(" ");

    // O que PODE estar: o diario pendente, no IndexedDB do nucleo (ADR-0014).
    expect(offline).toContain(marker);
    // O que NUNCA pode estar em nenhum storage do navegador.
    expect(everything).not.toContain(password);
    expect(everything).not.toMatch(/access_token|refresh_token|provider_token/);
    expect(everything).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./);
    expect(everything).not.toMatch(/"(latitude|longitude|lat|lng)"\s*:/);
    expect(everything).not.toMatch(/professional_user_id|registration_number|help_request|appointment/);
    // Web Storage nao guarda conteudo da pessoa.
    expect(JSON.stringify(measures.local) + JSON.stringify(measures.session)).not.toContain(marker);
    // Cache Storage: so shell e assets, nunca HTML autenticado nem API.
    expect(measures.cacheUrls.filter((path) => /^\/(api|dashboard|diario|meu-humor|metas|ciclo|perfil|historico|relatorios|pro)(\/|$)/.test(path))).toEqual([]);
    expect(measures.dbs.every((name) => name === "elyra-offline" || name === "elyra-support-network")).toBe(true);

    test.info().annotations.push({
      type: "performance",
      description: JSON.stringify({
        offlineStartMs,
        idbOpenMs: Math.round(measures.idbOpenMs * 10) / 10,
        cacheEntries: measures.cacheEntries,
        cacheKiB: Math.round(measures.cacheBytes / 1024),
        storageUsageKiB: measures.usage === null ? null : Math.round(measures.usage / 1024),
        outbox: await outboxSize(page),
        localKeys: Object.keys(measures.local).length,
        sessionKeys: Object.keys(measures.session).length,
      }),
    });
  } finally {
    await restoreNetwork(context);
  }
  // Volta a rede: a fila esvazia e o servidor recebe uma linha.
  await gotoHydrated(page, "/diario");
  await expect.poll(() => outboxSize(page), { timeout: 45_000 }).toBe(0);
  const saved = await admin.from("journal_entries").select("id").eq("user_id", userId).eq("title", marker);
  expect(saved.data).toHaveLength(1);
});

test("Rede de Apoio: lista com mais de 30 dias nunca aparece como atual sem rede", async () => {
  await page.route("https://tiles.openfreemap.org/**", (route) => route.fulfill({ status: 404, body: "" }));
  await gotoHydrated(page, "/rede-de-apoio");
  const input = page.getByLabel("Município", { exact: true });
  const choose = async () => {
    await input.fill("sao pa");
    await page.getByRole("list", { name: "Municípios encontrados" }).getByRole("button", { name: /^São Paulo — SP/ }).click();
  };
  await choose();
  await expect(page.getByTestId("support-list").getByRole("article").first()).toBeVisible();
  await expect.poll(async () => (await idbDump(page, "elyra-support-network")).includes('"cachedAt"')).toBe(true);

  // Controle: dentro do prazo, sem rede, a lista salva aparece com data e aviso.
  await cutNetwork(context);
  try {
    await choose();
    await expect(page.getByTestId("support-offline-banner")).toContainText(/lista salva em .* pode estar desatualizada/);
    // Outro municipio sem lista salva: a lista anterior nunca fica na tela como se fosse dele.
    await input.fill("orl");
    await page.getByRole("list", { name: "Municípios encontrados" }).getByRole("button", { name: /^Orlândia — SP/ }).click();
    await expect(page.getByText(/Não foi possível/).first()).toBeVisible();
    await expect(page.getByTestId("support-list").getByRole("article")).toHaveCount(0);
    await expect(page.getByTestId("support-offline-banner")).toHaveCount(0);
  } finally {
    await restoreNetwork(context);
  }
  // Com a rede de volta a tela refaz a busca e grava de novo; espera terminar antes de envelhecer.
  await gotoHydrated(page, "/rede-de-apoio");
  await choose();
  await expect(page.getByTestId("support-list").getByRole("article").first()).toBeVisible();
  await expect
    .poll(async () => {
      const saved = /"cachedAt":(\d+)/.exec(await idbDump(page, "elyra-support-network"))?.[1];
      return saved ? Date.now() - Number(saved) < 60_000 : false;
    }, { timeout: 20_000 })
    .toBe(true);

  // Envelhece a lista salva para 31 dias.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("elyra-support-network");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("lists", "readwrite");
          const store = tx.objectStore("lists");
          const all = store.getAll();
          all.onsuccess = () => {
            for (const entry of all.result as { cachedAt: number }[]) store.put({ ...entry, cachedAt: Date.now() - 31 * 86_400_000 });
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await gotoHydrated(page, "/rede-de-apoio");
  await cutNetwork(context);
  try {
    await choose();
    await expect(page.getByText(/Não foi possível/).first()).toBeVisible();
    await expect(page.getByTestId("support-offline-banner")).toHaveCount(0);
    await expect(page.getByTestId("support-list").getByRole("article")).toHaveCount(0);
    // A lista vencida foi apagada do aparelho, nao so escondida.
    await expect.poll(async () => (await idbDump(page, "elyra-support-network")).includes('"cachedAt"')).toBe(false);
  } finally {
    await restoreNetwork(context);
    await page.unroute("https://tiles.openfreemap.org/**");
  }
});

test("aparelho verificado ha mais de 14 dias: sem rede o nucleo nao abre; com rede volta a valer", async () => {
  await gotoHydrated(page, "/diario");
  await waitOfflineReady(page);
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("elyra-offline");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("device", "readwrite");
          const store = tx.objectStore("device");
          const all = store.getAll();
          all.onsuccess = () => {
            for (const device of all.result as { verifiedAt: string }[]) {
              store.put({ ...device, verifiedAt: new Date(Date.now() - 15 * 86_400_000).toISOString() });
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
  );
  await cutNetwork(context);
  try {
    await page.goto("/diario").catch(() => undefined);
    await expect(page).toHaveURL(/\/offline\?de=%2Fdiario/);
    await expect(page.getByRole("heading", { name: "Sem conexão", level: 1 })).toBeVisible();
    await expect(page.getByTestId("offline-freshness")).toHaveCount(0);
    await expect(page.getByText(`Inventario ${run}`)).toHaveCount(0);
    await axe(page, "shell vencido");
  } finally {
    await restoreNetwork(context);
  }
  // Com rede, a verificacao online renova o aparelho e o nucleo volta a abrir sem rede.
  await gotoHydrated(page, "/diario");
  await waitOfflineReady(page);
  await expect
    .poll(async () => {
      const dump = await idbDump(page, "elyra-offline");
      const verified = /"verifiedAt":"([^"]+)"/.exec(dump)?.[1];
      return verified ? Date.now() - Date.parse(verified) < 60 * 60_000 : false;
    }, { timeout: 30_000 })
    .toBe(true);
  await cutNetwork(context);
  try {
    await page.goto("/diario").catch(() => undefined);
    await expect(page.getByTestId("offline-freshness")).toBeVisible();
  } finally {
    await restoreNetwork(context);
  }
});

async function setVerifiedDaysAgo(target: Page, days: number) {
  await target.evaluate(
    (age) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("elyra-offline");
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction("device", "readwrite");
          const store = tx.objectStore("device");
          const all = store.getAll();
          all.onsuccess = () => {
            for (const device of all.result as { verifiedAt: string }[]) {
              store.put({ ...device, verifiedAt: new Date(Date.now() - age * 86_400_000).toISOString() });
            }
          };
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        request.onerror = () => reject(request.error);
      }),
    days,
  );
}

async function deviceRecord(target: Page) {
  const dump = await idbDump(target, "elyra-offline");
  const device = (JSON.parse(dump || "{}") as { device?: { verifiedAt: string; appLockId?: string | null; userId: string }[] }).device?.[0];
  return device ? { ageMin: (Date.now() - Date.parse(device.verifiedAt)) / 60_000, appLockId: device.appLockId ?? null, userId: device.userId } : null;
}

test("prazo offline: 13 dias abre; reload renova; App Lock ativo nao desfaz; logout/login comeca do zero", async ({ baseURL }) => {
  // A: primeiro uso ja gravou (renovado agora pelo teste anterior).
  await gotoHydrated(page, "/diario");
  await waitOfflineReady(page);
  expect((await deviceRecord(page))?.ageMin).toBeLessThan(60);

  // E: 13 dias sem verificar ainda abre o nucleo sem rede.
  await setVerifiedDaysAgo(page, 13);
  await cutNetwork(context);
  try {
    await page.goto("/diario").catch(() => undefined);
    await expect(page.getByTestId("offline-freshness")).toBeVisible();
  } finally {
    await restoreNetwork(context);
  }

  // B + C: com App Lock ativo, o reload online renova e o appLockId continua.
  await gotoHydrated(page, "/seguranca");
  await page.getByRole("button", { name: "Ativar App Lock" }).click();
  const dialog = page.getByRole("dialog", { name: "Criar PIN da Elyra" });
  await dialog.getByLabel("Novo PIN").fill("482915");
  await dialog.getByLabel("Confirmar PIN").fill("482915");
  await dialog.getByRole("button", { name: "Ativar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("App Lock ativado");
  await expect.poll(async () => (await deviceRecord(page))?.appLockId ?? null).not.toBeNull();
  const lockId = (await deviceRecord(page))!.appLockId;
  for (let round = 0; round < 3; round += 1) {
    await setVerifiedDaysAgo(page, 13);
    await gotoHydrated(page, "/dashboard");
    await expect.poll(async () => (await deviceRecord(page))?.ageMin ?? 1e9, { timeout: 20_000 }).toBeLessThan(5);
    expect((await deviceRecord(page))?.appLockId).toBe(lockId);
  }

  // D: logout apaga o aparelho; o login seguinte grava do zero, nunca o valor antigo.
  await setVerifiedDaysAgo(page, 13);
  await gotoHydrated(page, "/perfil");
  await page.getByRole("button", { name: "Sair" }).click();
  await page.waitForURL(/\/entrar/, { timeout: 30_000 });
  expect(await deviceRecord(page)).toBeNull();
  await loginThroughUi(page, baseURL!, { email, password });
  await gotoHydrated(page, "/dashboard");
  await expect.poll(async () => (await deviceRecord(page))?.ageMin ?? 1e9, { timeout: 20_000 }).toBeLessThan(5);
});
