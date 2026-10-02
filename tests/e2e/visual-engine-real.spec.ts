import { expect, test } from "@playwright/test";

import { DEFAULT_SESSION_SETUP } from "@/lib/contracts/session";
import { gotoHydrated } from "./hydrated";

/**
 * Motor visual REAL (L-395/L-396/L-397) — so roda via `npm run qa:visual-engine:real`,
 * que garante os ativos do MediaPipe com digest conferido.
 *
 * Baseline mapeado em 28/09 (container sem GPU, face+pose no mesmo tick,
 * `setInterval`): atraso maximo do event loop 9,2 s; "Finalizar sessao" em 12,8 s;
 * um `console.error` falso do XNNPACK virando overlay no dev.
 *
 * Criterios objetivos aqui (mesmo hardware):
 * - nenhum `console.error` do runtime (o log XNNPACK vira info);
 * - status visual real (nunca "ativa" antes da primeira amostra; nunca parado
 *   em "preparando" quando o motor carregou);
 * - "Finalizar sessao" responde em menos de 2,5 s e a analise e produzida;
 * - atraso tipico do event loop (p90) abaixo de 800 ms; maior bloqueio abaixo
 *   de 1,5 s; no maximo um bloqueio acima de 500 ms.
 */
test.skip(!process.env.ELYRA_VISUAL_ENGINE_REAL, "rode com npm run qa:visual-engine:real (precisa dos ativos do MediaPipe)");

test.use({
  launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["camera", "microphone"],
});

test("sessao particular com camera + sinais visuais reais: responsiva, sem falso erro, encerra", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200));
  });
  page.on("pageerror", (error) => pageErrors.push(error.message.slice(0, 200)));

  await gotoHydrated(page, "/sessoes");
  expect((await page.request.patch("/api/me/preferences", { data: { sessionsEnabled: true } })).ok()).toBe(true);
  const created = await page.request.post("/api/multimodal/sessions", {
    data: { ...DEFAULT_SESSION_SETUP, camera: true, visualAnalysis: true },
  });
  expect(created.ok()).toBe(true);
  const id = ((await created.json()) as { data: { id: string } }).data.id;

  try {
    await gotoHydrated(page, `/sessoes/nova?id=${id}`);
    await page.evaluate(() => {
      const w = window as unknown as { __lag: number[]; __long: number[] };
      w.__lag = [];
      w.__long = [];
      let last = performance.now();
      setInterval(() => {
        const t = performance.now();
        w.__lag.push(Math.round(t - last - 50));
        last = t;
      }, 50);
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) w.__long.push(Math.round(entry.duration));
      }).observe({ type: "longtask", buffered: true });
    });

    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
    await expect(page.getByTestId("capture-state-camera")).toHaveText("Captura ativa");
    const state = page.getByTestId("visual-analysis-state");
    // Motor real carregado e amostrando (ou reduzido/pausado por desempenho) — nunca parado em "preparando".
    await expect(state).toHaveAttribute("data-live", /^(active|reduced|paused_performance)$/, { timeout: 60_000 });
    await page.waitForTimeout(12_000);
    const live = await state.getAttribute("data-live");

    const stats = await page.evaluate(() => {
      const w = window as unknown as { __lag: number[]; __long: number[] };
      const sorted = [...w.__lag].sort((a, b) => a - b);
      const long = [...w.__long].sort((a, b) => a - b);
      return {
        lagMax: Math.max(0, ...sorted),
        lagP90: sorted[Math.floor(sorted.length * 0.9)] ?? 0,
        over500: sorted.filter((x) => x > 500).length,
        samples: sorted.length,
        longTasks: long.length,
        longMax: long.at(-1) ?? 0,
        longP50: long[Math.floor(long.length / 2)] ?? 0,
      };
    });

    const clickStart = Date.now();
    await page.getByRole("button", { name: "Finalizar sessão" }).first().click();
    const finalizeClickMs = Date.now() - clickStart;
    await page.getByRole("dialog").getByRole("button", { name: "Finalizar sessão" }).click();
    await expect(page.getByRole("heading", { name: "Análise da sessão", level: 1 })).toBeVisible({ timeout: 60_000 });

    testInfo.annotations.push({ type: "visual-engine-real", description: JSON.stringify({ live, finalizeClickMs, ...stats }) });
    console.log(`VISUAL_ENGINE_METRICS ${JSON.stringify({ live, finalizeClickMs, ...stats })}`);

    expect(consoleErrors.filter((text) => /XNNPACK|TensorFlow Lite/.test(text)), "log informativo do runtime nao e erro").toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(finalizeClickMs, "Finalizar responde (baseline 12,8 s)").toBeLessThan(2500);
    expect(stats.lagP90, "atraso tipico do event loop").toBeLessThan(800);
    // Baseline 9,2 s. Com o delegate CPU e um detector por tick, medido 392 ms neste container.
    expect(stats.lagMax, "maior bloqueio do main thread").toBeLessThan(1500);
    expect(stats.over500, "bloqueios acima de 500 ms").toBeLessThanOrEqual(1);
  } finally {
    await page.request.delete(`/api/multimodal/sessions/${id}`);
    // A identidade de QA e compartilhada: o modulo volta ao padrao (desligado, opt-in).
    await page.request.patch("/api/me/preferences", { data: { sessionsEnabled: false } });
  }
});
