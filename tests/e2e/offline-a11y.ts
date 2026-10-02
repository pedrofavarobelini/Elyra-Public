import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * OFF-5: axe nos estados de sincronizacao (pendente, conflito, retry, erro),
 * no tema claro e no escuro, sem rolagem lateral. Volta ao claro no fim.
 */
export async function axeBothSchemes(page: Page, label: string) {
  try {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      // Trocar o tema dispara transicoes de cor; medir no meio delas da falso positivo.
      await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), `${scheme} ${label}`).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
        `${scheme} ${label}: sem rolagem lateral`,
      ).toBeLessThanOrEqual(0);
    }
  } finally {
    await page.emulateMedia({ colorScheme: "light" });
  }
}
