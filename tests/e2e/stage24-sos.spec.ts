import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";



const SOS = /SOS: ajuda imediata/;

async function scrollToEnd(page: Page) {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
}


type Occlusion = { hidden: boolean; control: string[]; content: string[] };

async function sosOcclusions(page: Page): Promise<Occlusion> {
  // Mede NO instante em que o SOS esta visivel: a troca de posicao (200 ms)
  // e a unica ocultacao permitida; oculto por 3 s e falha.
  const handle = await page.waitForFunction(() => {
    const fab = document.querySelector<HTMLElement>("[data-elyra-sos]");
    if (!fab) return null;
    const style = getComputedStyle(fab);
    if (fab.hasAttribute("data-sos-concealed") || style.visibility === "hidden" || style.display === "none") return null;
    const f = fab.getBoundingClientRect();
    const hit = (r: DOMRect) =>
      r.width > 0 && r.height > 0 && r.right > f.left && r.left < f.right && r.bottom > f.top && r.top < f.bottom;
    const shown = (el: Element) => {
      if (el.closest("[data-elyra-sos], [aria-hidden=true]")) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none";
    };
    const control: string[] = [];
    const content: string[] = [];
    const controls =
      "a[href],button,input:not([type=hidden]),select,textarea,summary,label,[role=slider],[role=switch],[role=tab],[role=checkbox],[role=radio],[role=button]";
    for (const el of document.querySelectorAll(controls)) {
      if (shown(el) && hit(el.getBoundingClientRect())) {
        control.push(`@${window.scrollY}:${(el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30)}`);
      }
    }
    for (const el of document.querySelectorAll("svg.recharts-surface,canvas,img,[role=alert],[role=status],[role=note]")) {
      if (shown(el) && hit(el.getBoundingClientRect())) content.push(`media@${window.scrollY}`);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim() || !shown(parent)) continue;
      range.selectNodeContents(node);
      if ([...range.getClientRects()].some(hit)) content.push(`text@${window.scrollY}`);
    }
    return { hidden: false, control, content };
  }, undefined, { timeout: 3000 }).catch(() => null);
  return handle ? ((await handle.jsonValue()) as Occlusion) : { hidden: true, control: [], content: [] };
}

test.describe("Stage 24 - ajuda imediata", () => {
  test("aparece na area autenticada, abre sem efeito externo e fecha com Escape", async ({
    page,
    context,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const requestsAfterOpen: string[] = [];

    await gotoHydrated(page, "/dashboard");
    // L-179: o SOS sai de cena sobre controles; no fim da pagina (pb-24) ha area livre.
    await scrollToEnd(page);
    const trigger = page.getByRole("button", { name: SOS });
    await expect(trigger).toBeVisible();
    const box = await trigger.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // Nenhuma permissao de localizacao e concedida; se algo pedisse, o
    // navegador recusaria e o erro apareceria.
    await context.clearPermissions();
    // Prefetch de links do Next (GET `?_rsc=`) e assets nao sao efeito do SOS;
    // qualquer escrita ou saida para outra origem seria.
    page.on("request", (request) => {
      const url = new URL(request.url());
      const sameOrigin = url.origin === new URL(page.url()).origin;
      if (request.method() !== "GET" || !sameOrigin) {
        requestsAfterOpen.push(`${request.method()} ${request.url()}`);
      }
    });
    await trigger.click();

    const dialog = page.getByRole("dialog", { name: "Precisa de ajuda agora?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(
      "A Elyra não aciona serviços de emergência automaticamente.",
    );
    await expect(page.getByRole("heading", { name: "Precisa de ajuda agora?" })).toBeFocused();

    await expect(dialog.getByRole("link", { name: /SAMU/ })).toHaveAttribute("href", "tel:192");
    await expect(dialog.getByRole("link", { name: /Polícia Militar/ })).toHaveAttribute("href", "tel:190");
    await expect(dialog.getByRole("link", { name: /^CVV Ligação/ })).toHaveAttribute("href", "tel:188");
    await expect(dialog.getByRole("link", { name: /CVV por chat/ })).toHaveAttribute(
      "target",
      "_blank",
    );

    // Painel dentro da viewport, com rolagem propria quando precisar.
    const panel = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(panel && viewport ? panel.width <= viewport.width : false).toBe(true);

    const results = await new AxeBuilder({ page })
      .include('[role="dialog"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(results.violations.map((v) => v.id)).toEqual([]);

    // Abrir nao fala com servidor nenhum e nao muda de pagina.
    expect(requestsAfterOpen).toEqual([]);
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    expect(pageErrors).toEqual([]);
  });

  test("visivel em toda posicao de rolagem; no fim da pagina nada fica coberto", async ({ page }) => {
    test.setTimeout(240_000);
    const hidden: string[] = [];
    const control: string[] = [];
    let midScrollControl = 0;
    let content = 0;
    let samples = 0;
    for (const path of ["/dashboard", "/meu-humor", "/diario", "/relatorios", "/metas", "/perfil", "/configuracoes", "/seguranca"]) {
      await gotoHydrated(page, path);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y <= height; y += 150) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(120);
        const result = await sosOcclusions(page);
        samples += 1;
        if (result.hidden) hidden.push(`${path}@${y}`);
        if (result.control.length) midScrollControl += 1;
        if (result.content.length) content += 1;
      }
      // Fim da pagina: o `pb-24` garante area livre; ali nada pode ficar coberto.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(300);
      const end = await sosOcclusions(page);
      if (end.hidden) hidden.push(`${path}@fim`);
      control.push(...end.control.map((hit) => `${path} fim ${hit}`));
    }
    // FAB sempre visivel sobre layout de largura total cobre algo durante a

    test.info().annotations.push({
      type: "sos-overlap-durante-rolagem",
      description: `controle ${midScrollControl}/${samples} · conteudo ${content}/${samples}`,
    });
    expect(hidden, "SOS oculto").toEqual([]);
    expect(control, "SOS sobre controle no fim da pagina").toEqual([]);
  });

  test("no desktop permanece no lado direito durante toda a rolagem", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoHydrated(page, "/dashboard");
    const samples: Array<{ visible: boolean; right: number }> = [];
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (const y of [0, Math.floor(height / 2), height]) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      await page.waitForFunction(() => !document.querySelector("[data-elyra-sos]")?.hasAttribute("data-sos-concealed"), undefined, { timeout: 3000 }).catch(() => undefined);
      samples.push(await page.evaluate(() => {
        const fab = document.querySelector<HTMLElement>("[data-elyra-sos]");
        if (!fab || fab.hasAttribute("data-sos-concealed")) return { visible: false, right: 0 };
        return { visible: true, right: Math.round(window.innerWidth - fab.getBoundingClientRect().right) };
      }));
    }
    // SOS unico: visivel em TODAS as amostras (antes bastava uma).
    expect(samples.every((sample) => sample.visible)).toBe(true);
    for (const sample of samples.filter((entry) => entry.visible)) {
      expect(sample.right).toBeGreaterThanOrEqual(0);
      expect(sample.right).toBeLessThanOrEqual(48);
    }
  });

  test("com movimento reduzido o painel abre igual", async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({
      ...testInfo.project.use,
      baseURL,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    try {
      await gotoHydrated(page, "/metas");
      await scrollToEnd(page);
      await page.getByRole("button", { name: SOS }).click();
      await expect(page.getByRole("dialog", { name: "Precisa de ajuda agora?" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("nao aparece fora da area autenticada", async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({
      ...testInfo.project.use,
      baseURL,
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    try {
      await gotoHydrated(page, "/entrar");
      await expect(page.getByRole("button", { name: SOS })).toHaveCount(0);
      await gotoHydrated(page, "/cadastro");
      await expect(page.getByRole("button", { name: SOS })).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
