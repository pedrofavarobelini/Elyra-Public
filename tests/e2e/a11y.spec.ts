import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { createAnalyzedSession, removeSession } from "./real-session";



const TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

const ROUTES = [
  "/dashboard",
  "/meu-humor",
  "/historico",
  "/diario",
  "/metas",
  "/perfil",
  "/configuracoes",
  "/configuracoes/privacidade",
  "/configuracoes/dados",
  "/configuracoes/personalizacao",
  "/seguranca",
  "/notificacoes",
  "/convite",
  "/ciclo",
  "/relatorios",
  "/sessoes",
  "/sessoes/nova",

  "/pro/dashboard",
  "/pro/acompanhamentos",
  "/pro/relatorios",
  "/pro/solicitacoes",
  "/pro/vinculos",
  "/pro/perfil",

  "/pro/pedidos",
  "/pedidos",
] as const;

const PUBLIC_ROUTES = ["/entrar", "/cadastro"] as const;

async function scan(page: Page) {
  return new AxeBuilder({ page }).withTags([...TAGS]).analyze();
}


async function expectNoHorizontalOverflow(page: Page) {
  const viewport = await page.evaluate(() => {
    const clientWidth = document.documentElement.clientWidth;

    /** Quem realmente corta este elemento, considerando o bloco contentor. */
    function clipper(element: HTMLElement): string | null {
      const absolute = getComputedStyle(element).position === "absolute";
      let node = element.parentElement;
      while (node && node !== document.documentElement) {
        const style = getComputedStyle(node);
        // Ancestral estatico nao e bloco contentor de um absoluto: nao corta.
        const contem = !absolute || style.position !== "static";
        if (contem && style.overflowX !== "visible") {
          return `${node.tagName.toLowerCase()}.${node.className
            .toString()
            .slice(0, 60)}`;
        }
        node = node.parentElement;
      }
      return null;
    }

    const fora = [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          className: element.className.toString().slice(0, 160),
          text: (element.getAttribute("aria-label") ?? element.innerText ?? "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80),
          position: getComputedStyle(element).position,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          cortadoPor: clipper(element),
        };
      })
      .filter((item) => item.left < -1 || item.right > clientWidth + 1)
      .sort((a, b) => b.right - a.right);

    return {
      clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      culpados: fora.filter((i) => i.cortadoPor === null).slice(0, 8),
      dentroDeScroll: fora.filter((i) => i.cortadoPor !== null).slice(0, 4),
    };
  });
  expect(
    viewport.scrollWidth,
    `overflow horizontal: scrollWidth=${viewport.scrollWidth}, ` +
      `clientWidth=${viewport.clientWidth}
nao cortados (causa provavel)=` +
      JSON.stringify(viewport.culpados) +
      `
dentro de container rolavel (contexto)=` +
      JSON.stringify(viewport.dentroDeScroll),
  ).toBeLessThanOrEqual(viewport.clientWidth + 1);
}

test("axe: dossie profissional real sem violacao WCAG A/AA", async ({ page }) => {
  await gotoHydrated(page, "/pro/acompanhamentos");
  await page.getByRole("link", { name: /Abrir dossiê/i }).first().click();


  await expect(page.getByRole("heading", { level: 1, name: "Ana Paula QA" })).toBeVisible();
  await expect(page).toHaveTitle(/Elyra/);
  await expectNoHorizontalOverflow(page);

  const results = await scan(page);
  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}) em ${v.nodes.length} no(s): ${v.help}`,
  );
  expect(summary, summary.join("\n")).toEqual([]);
});

for (const route of ROUTES) {
  test(`axe: ${route} sem violacao WCAG A/AA`, async ({ page }) => {
    await gotoHydrated(page, route);
    await page.waitForLoadState("load");
    await expectNoHorizontalOverflow(page);

    const results = await scan(page);

    // A mensagem precisa dizer o que quebrou: um `toEqual([])` seco obrigaria a
    // abrir o trace so para descobrir a regra violada.
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}) em ${v.nodes.length} no(s): ${v.help}`,
    );
    expect(summary, summary.join("\n")).toEqual([]);
  });
}


test("axe: resultado de sessao real sem violacao WCAG A/AA", async ({ page }) => {
  const sessionId = await createAnalyzedSession(page);
  try {
    await gotoHydrated(page, `/sessoes/${sessionId}`);
    await page.waitForLoadState("load");
    await expect(
      page.getByRole("heading", { name: "Análise da sessão", level: 1 }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const results = await scan(page);
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}) em ${v.nodes.length} no(s): ${v.help}`,
    );
    expect(summary, summary.join("\n")).toEqual([]);
  } finally {
    await removeSession(page, sessionId);
  }
});

test.describe("axe: portas de entrada anonimas", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const route of PUBLIC_ROUTES) {
    test(`${route} sem violacao WCAG A/AA`, async ({ page }) => {
      await gotoHydrated(page, route);
      await page.waitForLoadState("load");
      await expectNoHorizontalOverflow(page);

      const results = await scan(page);
      const summary = results.violations.map(
        (v) => `${v.id} (${v.impact}) em ${v.nodes.length} no(s): ${v.help}`,
      );
      expect(summary, summary.join("\n")).toEqual([]);
    });
  }
});

test("axe: o ciclo ativado tambem passa na varredura", async ({ page }) => {
  try {
    await gotoHydrated(page, "/configuracoes");
    const cycleSwitch = page.getByRole("switch", {
      name: "Acompanhamento do ciclo",
    });
    if ((await cycleSwitch.getAttribute("aria-checked")) === "false") {
      await cycleSwitch.click();
    }
    await page.getByRole("link", { name: "Abrir o ciclo" }).click();
    await expect(
      page.getByRole("heading", { name: "Ciclo", level: 1 }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const results = await scan(page);
    const summary = results.violations.map(
      (v) => `${v.id} (${v.impact}) em ${v.nodes.length} no(s): ${v.help}`,
    );
    expect(summary, summary.join("\n")).toEqual([]);
  } finally {
    await page.request.patch("/api/cycle/profile", {
      data: { enabled: false },
    });
  }
});
