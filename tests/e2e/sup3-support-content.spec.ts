import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";



async function expectAxeClean(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

async function noOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: sem rolagem lateral`).toBeLessThanOrEqual(0);
}

test.describe("SUP-3 - Conteudos de Apoio", () => {
  test("Rede de Apoio editorial: fonte externa confiavel, CTA separado para o mapa, voltar pelo nome novo", async ({ page }) => {
    await gotoHydrated(page, "/conteudos-de-apoio");
    const external = page.getByTestId("support-external");
    await expect(external.getByRole("heading", { name: "Recursos confiáveis" })).toBeVisible();
    const site = external.getByRole("link", { name: /Acessar site \(Ministério da Saúde/ });
    await expect(site).toHaveAttribute("href", "https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/s/saude-mental");
    await expect(site).toHaveAttribute("target", "_blank");
    await expect(site).toHaveAttribute("rel", "noopener noreferrer");
    await expect(external).toContainText("Fonte: Ministério da Saúde");

    for (const [name, href] of [
      ["Instituto Vita Alere", "https://vitaalere.com.br/"],
      ["ASEc+", "https://asecbrasil.org.br/"],
    ] as const) {
      const link = external.getByRole("link", { name: new RegExp(`Acessar site \\(${name.replace("+", "\\+")}`) });
      await expect(link).toHaveAttribute("href", href);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    await expect(external).toContainText("Não são serviços de emergência");
    const map = page.getByTestId("support-map-cta");
    await expect(map).toContainText("Não é emergência");
    await expect(map.getByRole("link", { name: "Ver mapa de unidades" })).toHaveAttribute("href", "/rede-de-apoio");
    await expectAxeClean(page, "editorial com fonte externa");
    await noOverflow(page, "editorial");
    await page.getByTestId("content-list").getByRole("link").first().click();
    await expect(page.locator("main article").getByRole("link", { name: "Rede de Apoio" })).toHaveAttribute("href", "/conteudos-de-apoio");
  });

  test("landing publicada: aviso discreto, cards, filtro linkavel e busca local sem rede", async ({ page }) => {
    await gotoHydrated(page, "/conteudos-de-apoio");
    await expect(page.getByRole("heading", { name: "Rede de Apoio", level: 1 })).toBeVisible();
    await expect(page.getByTestId("content-preview-banner")).toHaveCount(0);
    await expect(page.getByTestId("content-notice")).toContainText("Não substituem atendimento profissional");
    const list = page.getByTestId("content-list");
    await expect(list.getByRole("article")).toHaveCount(7);
    await expect(list.getByText("Em revisão")).toHaveCount(0);
    await expect(list.getByText(/revisado em 28\/09\/2026/)).toHaveCount(7);
    await expect(page.getByTestId("support-content-artwork").locator("img")).toHaveCount(1);
    await expect(list.locator("img")).toHaveCount(0);

    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "fetch" || request.resourceType() === "xhr") requests.push(request.url());
    });

    const filter = page.getByTestId("content-category-filter");
    await filter.getByRole("button", { name: "Rede pública" }).click();
    await expect(page).toHaveURL(/\?categoria=rede-publica$/);
    await expect(list.getByRole("article")).toHaveCount(1);
    await expect(filter.getByRole("button", { name: "Rede pública" })).toHaveAttribute("aria-pressed", "true");
    await filter.getByRole("button", { name: "Todas" }).click();
    await expect(list.getByRole("article")).toHaveCount(7);

    await page.getByLabel("Buscar", { exact: true }).fill("REGISTRO psicologa");
    await expect(page.getByTestId("content-announcement")).toHaveText("1 conteúdo.");
    await expect(list.getByRole("article")).toContainText("Conselho Federal de Psicologia");
    await page.getByLabel("Buscar", { exact: true }).fill("zzzz");
    await expect(page.getByText("Nenhum conteúdo corresponde à busca.").first()).toBeVisible();
    expect(requests.filter((url) => url.includes("/api/")), "busca e filtro sao locais").toEqual([]);

    await page.getByLabel("Buscar", { exact: true }).fill("");
    await expectAxeClean(page, "landing");
    await noOverflow(page, "landing");
  });

  test("categoria vinda da URL ja filtra; categoria invalida e ignorada", async ({ page }) => {
    await gotoHydrated(page, "/conteudos-de-apoio?categoria=direitos-e-privacidade");
    await expect(page.getByTestId("content-list").getByRole("article")).toHaveCount(2);
    await gotoHydrated(page, "/conteudos-de-apoio?categoria=__proto__");
    await expect(page.getByTestId("content-list").getByRole("article")).toHaveCount(7);
  });

  test("leitura: fonte, revisao, link original seguro e CTA para a Rede de Apoio sem GPS", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __geo: number }).__geo = 0;
      const geo = navigator.geolocation;
      if (geo) geo.getCurrentPosition = () => void ((window as unknown as { __geo: number }).__geo += 1);
    });
    await gotoHydrated(page, "/conteudos-de-apoio");
    await page.getByRole("link", { name: "Ler conteúdo: O que é a Rede de Atenção Psicossocial (RAPS)" }).click();
    await expect(page).toHaveURL(/\/conteudos-de-apoio\/rede-de-atencao-psicossocial$/);
    await expect(page.getByRole("heading", { level: 1, name: "O que é a Rede de Atenção Psicossocial (RAPS)" })).toBeVisible();
    const source = page.getByTestId("content-source");
    await expect(source).toContainText("Ministério da Saúde");
    await expect(source).toContainText("28/09/2026 · versão 2");
    await expect(source).toContainText("Resumo e texto escritos pela Elyra");
    const original = source.getByRole("link", { name: /Ler na fonte original/ });
    await expect(original).toHaveAttribute(
      "href",
      "https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/s/saude-mental/rede-de-atencao-psicossocial-raps",
    );
    await expect(original).toHaveAttribute("target", "_blank");
    await expect(original).toHaveAttribute("rel", "noopener noreferrer");
    await expect(page.locator("main article").getByRole("link", { name: "Ver Rede de Apoio" })).toHaveAttribute("href", "/rede-de-apoio");
    expect(await page.evaluate(() => (window as unknown as { __geo: number }).__geo)).toBe(0);
    await expectAxeClean(page, "leitura");
    await noOverflow(page, "leitura");
  });

  test("CTA de SOS reusa os contatos centrais; CTA de profissionais aponta a rota existente", async ({ page }) => {
    await gotoHydrated(page, "/conteudos-de-apoio/conversar-com-o-cvv");
    const help = page.locator("#contatos-de-ajuda");
    await expect(help.getByRole("link", { name: /^CVV Ligação/ })).toHaveAttribute("href", "tel:188");
    await expect(help.getByRole("link", { name: /SAMU/ })).toHaveAttribute("href", "tel:192");
    await gotoHydrated(page, "/conteudos-de-apoio/confirmar-registro-de-psicologo");
    await expect(page.locator("main article").getByRole("link", { name: "Encontrar profissionais" })).toHaveAttribute("href", "/profissionais");
  });

  test("slug inexistente ou malicioso vira 404", async ({ page }) => {
    for (const slug of ["nao-existe-aqui", "..%2F..%2Fetc", "%3Cscript%3E"]) {
      const response = await page.goto(`/conteudos-de-apoio/${slug}`);
      expect(response?.status(), slug).toBe(404);
    }
  });

  test("tema escuro do sistema: landing e leitura sem violacao de axe", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await gotoHydrated(page, "/conteudos-de-apoio");
    await expectAxeClean(page, "landing escura");
    await gotoHydrated(page, "/conteudos-de-apoio/seus-direitos-sobre-dados-pessoais");
    await expectAxeClean(page, "leitura escura");
  });

  test("offline: shell mostra os 7 PUBLISHED e nunca conteudo em revisao", async ({ page, context }) => {
    await gotoHydrated(page, "/dashboard");
    await page.waitForFunction(
      async () => Boolean((await navigator.serviceWorker.getRegistration())?.active && navigator.serviceWorker.controller),
      null,
      { timeout: 60_000 },
    );
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const dbs = await indexedDB.databases();
            return dbs.some((db) => db.name === "elyra-offline");
          }),
        { timeout: 30_000 },
      )
      .toBe(true);
    await page.waitForTimeout(1500);
    await context.setOffline(true);
    try {
      await page.goto("/conteudos-de-apoio").catch(() => undefined);
      await expect(page).toHaveURL(/\/offline\?de=%2Fconteudos-de-apoio/);
      const main = page.locator("main");
      await expect(main.getByRole("heading", { name: "Rede de Apoio", level: 1 })).toBeVisible({ timeout: 20_000 });
      await expect(main.getByTestId("content-list").getByRole("article")).toHaveCount(7);
      await expect(main.getByTestId("content-preview-banner")).toHaveCount(0);
      await expect(main.getByText("Em revisão")).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });
});
