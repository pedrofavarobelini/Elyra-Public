import { expect, test, type Page } from "@playwright/test";
import { resolveEvidenceStage } from "../evidence-stage";
import { gotoHydrated } from "./hydrated";
import { createAnalyzedSession, removeSession } from "./real-session";
import {
  installDeterministicMedia,
  resetMultimodalQa,
} from "./multimodal-mocks";



const OUT = `test-results/${resolveEvidenceStage()}/screenshots`;

test.beforeEach(async ({ page }) => {
  await resetMultimodalQa(page);
});


async function shoot(page: Page, slug: string, project: string) {
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({
    path: `${OUT}/${slug}-${project}.png`,
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
}

/**
 * Navega e devolve o controle com a pagina interativa.
 *
 * `domcontentloaded` foi tentado para contornar `net::ERR_ABORTED` sob alta
 * concorrencia e criou um problema pior: o teste clicava antes da hidratacao do
 * React, o handler ainda nao existia e o estado nao mudava. Fixar `workers`
 * aliviou a saturacao mas nao resolveu a causa - a janela pre-hidratacao
 * continuava aberta, so mais estreita. `gotoHydrated` fecha a janela.
 */
async function open(page: Page, path: string) {
  await gotoHydrated(page, path);
}

/** Rotas simples: navegar e capturar. */
const SIMPLE = [
  { path: "/dashboard", slug: "fig1-dashboard" },
  { path: "/ciclo", slug: "fig2-ciclo-onboarding" },
  { path: "/relatorios", slug: "fig4-relatorios" },
  { path: "/meu-humor", slug: "meu-humor" },
  { path: "/historico", slug: "historico" },
  { path: "/diario", slug: "diario" },
  { path: "/metas", slug: "metas" },
  { path: "/perfil", slug: "perfil" },
  { path: "/configuracoes", slug: "configuracoes" },
  { path: "/design-system", slug: "design-system" },
] as const;

for (const { path, slug } of SIMPLE) {
  test(`captura ${slug}`, async ({ page }, testInfo) => {
    await open(page, path);
    if (path === "/dashboard" || path === "/relatorios") {
      await page.locator(".recharts-surface").first().waitFor({ state: "visible" });
    }
    await shoot(page, slug, testInfo.project.name);
  });
}

/**
 * Figura 7 passa a ser capturada de uma sessao **real**.
 *
 * O id semeado `123` renderizava metricas e transcricao inventadas; a evidencia
 * visual retratava um produto que nao existia. Ver `GAP-03` / `L-054`.
 */
test("captura fig7-resultado-sessao", async ({ page }, testInfo) => {
  const sessionId = await createAnalyzedSession(page);
  try {
    await open(page, `/sessoes/${sessionId}`);
    await expect(
      page.getByRole("heading", { name: "Análise da sessão", level: 1 }),
    ).toBeVisible();
    await shoot(page, "fig7-resultado-sessao", testInfo.project.name);
  } finally {
    await removeSession(page, sessionId);
  }
});

test("captura fig8-area-profissional", async ({ page }, testInfo) => {
  await open(page, "/pro/acompanhamentos");
  await page.getByRole("link", { name: /Abrir dossiê/i }).first().click();
  await expect(page).toHaveURL(/\/pro\/acompanhamentos\/[^/]+$/);
  await expect(
    page.getByRole("heading", { name: "Ana Paula QA", level: 1 }),
  ).toBeVisible();
  await shoot(page, "fig8-area-profissional", testInfo.project.name);
});

test("captura fig3-ciclo-ativado", async ({ page }, testInfo) => {
  try {
    await open(page, "/configuracoes");
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
    await page.locator(".recharts-surface").first().waitFor({ state: "visible" });
    await shoot(page, "fig3-ciclo-ativado", testInfo.project.name);
  } finally {
    await page.request.patch("/api/cycle/profile", {
      data: { enabled: false },
    });
  }
});

test("captura fig5-sessoes-preflight", async ({ page }, testInfo) => {
  await installDeterministicMedia(page);
  await open(page, "/configuracoes");
  await page.getByRole("switch", { name: "Sessões multimodais (Beta)" }).click();
  await page.getByRole("link", { name: "Preparar uma sessão" }).click();

  // A figura 5 mostra o preflight com recursos ja autorizados. Aqui isso e
  // resultado de escolha explicita, nunca de padrao ligado.
  for (const name of ["Gravar/compartilhar tela", "Usar câmera", "Usar microfone", "Gerar transcrição"]) {
    await page.getByRole("switch", { name }).click();
  }
  await shoot(page, "fig5-sessoes-preflight", testInfo.project.name);
});

test("captura fig6-sessao-em-andamento", async ({ page }, testInfo) => {
  // Com o relogio da pagina congelado, esperas internas do navegador ficam mais
  // lentas sob concorrencia. `test.slow()` amplia o limite deste teste; nao
  // reexecuta nem mascara falha - so reconhece que ele custa mais.
  test.slow();
  await installDeterministicMedia(page);

  // Relogio controlado: um cronometro correndo tornaria o screenshot
  // nao-deterministico e o QA visual intermitente.
  await page.clock.install({ time: new Date("2026-01-01T09:00:00Z") });

  await open(page, "/configuracoes");
  await page.getByRole("switch", { name: "Sessões multimodais (Beta)" }).click();
  await page.getByRole("link", { name: "Preparar uma sessão" }).click();
  for (const name of ["Gravar/compartilhar tela", "Usar câmera", "Usar microfone"]) {
    await page.getByRole("switch", { name }).click();
  }

  await page.getByRole("button", { name: "Iniciar sessão" }).click();
  await expect(
    page.getByRole("heading", { name: "Nova sessão multimodal", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();

  // A captura muda de estado somente depois de a API confirmar a transicao.
  // O relogio continua normal ate aqui para nao bloquear fetch/media/React.
  await expect(page.getByText("REC", { exact: true })).toBeVisible();
  await expect(page.getByTestId("session-timer")).toHaveText("00:00:00");

  // Avancar um segundo ao pausar prova que o intervalo da captura ja esta
  // registrado; os 221 segundos seguintes completam os 3:42 deterministas.
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 1_000));
  await expect(page.getByTestId("session-timer")).toHaveText("00:00:01");
  await page.clock.runFor(221_000);
  await expect(page.getByTestId("session-timer")).toHaveText("00:03:42");

  await shoot(page, "fig6-sessao-em-andamento", testInfo.project.name);
});

test("captura sessoes-gate", async ({ page }, testInfo) => {
  await open(page, "/sessoes");
  await shoot(page, "sessoes-gate", testInfo.project.name);
});

/**
 * Rotas profissionais fora da figura 8.
 *
 * A figura oficial cobre o dossie de um paciente. O restante da area
 * profissional - painel, relatorios, sessoes e perfil - nunca teve captura
 * canonica, o que deixava um quarto da superficie da V1 fora do mapeamento
 * visual. A identidade QA de `global-setup` ja tem `professional_profile`, entao
 * estas rotas usam a mesma sessao das demais.
 */
const PRO_ROUTES = [

  { path: "/pro/dashboard", slug: "pro-dashboard" },
  { path: "/pro/acompanhamentos", slug: "pro-acompanhamentos" },
  { path: "/pro/relatorios", slug: "pro-relatorios" },
  { path: "/pro/solicitacoes", slug: "pro-solicitacoes" },
  { path: "/pro/vinculos", slug: "pro-vinculos" },
  { path: "/pro/perfil", slug: "pro-perfil" },
] as const;

for (const { path, slug } of PRO_ROUTES) {
  test(`captura ${slug}`, async ({ page }, testInfo) => {
    await open(page, path);
    await shoot(page, slug, testInfo.project.name);
  });
}
