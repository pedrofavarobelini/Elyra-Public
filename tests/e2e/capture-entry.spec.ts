import { test, type Page } from "@playwright/test";

import { resolveEvidenceStage } from "../evidence-stage";
import { gotoHydrated } from "./hydrated";

/**
 * Portas de entrada - capturadas deslogado.
 *
 * `/entrar` e `/cadastro` sao as duas primeiras telas que qualquer pessoa ve, e
 * nunca tiveram captura canonica. Elas nao cabem em `capture.spec.ts` por um
 * motivo concreto: aquele arquivo tem um `beforeEach` que chama
 * `resetMultimodalQa`, que por sua vez faz `PATCH /api/me/preferences`. Sem
 * sessao isso responde 401 e o fixture lanca - foi exatamente assim que a
 * primeira versao destes dois testes falhou.
 *
 * Um arquivo separado e a forma honesta de dizer "estes testes rodam sob outra
 * identidade". A alternativa seria condicionar o `beforeEach` a rota, o que
 * esconderia a diferenca em vez de declara-la.
 */

const OUT = `test-results/${resolveEvidenceStage()}/screenshots`;

test.use({ storageState: { cookies: [], origins: [] } });

const ENTRY_ROUTES = [
  { path: "/entrar", slug: "entrar" },
  { path: "/cadastro", slug: "cadastro" },
] as const;

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

for (const { path, slug } of ENTRY_ROUTES) {
  test(`captura ${slug}`, async ({ page }, testInfo) => {
    await gotoHydrated(page, path);
    await shoot(page, slug, testInfo.project.name);
  });
}
