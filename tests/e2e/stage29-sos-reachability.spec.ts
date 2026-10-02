import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";


const PAGES = [
  "/dashboard", "/sessoes", "/agenda", "/pedidos", "/profissionais", "/diario",
  "/meu-humor", "/metas", "/ciclo", "/relatorios", "/perfil", "/configuracoes", "/notificacoes",
  "/conteudos-de-apoio", "/rede-de-apoio",
];

const SOS = "SOS: ajuda imediata";

/**
 * Estado do SOS. A unica ocultacao permitida e a troca de posicao (~200 ms),
 * entao o teste espera ate 3 s pelo estado visivel antes de concluir.
 */
type SosState = {
  sosButtons: number;
  topBar: number;
  visible: boolean;
  inViewport: boolean;
  focusable: boolean;
  overlap: string;
};

async function sosState(page: Page): Promise<SosState> {
  // Mede NO instante em que o SOS esta visivel (sem corrida com a troca de posicao).
  const handle = await page
    .waitForFunction(() => {
      const fab = document.querySelector<HTMLElement>("[data-elyra-sos]");
      if (!fab || fab.hasAttribute("data-sos-concealed")) return null;
      const style = getComputedStyle(fab);
      if (style.visibility === "hidden" || style.opacity !== "1") return null;
      const rect = fab.getBoundingClientRect();
      return {
        sosButtons: [...document.querySelectorAll("button")].filter((el) => /\bSOS\b/.test(el.textContent ?? "")).length,
        topBar: document.querySelectorAll("[data-elyra-sos-topbar]").length,
        visible: true,
        inViewport: rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth,
        focusable: fab.tabIndex >= 0 && fab.getAttribute("aria-hidden") !== "true",
        overlap: fab.getAttribute("data-sos-overlap") ?? "none",
      };
    }, undefined, { timeout: 3000 })
    .catch(() => null);
  if (handle) return (await handle.jsonValue()) as SosState;
  return { sosButtons: -1, topBar: -1, visible: false, inViewport: false, focusable: false, overlap: "hidden" };
}

test.describe("SOS unico - sempre alcancavel", () => {
  test("toda tela pessoal: exatamente 1 SOS, flutuante, visivel no topo, meio e fim da pagina", async ({ page }) => {
    test.setTimeout(300_000);
    const overlaps: string[] = [];
    for (const path of PAGES) {
      await gotoHydrated(page, path);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (const y of [0, Math.floor(height / 2), height]) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        const state = await sosState(page);
        expect(state.sosButtons, `${path}@${y}: botoes SOS`).toBe(1);
        expect(state.topBar, `${path}: SOS na barra superior`).toBe(0);
        expect(state.visible, `${path}@${y}: SOS oculto`).toBe(true);
        expect(state.inViewport, `${path}@${y}: SOS fora da tela`).toBe(true);
        expect(state.focusable, `${path}@${y}: SOS fora do teclado`).toBe(true);
        if (state.overlap !== "none") overlaps.push(`${path}@${y}:${state.overlap}`);
      }
    }
    // Sobreposicao e ultimo recurso (a pagina rola para revelar o que ficou

    test.info().annotations.push({ type: "sos-overlap", description: overlaps.join(" ") || "nenhuma" });
  });

  test("teclado alcanca o SOS; o painel abre sem rede nem localizacao e traz a Rede de Apoio separada", async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __geoCalls: number };
      w.__geoCalls = 0;
      const count = () => {
        w.__geoCalls += 1;
      };
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: { getCurrentPosition: count, watchPosition: count, clearWatch: () => undefined },
      });
    });
    await gotoHydrated(page, "/dashboard");
    // O SOS e o ultimo controle da pagina: Shift+Tab a partir do inicio chega nele.
    await page.locator("body").focus();
    let reached = false;
    for (let i = 0; i < 40 && !reached; i += 1) {
      await page.keyboard.press("Shift+Tab");
      reached = await page.evaluate(() => document.activeElement?.hasAttribute("data-elyra-sos") ?? false);
    }
    expect(reached, "SOS alcancavel pelo teclado").toBe(true);

    const writes: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET") writes.push(request.url());
    });
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Precisa de ajuda agora?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("link", { name: /SAMU/ })).toHaveAttribute("href", "tel:192");
    await expect(dialog.getByRole("link", { name: /^CVV Ligação/ })).toHaveAttribute("href", "tel:188");
    const network = dialog.getByRole("region", { name: "Rede de Apoio" });
    await expect(network).toContainText("Não é emergência");
    const open = network.getByRole("link", { name: "Abrir Rede de Apoio" });
    await expect(open).toHaveAttribute("href", "/rede-de-apoio");
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations.map((item) => item.id)).toEqual([]);
    expect(writes).toEqual([]);

    await open.click();
    await expect(page).toHaveURL(/\/rede-de-apoio$/);
    await expect(page.getByRole("heading", { name: "Rede de Apoio", level: 1 })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });

  test("escuro: SOS, painel e link da Rede de Apoio mantem contraste", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await gotoHydrated(page, "/dashboard");
    await page.getByRole("button", { name: SOS }).click();
    const dialog = page.getByRole("dialog", { name: "Precisa de ajuda agora?" });
    await expect(dialog.getByRole("link", { name: "Abrir Rede de Apoio" })).toBeVisible();
    const results = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(results.violations.filter((item) => item.impact === "serious" || item.impact === "critical")).toEqual([]);
    await page.keyboard.press("Escape");
    const fab = await new AxeBuilder({ page }).include("[data-elyra-sos]").withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(fab.violations.filter((item) => item.impact === "serious" || item.impact === "critical")).toEqual([]);
  });
});
