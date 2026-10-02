import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";

/**
 * MOTION-4 — custo do movimento, medido no MESMO build: motion ligado x
 * `prefers-reduced-motion: reduce`, com e sem CPU 4x mais lenta (aparelho
 * fraco). Registra LCP, CLS, long tasks e heap em anotacao. Nenhum orcamento
 * inventado: e medicao, nao gate. O CLS de /relatorios no mobile com CPU 4x e
 * intermitente e acontece tambem com movimento reduzido (L-421, preexistente).
 *
 * So Chromium (CDP para throttling e heap). Rode com `--project=desktop` e
 * `--project=mobile`.
 */

const ROUTES = ["/dashboard", "/metas", "/relatorios", "/conteudos-de-apoio", "/pro/dashboard"] as const;

async function observe(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __perf: { lcp: number; cls: number; longTasks: number[] } };
    w.__perf = { lcp: 0, cls: 0, longTasks: [] };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__perf.lcp = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
        if (!entry.hadRecentInput) w.__perf.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__perf.longTasks.push(entry.duration);
    }).observe({ type: "longtask", buffered: true });
  });
}

async function sample(page: Page, route: string) {
  await gotoHydrated(page, route);
  // Deixa as entradas (motion-page, graficos) terminarem antes de ler.
  await page.waitForTimeout(1_500);
  return page.evaluate(() => {
    const w = window as unknown as { __perf: { lcp: number; cls: number; longTasks: number[] } };
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const tasks = w.__perf.longTasks;
    return {
      lcp: Math.round(w.__perf.lcp),
      cls: Math.round(w.__perf.cls * 1000) / 1000,
      longTasks: tasks.length,
      tbt: Math.round(tasks.reduce((sum, d) => sum + Math.max(0, d - 50), 0)),
      maxTask: Math.round(Math.max(0, ...tasks)),
      heapMb: heap === null ? null : Math.round((heap / 1048576) * 10) / 10,
    };
  });
}

for (const cpu of [1, 4] as const) {
  test(`custo do movimento por rota (CPU ${cpu}x): ligado x reduzido`, async ({ browser, baseURL, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "CDP so no Chromium");
    test.setTimeout(300_000);
    const results: Record<string, unknown> = {};
    for (const motion of ["no-preference", "reduce"] as const) {
      const context = await browser.newContext({ ...testInfo.project.use, baseURL, reducedMotion: motion });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
      await observe(page);
      for (const route of ROUTES) {
        const result = await sample(page, route);
        results[`${motion} ${route}`] = result;
        expect(result.lcp, `${motion} ${route} LCP medido`).toBeGreaterThan(0);
      }
      await context.close();
    }
    testInfo.annotations.push({ type: `perf-cpu${cpu}x`, description: JSON.stringify(results) });
  });
}
