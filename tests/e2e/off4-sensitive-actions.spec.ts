import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import { cutNetwork, restoreNetwork, waitOfflineReady } from "./offline-network";
import {
  cleanupAccounts,
  createPersonalAccount,
  createProfessionalAccount,
  qaAdmin,
  signIn,
  type QaAccount,
} from "./professional-fixtures";

/**
 * OFF-4 — acoes sensiveis sem rede, com a tela ja aberta (corte real de rede).
 *
 * - `/pro/solicitacoes`: Aceitar/Recusar desabilitados antes do clique; o
 *   vinculo continua `pending` no banco; voltando a rede, reabilitam;
 * - compartilhamento (grants/janela) e recado: desabilitados com o motivo;
 *   nenhum grant e nenhum recado sao criados;
 * - logout pela tela do App Lock: mesma limpeza unica (fila, snapshot, aparelho
 *   e Rede de Apoio).
 */

test.setTimeout(240_000);

const NOTE = "Sem conexão: esta ação precisa de internet. Nada foi alterado.";

async function open(browser: Browser, baseURL: string, account: QaAccount, withWorker = false) {
  const context = await browser.newContext({
    ...test.info().project.use,
    baseURL,
    storageState: { cookies: [], origins: [] },
    serviceWorkers: withWorker ? "allow" : "block",
  });
  const page = await context.newPage();
  await signIn(page, baseURL, account);
  return { context, page };
}

async function axeClean(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => v.id), label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), label).toBeLessThanOrEqual(0);
}

test("sem rede: solicitacao, compartilhamento e recado ficam desabilitados e nada muda no servidor", async ({ browser, baseURL }, testInfo) => {
  const admin = qaAdmin();
  const created: string[] = [];
  try {
    const pro = await createProfessionalAccount(admin, testInfo.project.name, "Helena Offline");
    const person = await createPersonalAccount(admin, testInfo.project.name, "Marina Offline");
    const requester = await createPersonalAccount(admin, testInfo.project.name, "Pedido Offline");
    created.push(pro.userId, person.userId, requester.userId);
    const { data: active, error } = await admin
      .from("professional_connections")
      .insert({
        client_user_id: person.userId,
        professional_user_id: pro.userId,
        invited_by_user_id: pro.userId,
        status: "active",
        accepted_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    const { data: pending, error: pendingError } = await admin
      .from("professional_connections")
      .insert({ client_user_id: requester.userId, professional_user_id: pro.userId, invited_by_user_id: requester.userId, status: "pending" })
      .select("id")
      .single();
    if (pendingError) throw pendingError;

    // 1. Profissional: Central de solicitacoes.
    const proSide = await open(browser, baseURL!, pro);
    try {
      const q = proSide.page;
      await gotoHydrated(q, "/pro/solicitacoes");
      const accept = q.getByRole("button", { name: "Aceitar" });
      await expect(accept).toBeEnabled();
      await cutNetwork(proSide.context);
      await expect(q.getByTestId("requires-connection-note")).toHaveText(NOTE);
      await expect(accept).toBeDisabled();
      await expect(q.getByRole("button", { name: "Recusar" })).toBeDisabled();
      await axeClean(q, "/pro/solicitacoes offline");
      await restoreNetwork(proSide.context);
      await expect(q.getByTestId("requires-connection-note")).toHaveCount(0, { timeout: 20_000 });
      await expect(accept).toBeEnabled();
    } finally {
      await proSide.context.close();
    }
    const { data: stillPending } = await admin.from("professional_connections").select("status").eq("id", pending.id).single();
    expect(stillPending?.status).toBe("pending");

    // 2. Pessoa: compartilhamento e recado.
    const personSide = await open(browser, baseURL!, person);
    try {
      const p = personSide.page;
      await gotoHydrated(p, "/configuracoes/privacidade");
      const sharing = p.locator("fieldset[data-requires-connection]").first();
      await expect(sharing).toHaveAttribute("data-requires-connection", "online");
      await cutNetwork(personSide.context);
      await expect(sharing).toHaveAttribute("data-requires-connection", "offline", { timeout: 20_000 });
      await expect(p.getByTestId("requires-connection-note").first()).toHaveText(NOTE);
      for (const control of await sharing.locator("button, input, select").all()) {
        if (await control.isVisible()) await expect(control).toBeDisabled();
      }
      await axeClean(p, "/configuracoes/privacidade offline");
      await restoreNetwork(personSide.context);
      await expect(sharing).toHaveAttribute("data-requires-connection", "online", { timeout: 20_000 });

      await gotoHydrated(p, "/pedidos");
      const form = p.getByTestId("help-request-form");
      await form.getByLabel("Seu recado").fill("Recado que nao pode sair sem rede.");
      await cutNetwork(personSide.context);
      await expect(form.getByRole("button", { name: "Enviar recado" })).toBeDisabled({ timeout: 20_000 });
      await expect(p.getByTestId("requires-connection-note")).toHaveText(NOTE);
      await axeClean(p, "/pedidos offline");
      await restoreNetwork(personSide.context);
      await expect(form.getByRole("button", { name: "Enviar recado" })).toBeEnabled({ timeout: 20_000 });
    } finally {
      await personSide.context.close();
    }
    const { count: grants } = await admin.from("sharing_permissions").select("id", { count: "exact", head: true }).eq("connection_id", active.id);
    expect(grants).toBe(0);
    const { count: recados } = await admin.from("help_requests").select("id", { count: "exact", head: true }).eq("client_user_id", person.userId);
    expect(recados).toBe(0);
  } finally {
    await cleanupAccounts(admin, created);
  }
});

test("pre-chamada sem rede: Entrar desabilitado com o motivo, nas duas pontas", async ({ browser, baseURL }, testInfo) => {
  const admin = qaAdmin();
  const created: string[] = [];
  try {
    const pro = await createProfessionalAccount(admin, testInfo.project.name, "Helena Sala Offline");
    const person = await createPersonalAccount(admin, testInfo.project.name, "Marina Sala Offline");
    created.push(pro.userId, person.userId);
    const { data: connection, error } = await admin
      .from("professional_connections")
      .insert({
        client_user_id: person.userId,
        professional_user_id: pro.userId,
        invited_by_user_id: person.userId,
        status: "active",
        accepted_at: new Date(Date.now() - 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    const starts = new Date(Date.now() + 5 * 60_000);
    starts.setSeconds(0, 0);
    const { data: appointment, error: apptError } = await admin
      .from("appointments")
      .insert({
        connection_id: connection.id,
        client_user_id: person.userId,
        professional_user_id: pro.userId,
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 50 * 60_000).toISOString(),
        timezone: "America/Sao_Paulo",
        modality: "online",
        status: "confirmed",
        requested_by: person.userId,
        idempotency_key: crypto.randomUUID(),
        confirmed_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (apptError) throw apptError;
    const { data: session } = await admin.from("professional_sessions").select("id").eq("appointment_id", appointment.id).single();

    for (const [account, route] of [
      [person, `/agenda/sessao/${session!.id}`],
      [pro, `/pro/sessoes/${session!.id}`],
    ] as const) {
      const side = await open(browser, baseURL!, account);
      try {
        await gotoHydrated(side.page, route);
        await expect(side.page.getByTestId("pre-call")).toBeVisible();
        const guard = side.page.locator("fieldset[data-requires-connection]").filter({ has: side.page.getByTestId("join-call") });
        await expect(guard).toHaveAttribute("data-requires-connection", "online");
        await cutNetwork(side.context);
        await expect(guard).toHaveAttribute("data-requires-connection", "offline", { timeout: 20_000 });
        await expect(side.page.getByTestId("requires-connection-note")).toHaveText("Você precisa de conexão para participar desta sessão.");
        await expect(side.page.getByTestId("join-call")).toBeDisabled();
        await restoreNetwork(side.context);
        await expect(guard).toHaveAttribute("data-requires-connection", "online", { timeout: 20_000 });
      } finally {
        await side.context.close();
      }
    }
  } finally {
    await admin.from("appointments").delete().in("client_user_id", created);
    await cleanupAccounts(admin, created);
  }
});

test("logout pela tela do App Lock apaga os dados deste aparelho e a Rede de Apoio", async ({ browser, baseURL }, testInfo) => {
  const admin = qaAdmin();
  const created: string[] = [];
  try {
    const person = await createPersonalAccount(admin, testInfo.project.name, "Pessoa Lock Offline");
    created.push(person.userId);
    const { context, page } = await open(browser, baseURL!, person, true);
    try {
      await gotoHydrated(page, "/seguranca");
      await waitOfflineReady(page);
      await page.getByRole("button", { name: "Ativar App Lock" }).click();
      const dialog = page.getByRole("dialog", { name: "Criar PIN da Elyra" });
      await dialog.getByLabel("Novo PIN").fill("482915");
      await dialog.getByLabel("Confirmar PIN").fill("482915");
      await dialog.getByRole("button", { name: "Ativar", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("App Lock ativado");
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

      await page.getByRole("button", { name: "Bloquear agora" }).click();
      await expect(page.getByRole("heading", { name: "Elyra bloqueada" })).toBeVisible();
      await page.getByRole("button", { name: "Sair e entrar novamente" }).click();
      await expect(page).toHaveURL(/\/entrar$/);

      const after = await page.evaluate(async () => {
        const names = (await indexedDB.databases()).map((db) => db.name);
        const counts = await new Promise<number[]>((resolve) => {
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
            void Promise.all(["snapshots", "device", "outbox", "appLocks"].map(count)).then(resolve);
          };
          request.onerror = () => resolve([-1, -1, -1, -1]);
        });
        return { supportNetwork: names.includes("elyra-support-network"), counts };
      });
      expect(after).toEqual({ supportNetwork: false, counts: [0, 0, 0, 0] });
    } finally {
      await context.close();
    }
  } finally {
    await cleanupAccounts(admin, created);
  }
});
