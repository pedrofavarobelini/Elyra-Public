import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { measureDeadSpace } from "./dead-space";
import { setSessionsEnabled } from "./multimodal-mocks";
import {
  cleanupAccounts,
  createPersonalAccount,
  createProfessionalAccount,
  qaAdmin,
  signIn,
  type QaAccount,
} from "./professional-fixtures";


// viu em /sessoes. Aqui as barras sao reais (ocupam largura, como no Windows).
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

type Client = SupabaseClient<Database>;
const TZ = "America/Sao_Paulo";

async function userClient(account: QaAccount): Promise<Client> {
  process.loadEnvFile?.(".env.local");
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw error;
  return client;
}

/** Largura alcancada por texto e controles reais dentro de `selector`, sobre a largura interna. */
async function contentSpread(page: Page, selector: string) {
  return page.$eval(selector, (region) => {
    const box = region.getBoundingClientRect();
    const style = getComputedStyle(region);
    const innerLeft = box.left + parseFloat(style.paddingLeft);
    const innerWidth = box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    let right = innerLeft;
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width > 0) right = Math.max(right, rect.right);
    }
    for (const el of region.querySelectorAll("button, a[href], input, select, [role=tab], section")) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0) right = Math.max(right, rect.right);
    }
    return Math.round(((right - innerLeft) / innerWidth) * 100) / 100;
  });
}

/**
 * Rolagem lateral no documento OU em qualquer caixa dentro do <main> (tabela
 * com `min-width`, coluna espremida). `overflow-x-hidden` que so esconde
 * conteudo cortado tambem conta: filho mais largo que a caixa e falha.
 */
async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const problems: string[] = [];
    if (doc.scrollWidth > doc.clientWidth) problems.push(`documento ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll<HTMLElement>("main *")) {
      // `.sr-only` e oculto de proposito (1px, so para leitor de tela); mapa e SOS tem geometria propria.
      if (el.closest(".maplibregl-map, [data-elyra-sos], .sr-only")) continue;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.position === "fixed") continue;
      const clips = ["auto", "scroll", "hidden", "clip"].includes(style.overflowX);
      if (clips && el.clientWidth > 0 && el.scrollWidth - el.clientWidth > 1) {
        problems.push(`${el.tagName.toLowerCase()}${el.dataset.testid ? `[${el.dataset.testid}]` : ""}.${[...el.classList].slice(0, 3).join(".")} ${el.scrollWidth}>${el.clientWidth}`);
      }
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > doc.clientWidth + 1) problems.push(`${el.tagName.toLowerCase()} alem da tela (${Math.round(rect.right)}>${doc.clientWidth})`);
    }
    return problems.slice(0, 10);
  });
}

async function shot(page: Page, name: string, project: string) {
  await page.screenshot({ path: `test-results/sessions-layout/${project}-${name}.png`, fullPage: true });
}

test.describe("Stage 29 - espaco morto em Sessoes/Agenda (QA do owner)", () => {
  test("pessoa e profissional: conteudo usa a largura; sem rolagem lateral; axe", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const project = testInfo.project.name;
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const pro = await createProfessionalAccount(admin, project, "Profissional Layout");
      created.push(pro.userId);
      const person = await createPersonalAccount(admin, project, "Pessoa Layout");
      created.push(person.userId);
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

      const proClient = await userClient(pro);
      const saved = await proClient.rpc("save_professional_availability", {
        p_timezone: TZ,
        p_rules: [{ weekday: 6, start_minute: 660, end_minute: 720, slot_minutes: 60, modality: "online" }],
      });
      if (saved.error) throw saved.error;

      const context = await browser.newContext({ ...testInfo.project.use, timezoneId: TZ, locale: "pt-BR", storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      await signIn(page, baseURL!, person);

      await page.goto("/sessoes");
      await page.waitForSelector("html[data-hydrated='true']");
      await shot(page, "sessoes", project);
      expect(await horizontalOverflow(page), "/sessoes desligado").toEqual([]);

      await setSessionsEnabled(page, true);
      await page.goto("/sessoes");
      await page.waitForSelector("html[data-hydrated='true']");
      await expect(page.getByRole("heading", { name: "Sessões multimodais", level: 2, exact: true })).toBeVisible();
      await shot(page, "sessoes-ativas", project);
      expect(await horizontalOverflow(page), "/sessoes ligado").toEqual([]);
      if (project === "desktop") {
        // Permissoes nao ficam espremidas: os grupos usam a largura do cartao de preparo.
        const groups = await page.getByTestId("session-permission-groups").boundingBox();
        const main = await page.locator("main").boundingBox();
        expect(groups!.width / main!.width, "grupos de permissao na largura do conteudo").toBeGreaterThan(0.6);

        for (const width of [1366, 1280]) {
          await page.setViewportSize({ width, height: 768 });
          await shot(page, `sessoes-ativas-${width}`, project);
          expect(await horizontalOverflow(page), `/sessoes ligado ${width}`).toEqual([]);
        }
        await page.setViewportSize({ width: 1440, height: 900 });
      }
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id), `sessoes ${theme}`).toEqual([]);
      }
      await page.emulateMedia({ colorScheme: "light" });

      await page.goto("/agenda");
      await page.waitForSelector("html[data-hydrated='true']");
      await shot(page, "agenda-proximas", project);
      const spreads: Record<string, number> = { professionals: await contentSpread(page, "[data-testid='agenda-professionals']") };
      await page.getByRole("tab", { name: "Agendar" }).click();
      await expect(page.getByText(/11:00/).first()).toBeVisible();
      await shot(page, "agenda-agendar", project);
      spreads.agendar = await contentSpread(page, "[data-testid='agenda-slots']");
      await page.getByRole("tab", { name: "Histórico" }).click();
      await shot(page, "agenda-historico", project);
      testInfo.annotations.push({ type: "spread", description: JSON.stringify(spreads) });
      expect((await measureDeadSpace(page)).horizontalOverflow).toBeLessThanOrEqual(0);
      if (project === "desktop") {

        // menos 60% da largura de cada regiao no desktop.
        for (const [region, spread] of Object.entries(spreads)) expect(spread, `${region} spread`).toBeGreaterThanOrEqual(0.6);
      }
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.getByRole("tab", { name: "Agendar" }).click();
        const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id), theme).toEqual([]);
      }
      await context.close();

      const proContext = await browser.newContext({ ...testInfo.project.use, timezoneId: TZ, locale: "pt-BR", storageState: { cookies: [], origins: [] } });
      const proPage = await proContext.newPage();
      await signIn(proPage, baseURL!, pro);
      for (const path of ["/pro/agenda", "/pro/sessoes"]) {
        await proPage.goto(path);
        await proPage.waitForSelector("html[data-hydrated='true']");
        await shot(proPage, path.replaceAll("/", "_"), project);
        expect((await measureDeadSpace(proPage)).horizontalOverflow, path).toBeLessThanOrEqual(0);
      }
      await proContext.close();
      void connection;
    } finally {
      await cleanupAccounts(admin, created);
    }
  });
});
