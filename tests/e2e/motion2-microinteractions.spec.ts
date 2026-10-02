import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import { cleanupAccounts, createProfessionalAccount, qaAdmin, signIn } from "./professional-fixtures";

/**
 * MOTION-2 — microinteracoes funcionais, nunca decorativas.
 *
 * - troca Pessoal <-> Profissional: faixa curta dizendo onde a pessoa esta, so
 *   quando a area MUDOU (reload e navegacao interna nao mostram);
 * - movimento reduzido (sistema OU preferencia interna): a faixa aparece igual,
 *   sem animacao (duracao efetiva ~0);
 * - meta: o selo so anima quando o status muda; progresso por `scaleX`;
 * - axe claro/escuro e sem rolagem lateral em cada estado.
 */

test.setTimeout(240_000);

async function switchTo(page: Page, project: string, target: "pro" | "pessoal") {
  const name = target === "pro" ? "Ir para a área profissional" : "Ir para a área pessoal";
  if (project === "desktop") {
    await page.locator("[data-elyra-sidebar] [data-testid='context-switcher']").getByRole("button", { name }).click();
  } else {
    await page.getByRole("button", { name: "Abrir menu de navegação" }).click();
    await page.getByRole("dialog").getByTestId("context-switcher").getByRole("button", { name }).click();
  }
}

async function axeClean(page: Page, label: string) {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `${scheme} ${label}`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${scheme} ${label}`).toBeLessThanOrEqual(0);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("troca de area: faixa so quando a area muda; movimento reduzido zera a animacao", async ({ browser, baseURL }, testInfo) => {
  const admin = qaAdmin();
  const created: string[] = [];
  try {
    const pro = await createProfessionalAccount(admin, testInfo.project.name, "Helena Motion");
    created.push(pro.userId);
    const context = await browser.newContext({ ...testInfo.project.use, baseURL, storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    try {
      await signIn(page, baseURL!, pro);
      await expect(page).toHaveURL(/\/dashboard$/);
      // Primeira carga nao anuncia nada.
      await expect(page.getByTestId("context-arrival")).toHaveCount(0);

      await switchTo(page, testInfo.project.name, "pro");
      await expect(page).toHaveURL(/\/pro\/dashboard$/);
      const arrival = page.getByTestId("context-arrival");
      await expect(arrival).toHaveAttribute("data-context", "professional");
      await expect(arrival).toHaveText("Você está na área profissional. A mesma conta, outro ambiente.");
      // Anunciado pelo contenedor aria-live, sem competir com o status da tela.
      await expect(page.locator("[aria-live='polite']").filter({ has: arrival })).toHaveCount(1);
      await expect(arrival).not.toHaveAttribute("role", "status");
      await axeClean(page, "chegada na area profissional");
      // Reload na mesma area: nada.
      await page.reload();
      await page.waitForSelector("html[data-hydrated='true']");
      await expect(page.getByTestId("context-arrival")).toHaveCount(0);

      // Volta com movimento reduzido do sistema: mesma faixa, sem animacao.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await switchTo(page, testInfo.project.name, "pessoal");
      await expect(page).toHaveURL(/\/dashboard$/);
      await expect(page.getByTestId("context-arrival")).toHaveText("Você voltou para a área pessoal.");
      const duration = await page.getByTestId("context-arrival").evaluate((el) => getComputedStyle(el).animationDuration);
      expect(parseFloat(duration)).toBeLessThan(0.001);
      await page.emulateMedia({ reducedMotion: "no-preference" });
      // Some sozinha (texto curto, nao move foco).
      await expect(page.getByTestId("context-arrival")).toHaveCount(0, { timeout: 8_000 });
    } finally {
      await context.close();
    }
  } finally {
    await cleanupAccounts(admin, created);
  }
});

test("preferencia interna 'reduzir movimento' tambem zera a animacao sem o sistema pedir", async ({ page }) => {
  await gotoHydrated(page, "/metas");
  await page.evaluate(() => document.documentElement.setAttribute("data-elyra-motion", "reduce"));
  const bar = page.locator(".motion-progress").first();
  test.skip((await bar.count()) === 0, "identidade sem meta");
  const style = await bar.evaluate((el) => ({ animation: getComputedStyle(el).animationDuration, transition: getComputedStyle(el).transitionDuration }));
  expect(parseFloat(style.animation)).toBeLessThan(0.001);
  expect(parseFloat(style.transition)).toBeLessThan(0.001);
});

test("meta: selo anima so na mudanca de status; progresso usa transform", async ({ page }) => {
  await gotoHydrated(page, "/metas");
  const active = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Pausar" }) }).first();
  test.skip((await active.count()) === 0, "identidade sem meta ativa");
  // Fixa o cartao pelo titulo: depois de pausar, o botao "Pausar" some.
  const title = (await active.getByRole("heading", { level: 3 }).textContent())!.trim();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { level: 3, name: title, exact: true }) }).first();
  const badge = card.locator("[data-status]");
  // Carga da pagina: sem animacao no selo.
  await expect(badge).not.toHaveClass(/motion-pop/);
  const bar = card.locator(".motion-progress");
  expect(await bar.evaluate((el) => el.getAttribute("style") ?? "")).toContain("--progress");
  expect(await bar.evaluate((el) => (el as HTMLElement).style.width)).toBe("");

  await card.getByRole("button", { name: "Pausar" }).click();
  await expect(badge).toHaveAttribute("data-status", "paused");
  await expect(badge).toHaveClass(/motion-pop/);
  await axeClean(page, "meta pausada");
  await card.getByRole("button", { name: "Retomar" }).click();
  await expect(badge).toHaveAttribute("data-status", "active");
});
