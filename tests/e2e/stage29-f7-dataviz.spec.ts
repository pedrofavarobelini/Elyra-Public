import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { gotoHydrated } from "./hydrated";



function patientId(project: string) {
  const identities = JSON.parse(
    readFileSync(resolve(process.cwd(), "test-results", ".auth", "identity.json"), "utf8"),
  ) as Array<{ project: string; userId: string }>;
  const patient = identities.find((identity) => identity.project === `${project}-patient`);
  if (!patient) throw new Error("Paciente QA ausente.");
  return patient.userId;
}

const THEMES = [
  { theme: "light", scheme: "light", mood: "rgb(82, 86, 212)" },
  { theme: "dark", scheme: "dark", mood: "rgb(69, 100, 208)" },
  { theme: "system", scheme: "dark", mood: "rgb(69, 100, 208)" },
] as const;

async function withTheme(page: Page, theme: string) {
  await page.addInitScript((value) => {
    if (sessionStorage.getItem("__f7_theme") === value) return;
    sessionStorage.setItem("__f7_theme", value);
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("elyra.accessibility.v1")) localStorage.removeItem(key);
    }
    localStorage.setItem("elyra.accessibility.v1", JSON.stringify({ theme: value }));
  }, theme);
}

test.describe("Stage 29 / F7 - graficos por token, lacuna, unidade e tabela", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === "tablet", "Desktop e mobile cobrem os dois layouts do grafico.");
    test.setTimeout(120_000);
  });

  for (const { theme, scheme, mood } of THEMES) {
    test(`tema ${theme}: tokens, lacuna, tabela, unidades e acessibilidade`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: scheme });
      await withTheme(page, theme);
      await gotoHydrated(page, `/pro/relatorios?pessoa=${patientId(testInfo.project.name)}&periodo=90`);

      const chart = page.locator(".recharts-responsive-container").first();
      await expect(chart).toBeVisible();

      // Cores: atributo vem do token, e o valor computado segue o tema.
      const firstLine = chart.locator(".recharts-line-curve").first();
      await expect(firstLine).toHaveAttribute("stroke", /^var\(--color-chart-/);
      const humorLine = chart.locator(".recharts-line-curve[stroke='var(--color-chart-mood)']");
      if (await humorLine.count()) {
        expect(await humorLine.first().evaluate((el) => getComputedStyle(el).stroke)).toBe(mood);
      }
      const html = await chart.innerHTML();
      expect(html, "nenhum hex fixo de serie no grafico").not.toMatch(/#(5256d4|9a8cf0|5b8def|2fae7f|eceef7)/i);

      // Lacuna: hachura por pattern, nunca bloco solido.
      const gaps = chart.locator(".recharts-reference-area-rect");
      for (let i = 0; i < (await gaps.count()); i += 1) {
        const fill = await gaps.nth(i).getAttribute("fill");
        if (fill && !fill.includes("cycle-band")) expect(fill).toMatch(/^url\(#elyra-gap-/);
      }

      // Tabela alternativa: todo dia tem valor com unidade ou "Sem registro".
      await page.getByText("Ver os números").first().click();
      const table = page.getByTestId("chart-data-table").first();
      await expect(table).toBeVisible();
      const cells = await table.locator("tbody td").allInnerTexts();
      expect(cells.length).toBeGreaterThan(0);
      for (const cell of cells) {
        expect(cell, "celula da tabela").toMatch(/^(\d+,\d\/10|\d+h \d{2}m|Sem registro)$/);
      }
      expect(cells, "NULL nunca vira zero").not.toContain("0,0/10");
      await expect(table.locator("ul li").first()).toContainText(/dias com registro|nenhum registro/);

      // Unidades na variacao.
      const deltas = await page.getByText(/vs\. período anterior/).allInnerTexts();
      for (const delta of deltas) {
        expect(delta, "variacao").toMatch(/Estável|pontos?|\dh \d{2}m/);
      }

      // Layout e acessibilidade.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      if (testInfo.project.name === "desktop") {
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary ?? ""}`).join(" | ")}`)).toEqual([]);
      }
    });
  }
});
