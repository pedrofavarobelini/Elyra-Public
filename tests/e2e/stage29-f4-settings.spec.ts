import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import { cleanupAccounts, createProfessionalAccount, qaAdmin, signIn } from "./professional-fixtures";



async function hubTitles(page: Page, groupId: string) {
  return page.locator(`#${groupId} a`).evaluateAll((links) =>
    links.map((link) => link.querySelector("span span")?.textContent?.trim() ?? ""),
  );
}

test.describe("Stage 29 / F4 - configuracoes por contexto", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Contrato de rotas independe do viewport; visual no design pass.");
    test.setTimeout(180_000);
  });

  test("mesmas secoes globais nos dois hubs; extras por contexto; shell profissional preservado", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Pro Config F4 QA");
      created.push(pro.userId);
      const pending = await createProfessionalAccount(admin, testInfo.project.name, "Pendente Config F4 QA", "pending");
      created.push(pending.userId);
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      try {
        await signIn(page, baseURL!, pro);

        await gotoHydrated(page, "/configuracoes");
        await expect(page.getByTestId("settings-hub")).toHaveAttribute("data-settings-context", "personal");
        const personalAccount = await hubTitles(page, "cfg-conta");
        const personalData = await hubTitles(page, "cfg-direitos");
        await expect(page.locator("#cfg-area-profissional").getByRole("link")).toHaveAttribute("href", "/area-profissional");
        await expect(page.locator("#cfg-profissional")).toHaveCount(0);
        for (const extra of ["Compartilhamento com profissional", "Sessão com profissional", "Encontrar profissional", "Aprendizado da Elyra"]) {
          await expect(page.getByRole("link", { name: new RegExp(extra) })).toBeVisible();
        }

        await gotoHydrated(page, "/pro/configuracoes");
        await expect(page.getByTestId("settings-hub")).toHaveAttribute("data-settings-context", "professional");
        expect(await hubTitles(page, "cfg-conta")).toEqual(personalAccount);
        expect(await hubTitles(page, "cfg-direitos")).toEqual(personalData);
        for (const extra of ["Perfil profissional", "Registro e verificação", "Perfil público", "Disponibilidade", "Preferências profissionais"]) {
          await expect(page.locator("#cfg-profissional").getByRole("link", { name: new RegExp(extra) })).toBeVisible();
        }
        // Extras pessoais nao aparecem no hub profissional.
        await expect(page.getByRole("link", { name: /Acompanhamento do ciclo|Encontrar profissional|Aprendizado da Elyra/ })).toHaveCount(0);
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

        // Paginas globais abertas pelo hub profissional ficam no shell profissional.
        for (const [link, path, heading] of [
          ["Segurança", "/pro/configuracoes/seguranca", "Segurança"],
          ["Notificações", "/pro/configuracoes/notificacoes", "Notificações"],
          ["Exportar meus dados", "/pro/configuracoes/dados", "Seus dados"],
        ] as const) {
          await gotoHydrated(page, "/pro/configuracoes");
          await page.locator("#cfg-conta, #cfg-direitos").getByRole("link", { name: new RegExp(`^${link}`) }).first().click();
          await expect(page).toHaveURL(new RegExp(`${path}$`));
          await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
          await expect(page.locator("[data-elyra-sidebar]").getByRole("link", { name: "Acompanhamentos" })).toBeVisible();
        }
        await gotoHydrated(page, "/pro/configuracoes/dados");
        await expect(page.getByRole("link", { name: "← Voltar para o hub de ajustes" })).toHaveAttribute("href", "/pro/configuracoes");
        await gotoHydrated(page, "/pro/configuracoes/personalizacao");
        await expect(page.getByRole("link", { name: "← Voltar para o hub de ajustes" })).toHaveAttribute("href", "/pro/configuracoes");

        // Rota legada continua valida (sem 404 em deep link antigo).
        const legacy = await page.goto(`${baseURL}/configuracoes`);
        expect(legacy?.status()).toBe(200);
      } finally {
        await context.close();
      }

      // Nao verificado: o hub profissional e portal, fecha como o resto.
      const pendingContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const pendingPage = await pendingContext.newPage();
      try {
        await signIn(pendingPage, baseURL!, pending);
        for (const path of ["/pro/configuracoes", "/pro/configuracoes/seguranca", "/pro/configuracoes/dados"]) {
          await pendingPage.goto(`${baseURL}${path}`);
          await expect(pendingPage, path).toHaveURL(/\/area-profissional$/);
        }
      } finally {
        await pendingContext.close();
      }
    } finally {
      await cleanupAccounts(admin, created);
    }
  });
});
