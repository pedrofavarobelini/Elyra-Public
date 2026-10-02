import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";

const TARGET_ROUTES = [
  "/dashboard",
  "/sessoes",
  "/metas",
  "/relatorios",
  "/configuracoes",
  "/notificacoes",
  "/seguranca",
  "/perfil",
] as const;
const VIEWPORTS = [360, 390, 412, 834, 1024, 1280, 1440, 1920] as const;

async function layoutEvidence(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector("main#conteudo");
    const rect = main?.getBoundingClientRect();
    return {
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainWidth: Math.round(rect?.width ?? 0),
      mainLeft: Math.round(rect?.left ?? 0),
      mainRight: Math.round(rect?.right ?? 0),
    };
  });
}

test.describe.configure({ mode: "serial" });

test("composicao das telas alvo usa a largura e nao cria overflow nos oito viewports", async ({ page }) => {
  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: width < 600 ? 800 : 1000 });
    for (const route of TARGET_ROUTES) {
      await gotoHydrated(page, route);
      const evidence = await layoutEvidence(page);
      expect(evidence.scrollWidth, `${route} em ${width}px: ${JSON.stringify(evidence)}`).toBeLessThanOrEqual(
        evidence.viewport + 1,
      );
      expect(evidence.mainWidth, `${route} em ${width}px: main colapsou`).toBeGreaterThan(
        width >= 1024 ? Math.min(700, width * 0.55) : width * 0.82,
      );
      if (width >= 1280) {
        expect(evidence.mainRight, `${route} em ${width}px: faixa morta a direita`).toBeGreaterThan(
          width - 72,
        );
      }
    }
  }
});

test("texto muito maior, contraste e movimento persistem sem cortar a pagina", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await gotoHydrated(page, "/configuracoes/personalizacao");

  await page.getByRole("button", { name: "Muito maior" }).click();
  await page.getByRole("button", { name: "Contraste reforçado" }).click();
  await page.getByRole("button", { name: "Reduzir sempre" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-elyra-text-size", "xlarge");
  await expect(page.locator("html")).toHaveAttribute("data-elyra-contrast", "reinforced");
  await expect(page.locator("html")).toHaveAttribute("data-elyra-motion", "reduce");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Personalização", level: 1 })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-elyra-text-size", "xlarge");
  const evidence = await layoutEvidence(page);
  expect(evidence.scrollWidth).toBeLessThanOrEqual(evidence.viewport + 1);

  await page.getByRole("button", { name: "Restaurar padrão" }).click();
});

test("preferencias sao operaveis por teclado e o foco continua visivel", async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1112 });
  await gotoHydrated(page, "/configuracoes/personalizacao");
  const larger = page.getByRole("button", { name: "Maior", exact: true });
  await larger.focus();
  await expect(larger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(larger).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Muito maior" })).toBeFocused();
});

test("configuracoes e notificacoes nao deixam o vazio central herdado", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await gotoHydrated(page, "/configuracoes");
  /*
   * Gate final: o hub virou duas colunas de pilha e `#cfg-sobre` mudou de
   * coluna. Medir `sobre.top - acompanhamento.bottom` passaria a dar numero
   * negativo e aprovar qualquer coisa. O vazio que importa e entre cards
   * vizinhos da MESMA coluna.
   */
  const settingsGap = await page.evaluate(() => {
    let worst = 0;
    for (const column of document.querySelectorAll<HTMLElement>("[data-testid='settings-column']")) {
      const cards = [...column.children].map((child) => child.getBoundingClientRect());
      for (let i = 1; i < cards.length; i++) {
        worst = Math.max(worst, Math.round(cards[i]!.top - cards[i - 1]!.bottom));
      }
    }
    return worst;
  });
  expect(settingsGap).toBeLessThanOrEqual(32);

  /*
   * PREVIEW_FIX_01 mudou a estrutura desta tela, e com ela o que significa
   * "vazio". A medida antiga — distancia vertical entre a central empilhada e a
   * grade de apoio — vira um numero negativo assim que as duas passam a conviver
   * lado a lado, e negativo passa em `<= 32` sem provar nada.
   *
   * O que ainda importa e o defeito original: nenhuma faixa morta de largura
   * inteira. Isso vale quando as duas colunas comecam no topo do layout e a mais
   * alta encosta no fim dele — ai nao existe altura da pagina sem conteudo dos
   * dois lados. Esta assercao reprovaria o layout anterior, em que a grade de
   * apoio comecava bem abaixo do topo.
   */
  await gotoHydrated(page, "/notificacoes");
  const notifications = await page.evaluate(() => {
    const layout = document.querySelector<HTMLElement>('[data-testid="notifications-layout"]');
    const main = document.querySelector<HTMLElement>('[data-testid="notifications-main"]');
    const support = document.querySelector<HTMLElement>('[data-testid="notifications-support-grid"]');
    if (!layout || !main || !support) return null;
    const l = layout.getBoundingClientRect();
    const m = main.getBoundingClientRect();
    const s = support.getBoundingClientRect();
    return {
      sideBySide: s.left >= m.right - 1,
      topSlackMain: Math.round(m.top - l.top),
      topSlackSupport: Math.round(s.top - l.top),
      bottomSlack: Math.round(l.bottom - Math.max(m.bottom, s.bottom)),
    };
  });
  expect(notifications, "estrutura de /notificacoes nao encontrada").not.toBeNull();
  expect(notifications!.sideBySide, `1440px: ${JSON.stringify(notifications)}`).toBe(true);
  expect(notifications!.topSlackMain, `1440px: ${JSON.stringify(notifications)}`).toBeLessThanOrEqual(2);
  expect(notifications!.topSlackSupport, `1440px: ${JSON.stringify(notifications)}`).toBeLessThanOrEqual(2);
  expect(notifications!.bottomSlack, `1440px: ${JSON.stringify(notifications)}`).toBeLessThanOrEqual(2);
});
