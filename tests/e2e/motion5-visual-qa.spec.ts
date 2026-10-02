import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";

/**
 * MOTION-5 — QA das superficies alteradas pela MOTION-1/2.
 *
 * Em cada largura (1440/1366/1280 no desktop; 834 no tablet; 393 no mobile),
 * tema claro, escuro e do sistema, com e sem movimento reduzido:
 * - axe WCAG A/AA e sem rolagem lateral;
 * - nenhuma animacao infinita fora de spinner/loader de marca (sem loop
 *   agressivo, sem flashing);
 * - com movimento reduzido, a entrada da pagina (`motion-page`) nao anima;
 * - foco por teclado visivel e fora de elemento animado.
 * Capturas opcionais em `ELYRA_MOTION5_SHOTS` (fora do repositorio).
 */

const ROUTES = ["/dashboard", "/metas", "/relatorios", "/conteudos-de-apoio", "/sessoes", "/historico"] as const;

async function check(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude(".maplibregl-canvas").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${label} overflow`).toBeLessThanOrEqual(0);
  const infinite = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((el) => getComputedStyle(el).animationIterationCount === "infinite" && getComputedStyle(el).animationName !== "none")
      .filter((el) => !el.closest("[data-elyra-spinner], [data-elyra-brand-loader], .animate-spin, [aria-hidden='true']"))
      .map((el) => `${el.tagName}.${el.className.toString().slice(0, 40)}`),
  );
  expect(infinite, `${label}: animacao infinita fora de loader`).toEqual([]);
}

for (const scheme of ["light", "dark", "system"] as const) {
  for (const motion of ["no-preference", "reduce"] as const) {
    test(`superficies alteradas: tema ${scheme}, movimento ${motion}`, async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      const widths = testInfo.project.name === "desktop" ? [1440, 1366, 1280] : [page.viewportSize()!.width];
      if (scheme !== "system") await page.emulateMedia({ colorScheme: scheme, reducedMotion: motion });
      else await page.emulateMedia({ reducedMotion: motion });
      for (const width of widths) {
        if (testInfo.project.name === "desktop") await page.setViewportSize({ width, height: 900 });
        for (const route of ROUTES) {
          await gotoHydrated(page, route);
          const label = `${scheme}/${motion}/${width} ${route}`;
          if (route === "/dashboard" || route === "/conteudos-de-apoio") {
            const expected = route === "/dashboard" ? "elyra-welcome-v1" : "elyra-support-content-hero-v1";
            const artwork = page.locator(`img[src*="${expected}"]`);
            await expect(artwork, `${label}: asset Higgsfield presente`).toHaveCount(1);
            await expect(artwork).toHaveAttribute("width", "1344");
            await expect(artwork).toHaveAttribute("height", "768");
            expect(
              await artwork.evaluate((image: HTMLImageElement) => ({
                complete: image.complete,
                naturalWidth: image.naturalWidth,
                currentSrc: image.currentSrc,
              })),
              `${label}: asset otimizado carregado`,
            ).toMatchObject({ complete: true, naturalWidth: 1344 });
          }
          if (motion === "reduce") {
            const settle = await page.locator("main#conteudo > *").first().evaluate((el) => getComputedStyle(el).animationDuration);
            expect(parseFloat(settle), `${label}: entrada sem animacao`).toBeLessThan(0.001);
          }
          await check(page, label);
          const shots = process.env.ELYRA_MOTION5_SHOTS;
          if (shots && width === widths[0]) {
            await page.screenshot({ path: `${shots}/${testInfo.project.name}-${width}-${scheme}-${motion}${route.replaceAll("/", "_")}.png` });
          }
        }
      }
      // Teclado: o primeiro foco e visivel e nao esta num elemento animado.
      await gotoHydrated(page, "/metas");
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return { visible: el.getBoundingClientRect().width > 0, animated: style.animationName !== "none" && style.animationIterationCount === "infinite" };
      });
      expect(focus?.visible).toBe(true);
      expect(focus?.animated).toBe(false);
    });
  }
}
