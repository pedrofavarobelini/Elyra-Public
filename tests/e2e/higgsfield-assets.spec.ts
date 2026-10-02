import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./hydrated";

const SURFACES = [
  { route: "/dashboard", asset: "elyra-welcome-v1" },
  { route: "/conteudos-de-apoio", asset: "elyra-support-content-hero-v1" },
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as typeof window & { __elyraCls?: number };
    state.__elyraCls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) state.__elyraCls = (state.__elyraCls ?? 0) + shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
});

test("assets Higgsfield: carregamento, a11y, responsividade, tema e reduced motion", async ({ page }) => {
  test.setTimeout(180_000);

  for (const colorScheme of ["light", "dark"] as const) {
    for (const reducedMotion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion });

      for (const { route, asset } of SURFACES) {
        await gotoHydrated(page, route);
        await page.waitForTimeout(300);

        const label = `${route} ${colorScheme}/${reducedMotion}`;
        const image = page.locator(`img[src*="${asset}"]`);
        await expect(image, `${label}: imagem unica`).toHaveCount(1);
        await expect(image).toHaveAttribute("alt", "");
        await expect(image).toHaveAttribute("width", "1344");
        await expect(image).toHaveAttribute("height", "768");

        const loaded = await image.evaluate((element: HTMLImageElement) => ({
          complete: element.complete,
          naturalWidth: element.naturalWidth,
          currentSrc: element.currentSrc,
        }));
        expect(loaded.complete, `${label}: download completo`).toBe(true);
        expect(loaded.naturalWidth, `${label}: imagem decodificada`).toBe(1344);
        expect(loaded.currentSrc, `${label}: formato moderno`).toMatch(/\.avif$|\.webp$/);

        const violations = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(violations.violations, `${label}: axe`).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
          `${label}: overflow horizontal`,
        ).toBeLessThanOrEqual(0);
        expect(
          await page.evaluate(() => (window as typeof window & { __elyraCls?: number }).__elyraCls ?? 0),
          `${label}: CLS`,
        ).toBeLessThan(0.1);
      }
    }
  }
});
