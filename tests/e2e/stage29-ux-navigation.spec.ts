import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import { openNav } from "./nav";

/**
 * ADR-0029 (D-UX-1..3): menu pessoal em grupos (cinco desde o SUP-2/ADR-0032,
 * com "Ajuda e informação"; desde 27/09 o grupo so tem Conteudos de Apoio —
 * a Rede de Apoio entra pelo painel do SOS unico), "Sessoes" ativo tambem
 * em /agenda e /sessoes como entrada unificada (particular x com profissional).
 */

const GROUPS: Array<[string, string[]]> = [
  ["Visão geral", ["Dashboard"]],
  ["Meus registros", ["Diário", "Meu Humor", "Metas", "Ciclo", "Relatórios"]],
  ["Sessões e acompanhamento", ["Sessões", "Encontrar profissionais", "Recados ao profissional"]],
  ["Ajuda e informação", ["Rede de Apoio"]],
  ["Conta", ["Perfil", "Configurações"]],
];

async function expectNoSeriousAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
  expect(serious, `${label}: ${serious.map((item) => item.id).join(",")}`).toEqual([]);
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe("Stage 29 / UX - navegacao pessoal agrupada e Sessoes unificadas", () => {
  test("quatro grupos na ordem aprovada, sem item de vinculos", async ({ page }) => {
    await gotoHydrated(page, "/dashboard");
    const nav = await openNav(page);
    for (const [group, labels] of GROUPS) {
      const list = nav.getByRole("list", { name: group });
      await expect(list).toBeVisible();
      await expect(list.getByRole("link")).toHaveText(labels);
    }
    await expect(nav.getByRole("link", { name: /vínculos/i })).toHaveCount(0);

    // (artigos + fontes confiaveis); o MAPA de servicos entra so pelo SOS.
    const editorial = nav.getByRole("link", { name: "Rede de Apoio" });
    await expect(editorial).toHaveCount(1);
    await expect(editorial).toHaveAttribute("href", "/conteudos-de-apoio");
    await expect(nav.getByRole("link", { name: /Conteúdos de Apoio/ })).toHaveCount(0);
    await expect(nav.locator("a[href='/rede-de-apoio']")).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "Encontrar profissionais" })).toHaveAttribute("href", "/profissionais");
    await expect(nav.getByRole("link", { name: "Recados ao profissional" })).toHaveAttribute("href", "/pedidos");
  });

  test("menu Rede de Apoio abre a area EDITORIAL (artigos e fonte externa), nunca o mapa", async ({ page }) => {
    await gotoHydrated(page, "/dashboard");
    const nav = await openNav(page);
    await nav.getByRole("link", { name: "Rede de Apoio" }).click();
    await expect(page).toHaveURL(/\/conteudos-de-apoio$/);
    await expect(page.getByRole("heading", { name: "Rede de Apoio", level: 1 })).toBeVisible();
    await expect(page.getByTestId("support-external")).toBeVisible();
    await expect(page.getByTestId("support-map")).toHaveCount(0);
    await expect(page.getByTestId("support-overview")).toHaveCount(0);
  });

  test("Sessoes fica ativo em /sessoes e em /agenda", async ({ page }) => {
    for (const path of ["/sessoes", "/agenda"]) {
      await gotoHydrated(page, path);
      const nav = await openNav(page);
      await expect(nav.getByRole("link", { name: "Sessões", exact: true })).toHaveAttribute("aria-current", "page");
      await expect(nav.locator("[aria-current='page']")).toHaveCount(1);
    }
  });

  test("/sessoes mostra as duas entradas e a particular continua embutida", async ({ page }) => {
    await gotoHydrated(page, "/sessoes");
    await expect(page.getByRole("heading", { level: 1, name: "Sessões" })).toBeVisible();
    const hub = page.getByTestId("sessions-hub");
    await expect(hub.getByRole("heading", { name: "Sessão particular" })).toBeVisible();
    await expect(hub.getByRole("heading", { name: "Sessão com profissional" })).toBeVisible();
    await expect(hub.getByText("A chamada não é gravada")).toBeVisible();
    await expect(page.getByRole("region", { name: "Sessões particulares" })).toBeAttached();
    await expect(page.getByRole("heading", { name: "Sessões multimodais", level: 2, exact: true })).toBeVisible();

    const professional = page.getByTestId("sessions-hub-professional");
    const cta = professional.getByRole("link").first();
    await expect(cta).toHaveAttribute("href", /^\/(agenda|profissionais)/);
  });

  test("/agenda e a Sessao com profissional: abas e volta para Sessoes", async ({ page }) => {
    await gotoHydrated(page, "/agenda");
    await expect(page.getByRole("heading", { level: 1, name: "Sessão com profissional" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Sessões", exact: true })).toHaveAttribute("href", "/sessoes");
    const tabs = page.getByRole("tablist", { name: "Sessão com profissional" });
    await expect(tabs.getByRole("tab")).toHaveText([/^Próximas/, "Agendar", "Histórico"]);
    await tabs.getByRole("tab", { name: "Histórico" }).click();
    await expect(page.getByRole("heading", { name: "Histórico", level: 2 })).toBeVisible();
  });

  test("compacto no computador: grupos viram separadores e os nomes ficam acessiveis", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "A sidebar compacta so existe >= lg.");
    await gotoHydrated(page, "/sessoes");
    // Liga so no DOM: nao grava preferencia da conta compartilhada entre specs.
    await page.evaluate(() => document.documentElement.setAttribute("data-elyra-navigation", "compact"));
    const sidebar = page.locator("aside[data-elyra-sidebar]");
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThanOrEqual(81);
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    for (const [group, labels] of GROUPS) {
      await expect(nav.getByRole("list", { name: group })).toBeAttached();
      for (const label of labels) {
        await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
      }
    }
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    await expectNoSeriousAxe(page, "sidebar compacta");
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`axe e largura (${scheme}): /sessoes e /agenda sem violacao seria nem rolagem lateral`, async ({ page }, testInfo) => {
      const widths = testInfo.project.name === "mobile" ? [390] : testInfo.project.name === "tablet" ? [834] : [1440];
      await page.emulateMedia({ colorScheme: scheme });
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of ["/sessoes", "/agenda", "/dashboard"]) {
          await gotoHydrated(page, path);
          expect(await horizontalOverflow(page), `${path} ${width} ${scheme}`).toBeLessThanOrEqual(0);
          await expectNoSeriousAxe(page, `${path} ${width} ${scheme}`);
        }
        await openNav(page);
        await expectNoSeriousAxe(page, `menu ${width} ${scheme}`);
      }
    });
  }
});
