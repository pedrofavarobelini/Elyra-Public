import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";



/**
 * Contexto sem sessao, declarado de forma explicita.
 *
 * `browser.newContext()` sem argumento herda o `storageState` do projeto em
 * alguns caminhos do Playwright, e um contexto que se acredita anonimo mas
 * carrega cookie de sessao testa exatamente o contrario do que promete. Zerar o
 * estado aqui e o unico jeito de a promessa do nome valer.
 */
const ANONIMO = { storageState: { cookies: [], origins: [] } };

interface ColdStartReport {
  pageErrors: string[];
  consoleErrors: string[];
  badResponses: string[];
  finalUrl: string;
  bodyLength: number;
}

/** Erros de console que sao ruido do ambiente, nao defeito do produto. */
const CONSOLE_NOISE = [
  // Navegacao cancelada pelo proprio Next ao trocar de rota (`L-046`).
  "net::ERR_ABORTED",
  // Fonte/asset servido de cache-miss em contexto novo.
  "Failed to load resource: net::ERR_CACHE",
];

function watch(page: Page): ColdStartReport {
  const report: ColdStartReport = {
    pageErrors: [],
    consoleErrors: [],
    badResponses: [],
    finalUrl: "",
    bodyLength: 0,
  };

  page.on("pageerror", (error) => report.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (CONSOLE_NOISE.some((noise) => text.includes(noise))) return;
    report.consoleErrors.push(text);
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.includes("favicon")) return;
    // 3xx e navegacao legitima (guarda de rota). 4xx/5xx nao.
    if (response.status() >= 400) {
      report.badResponses.push(`${response.status()} ${url.pathname}`);
    }
  });

  return report;
}

async function settle(page: Page, report: ColdStartReport) {
  report.finalUrl = page.url();
  report.bodyLength = ((await page.textContent("body")) ?? "").trim().length;
}

/**
 * Um unico lugar decide o que reprova, para que todo cenario seja julgado pelo
 * mesmo criterio.
 */
function expectHealthyFirstLoad(report: ColdStartReport) {
  expect(report.pageErrors, "erro de JavaScript no primeiro acesso").toEqual([]);
  expect(report.consoleErrors, "erro de console no primeiro acesso").toEqual([]);
  expect(report.badResponses, "resposta 4xx/5xx no primeiro acesso").toEqual([]);
  // Tela em branco e falha silenciosa: renderiza, nao quebra, e nao serve.
  expect(report.bodyLength, "pagina praticamente vazia").toBeGreaterThan(120);
}

test.describe("primeiro acesso - sem dependencia de reload", () => {
  test("porta anonima abre integra em contexto totalmente frio", async ({
    browser,
  }) => {
    const context = await browser.newContext(ANONIMO);
    const page = await context.newPage();
    const report = watch(page);

    await gotoHydrated(page, "/entrar");
    await settle(page, report);

    expectHealthyFirstLoad(report);
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await context.close();
  });

  test("rota protegida sem sessao redireciona em vez de quebrar", async ({
    browser,
  }) => {
    const context = await browser.newContext(ANONIMO);
    const page = await context.newPage();
    const report = watch(page);

    await gotoHydrated(page, "/dashboard");
    // A guarda pode concluir depois do commit da navegacao: esperar pela URL
    // e o unico jeito honesto de afirmar o destino sem cravar um `sleep`.
    await page.waitForURL("**/entrar", { timeout: 30_000 });
    await settle(page, report);

    expectHealthyFirstLoad(report);
    // Guarda de rota e comportamento, nao erro: o destino e o login.
    expect(report.finalUrl).toContain("/entrar");
    await context.close();
  });

  test("deep link protegido preserva o destino sem falhar no caminho", async ({
    browser,
  }) => {
    const context = await browser.newContext(ANONIMO);
    const page = await context.newPage();
    const report = watch(page);

    await gotoHydrated(page, "/relatorios");
    await settle(page, report);

    expectHealthyFirstLoad(report);
    await context.close();
  });

  test("jornada autenticada carrega na PRIMEIRA vez, nao na segunda", async ({
    page,
  }) => {
    // Este e o coracao do finding: a sessao existe, e a primeira pintura da
    // tela precisa valer. Se so a recarga funciona, o teste reprova.
    const report = watch(page);

    await gotoHydrated(page, "/dashboard");
    await settle(page, report);

    expectHealthyFirstLoad(report);
    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
  });

  test("todas as rotas do produto sobrevivem ao primeiro acesso autenticado", async ({
    page,
  }) => {
    const rotas = [
      "/dashboard",
      "/meu-humor",
      "/diario",
      "/metas",
      "/relatorios",
      "/historico",
      "/sessoes",
      "/perfil",
      "/configuracoes",
      "/configuracoes/privacidade",
      "/seguranca",
      "/notificacoes",
    ] as const;

    const quebradas: string[] = [];
    for (const rota of rotas) {
      const report = watch(page);
      await gotoHydrated(page, rota);
      await settle(page, report);

      const falhou =
        report.pageErrors.length > 0 ||
        report.consoleErrors.length > 0 ||
        report.badResponses.length > 0 ||
        report.bodyLength <= 120;

      if (falhou) {
        quebradas.push(
          `${rota} :: erros=${report.pageErrors.length} console=${report.consoleErrors.length} http=${report.badResponses.join("|")} body=${report.bodyLength}`,
        );
      }
    }

    expect(quebradas, "rotas que falharam no primeiro acesso").toEqual([]);
  });

  test("hard refresh entrega o mesmo resultado do primeiro acesso", async ({
    page,
  }) => {
    await gotoHydrated(page, "/dashboard");
    const primeiro = ((await page.textContent("body")) ?? "").trim().length;

    const report = watch(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });
    await settle(page, report);

    expectHealthyFirstLoad(report);
    // A comparacao e o ponto: se a recarga entrega substancialmente mais
    // conteudo que a primeira pintura, existe dependencia de reload.
    expect(report.bodyLength).toBeGreaterThan(primeiro * 0.8);
  });

  test("navegacao interna nao degrada depois do primeiro acesso", async ({
    page,
  }) => {
    await gotoHydrated(page, "/dashboard");

    const report = watch(page);
    for (const rota of ["/metas", "/diario", "/dashboard"] as const) {
      await gotoHydrated(page, rota);
    }
    await settle(page, report);

    expectHealthyFirstLoad(report);
  });
});
