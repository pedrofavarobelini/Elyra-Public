import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";
import { cleanupSessions, installMediaMocks, openEnabledSessions, setSessionsEnabled } from "./multimodal-mocks";
import { cutNetwork, restoreNetwork, waitOfflineReady } from "./offline-network";

/**
 * OFF-3:
 * - sessao particular: a rede cai no "Finalizar" -> a sessao termina NESTE
 *   aparelho, a UI nao trava, nada vai para disco; a rede volta com a aba
 *   aberta -> sincroniza sozinha, uma vez (idempotente);
 * - sessao presa em `capturing` ha mais de 6 h -> reparada para `error` na leitura;
 * - relatorios offline dizem "dados disponiveis ate" e baixam o arquivo sem rede;
 * - conteudo offline: link externo avisa que precisa de internet; REVIEW nunca aparece.
 */

test.describe("OFF-3 - sessao particular", () => {
  test.afterEach(async ({ page }) => {
    await cleanupSessions(page);
    await setSessionsEnabled(page, false);
  });

  test("rede cai no Finalizar: finalizada neste aparelho; volta a rede: sincroniza uma vez", async ({ page }) => {
    test.setTimeout(120_000);
    await installMediaMocks(page);
    await openEnabledSessions(page);
    await page.getByRole("switch", { name: "Usar câmera" }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
    await expect(page.getByTestId("capture-state-camera")).toHaveText("Captura ativa");
    const id = new URL(page.url()).searchParams.get("id")!;
    const indexedBefore = await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name).sort());
    const localBefore = await page.evaluate(() => Object.keys(localStorage).sort());

    // A rede cai: toda chamada da sessao falha em transporte.
    await page.route("**/api/multimodal/**", (route) => route.abort("internetdisconnected"));
    await page.getByRole("button", { name: "Finalizar sessão" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Finalizar sessão" }).click();
    const waiting = page.getByTestId("finalize-awaiting-sync");
    await expect(waiting).toContainText("Sessão finalizada neste dispositivo.");
    await expect(waiting).toContainText("O resultado será sincronizado quando a conexão voltar.");
    // A UI nao fica presa em "Finalizar" nem finge que sincronizou.
    await expect(page.getByRole("button", { name: "Finalizar sessão" })).toHaveCount(0);
    const stillOpen = await (await page.request.get(`/api/multimodal/sessions/${id}`)).json();
    expect(stillOpen.data.status).toBe("capturing");

    // "Tentar agora" ainda sem rede: continua aguardando, sem erro tecnico.
    await page.getByTestId("finalize-sync-now").click();
    await expect(waiting).toBeVisible();
    await expect(page.getByText(/Failed to fetch|TypeError/)).toHaveCount(0);

    // Nada novo em disco: nenhuma base IndexedDB nova, nenhuma chave nova.
    expect(await page.evaluate(async () => (await indexedDB.databases()).map((db) => db.name).sort())).toEqual(indexedBefore);
    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(localBefore);

    // Volta a rede com a aba aberta: sincroniza sozinha e abre o resultado.
    await page.unroute("**/api/multimodal/**");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page).toHaveURL(new RegExp(`/sessoes/${id}$`), { timeout: 30_000 });
    const done = await (await page.request.get(`/api/multimodal/sessions/${id}`)).json();
    expect(done.data.status).toBe("completed");
    // Idempotente: repetir o status final nao cria outra finalizacao nem erro.
    const again = await page.request.patch(`/api/multimodal/sessions/${id}`, { data: { status: "completed" } });
    expect(again.ok()).toBe(true);
    expect((await again.json()).data.status).toBe("completed");
  });
});

test.describe("OFF-3 - sessao presa, relatorios e conteudo sem rede", () => {
  test.describe.configure({ mode: "serial" });
  let admin: ReturnType<typeof createClient<Database>>;
  let email = "";
  let password = "";
  let userId = "";

  test.beforeAll(async ({}, testInfo) => {
    process.loadEnvFile?.(".env.local");
    admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    email = `stage25-offline-${testInfo.project.name}-off3${run}@elyra.invalid`;
    password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
    userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa OFF3" });
  });

  test.afterAll(async () => {
    if (!userId) return;
    await admin.from("multimodal_sessions").delete().eq("user_id", userId);
    await admin.from("emotional_checkins").delete().eq("user_id", userId);
    await admin.from("audit_logs").delete().eq("actor_user_id", userId);
    assertNotQaCanonicalAccount(email);
    await admin.auth.admin.deleteUser(userId);
  });

  test("sessao aberta ha mais de 6 h e reparada para falha na leitura; recente fica intacta", async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      await loginThroughUi(page, baseURL!, { email, password });
      const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
      const { data: rows, error } = await admin
        .from("multimodal_sessions")
        .insert([
          { user_id: userId, kind: "guided", status: "capturing", camera_consent: true, started_at: hoursAgo(7) },
          { user_id: userId, kind: "guided", status: "paused", camera_consent: true, started_at: hoursAgo(1) },
        ])
        .select("id,status");
      if (error) throw error;
      const [stale, recent] = rows!;
      const list = (await (await page.request.get("/api/multimodal/sessions")).json()) as { data: Array<{ id: string; status: string }> };
      expect(list.data.find((s) => s.id === stale!.id)?.status).toBe("error");
      expect(list.data.find((s) => s.id === recent!.id)?.status).toBe("paused");
      const { data: db } = await admin.from("multimodal_sessions").select("status,ended_at").eq("id", stale!.id).single();
      expect(db?.status).toBe("error");
      expect(db?.ended_at).not.toBeNull();
    } finally {
      await context.close();
    }
  });

  test("relatorios sem rede: 'dados disponiveis ate' e baixar funcionam; conteudo avisa link externo; REVIEW nunca aparece", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    await admin.from("emotional_checkins").insert({ user_id: userId, mood_score: 6, perceived_anxiety_score: 4, energy_score: 5, occurred_at: new Date().toISOString() });
    const context = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: "allow", acceptDownloads: true });
    const page = await context.newPage();
    try {
      await loginThroughUi(page, baseURL!, { email, password });
      await gotoHydrated(page, "/relatorios");
      await waitOfflineReady(page);
      await cutNetwork(context);
      await page.reload().catch(() => undefined);
      await expect(page).toHaveURL(/\/offline\?de=%2Frelatorios/);
      await expect(page.getByTestId("report-data-until")).toContainText("Sem conexão: dados disponíveis até");
      await expect(page.getByText(/dados deste aparelho até/)).toBeVisible();
      await expect(page.getByText(/Calculado com os dados disponíveis até/)).toBeVisible();

      for (const [label, extension] of [["Baixar para leitura", ".txt"], ["Baixar dados", ".json"]] as const) {
        const download = page.waitForEvent("download");
        await page.getByRole("button", { name: label }).click();
        expect((await download).suggestedFilename()).toMatch(new RegExp(`\\${extension}$`));
      }

      // Conteudo: landing offline avisa que o link externo precisa de internet.
      await page.goto("/conteudos-de-apoio").catch(() => undefined);
      await expect(page.getByTestId("external-offline-note").first()).toHaveText("(precisa de internet)");
      // REVIEW nunca aparece offline (so PUBLISHED esta no bundle).
      const review = readFileSync(resolve(process.cwd(), "src/lib/support-content/review.generated.ts"), "utf8");
      const slug = /"slug": "([^"]+)"/.exec(review)?.[1];
      expect(slug).toBeTruthy();
      await page.goto(`/conteudos-de-apoio/${slug}`).catch(() => undefined);
      await expect(page.getByText("Conteúdo não encontrado.")).toBeVisible();
    } finally {
      await restoreNetwork(context).catch(() => undefined);
      await context.close();
    }
  });
});
