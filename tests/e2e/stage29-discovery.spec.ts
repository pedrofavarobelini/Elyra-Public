import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { brokenGuardedWords, measureDeadSpace } from "./dead-space";
import { gotoHydrated } from "./hydrated";
import {
  cleanupAccounts,
  createPersonalAccount,
  createProfessionalAccount,
  qaAdmin,
  signIn,
  type Admin,
  type FixtureVerification,
  type QaAccount,
} from "./professional-fixtures";



interface Published {
  account: QaAccount;
  slug: string;
  name: string;
}

async function publish(
  admin: Admin,
  project: string,
  name: string,
  verification: FixtureVerification,
  overrides: Record<string, unknown> = {},
): Promise<Published> {
  const account = await createProfessionalAccount(admin, project, name, verification);
  const { data, error } = await admin
    .from("professional_public_profiles")
    .insert({
      user_id: account.userId,
      listed: true,
      display_name: name,
      bio: `Apresentação de ${name}.`,
      city: "São Paulo",
      state: "SP",
      modalities: ["online"],
      areas: ["luto"],
      languages: ["pt"],
      ...overrides,
    })
    .select("slug")
    .single();
  if (error) throw error;
  return { account, slug: data.slug, name };
}

const tag = () => `Qa${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
const results = (page: Page) => page.getByTestId("directory-results").getByTestId("directory-card");

test.describe("Stage 29 / PRO-5 - descoberta", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Regras de descoberta independem do viewport; o visual roda nos tres projetos.");
    test.setTimeout(180_000);
  });

  test("so verificado + opt-in aparece; ordem alfabetica; filtros; nada privado na pagina", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    const run = tag();
    const project = testInfo.project.name;
    try {
      const ana = await publish(admin, project, `Ana ${run}`, "verified", { state: "PE", city: "Recife", areas: ["luto"], languages: ["pt"] });
      const bia = await publish(admin, project, `Bia ${run}`, "verified", { modalities: ["in_person", "online"], areas: ["estresse"], languages: ["pt", "es"] });
      const hidden = [
        await publish(admin, project, `Opt ${run}`, "verified", { listed: false }),
        await publish(admin, project, `Pen ${run}`, "pending"),
        await publish(admin, project, `Rec ${run}`, "rejected"),
        await publish(admin, project, `Sus ${run}`, "suspended"),
        await publish(admin, project, `Exp ${run}`, "expired"),
      ];
      created.push(ana.account.userId, bia.account.userId, ...hidden.map((item) => item.account.userId));
      const reader = await createPersonalAccount(admin, project, "Leitora Descoberta QA");
      created.push(reader.userId);

      // Sem sessao, a descoberta nao abre (autenticada, nao anonima).
      const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const anonPage = await anon.newPage();
      await anonPage.goto(`${baseURL}/profissionais`);
      await expect(anonPage).toHaveURL(/\/entrar$/);
      await anon.close();

      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      await signIn(page, baseURL!, reader);

      await gotoHydrated(page, `/profissionais?q=${run}`);
      await expect(page.getByRole("heading", { name: "Encontrar profissional", level: 1 })).toBeVisible();
      await expect(page.getByTestId("directory-order")).toContainText("Ordem alfabética");
      await expect(results(page)).toHaveCount(2);
      await expect(results(page).nth(0)).toContainText(ana.name);
      await expect(results(page).nth(1)).toContainText(bia.name);
      await expect(results(page).nth(0)).toContainText("CRP 06/");
      await expect(results(page).nth(0)).toContainText("conferido em");
      await expect(results(page).nth(0)).toContainText("Áreas declaradas");

      // Nada privado nem de ranking no HTML entregue.
      const html = await page.content();
      for (const item of [ana, bia, ...hidden]) {
        expect(html).not.toContain(item.account.email);
        expect(html).not.toContain(item.account.userId);
      }
      for (const item of hidden) expect(html).not.toContain(item.name);
      expect(html).not.toMatch(/recomendad|melhor avaliad|estrela|ranking|nota média/i);

      for (const [query, expected] of [
        [`q=${run}&uf=PE`, [ana.name]],
        [`q=${run}&cidade=recife`, [ana.name]],
        [`q=${run}&modalidade=in_person`, [bia.name]],
        [`q=${run}&area=estresse`, [bia.name]],
        [`q=${run}&idioma=es`, [bia.name]],
        [`q=${run}&uf=XX&modalidade=telepatia&pagina=999`, [ana.name, bia.name]],
      ] as const) {
        await gotoHydrated(page, `/profissionais?${query}`);
        await expect(results(page), query).toHaveCount(expected.length);
        for (const [index, name] of expected.entries()) await expect(results(page).nth(index), query).toContainText(name);
      }

      await gotoHydrated(page, `/profissionais?q=${run}-nada`);
      await expect(page.getByText("Nenhum perfil com esses filtros")).toBeVisible();
      await page.getByRole("link", { name: "Limpar filtros" }).first().click();
      await expect(page).toHaveURL(/\/profissionais$/);

      // Perfil: elegivel abre; qualquer outro (sem opt-in, suspenso, UUID, adulterado) = 404 igual.
      await gotoHydrated(page, `/profissionais?q=${run}`);
      await results(page).nth(0).getByRole("link", { name: /Ver perfil/ }).click();
      await expect(page).toHaveURL(new RegExp(`/profissionais/${ana.slug}$`));
      await expect(page.getByRole("heading", { name: ana.name, level: 1 })).toBeVisible();
      await expect(page.getByText(`Apresentação de ${ana.name}.`)).toBeVisible();
      // F6: bloco factual com a frase obrigatoria; nada de nota, ranking ou documento.
      const trust = page.getByTestId("trust-facts");
      await expect(trust.getByRole("heading", { name: "O que a Elyra verificou" })).toBeVisible();
      await expect(trust.getByTestId("verification-disclaimer")).toHaveText(
        "A verificação confirma as informações apresentadas e não representa avaliação da qualidade profissional.",
      );
      await expect(page.getByText(/estrela|avaliação \d|ranking|recomendad|top \d|CPF|RG\b/i)).toHaveCount(0);
      for (const slug of [...hidden.map((item) => item.slug), ana.account.userId, "..%2F..%2Fapi", "ZZZZZZZZZZZZZZZZ"]) {
        const response = await page.goto(`${baseURL}/profissionais/${slug}`);
        expect(response?.status(), slug).toBe(404);
        expect(await page.content(), slug).not.toContain(run);
      }
      await context.close();
    } finally {
      await cleanupAccounts(admin, created);
    }
  });

  test("opt-in e opt-out pelo Perfil profissional valem na proxima consulta; preview explica", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    const run = tag();
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, `Pro ${run}`);
      const pending = await createProfessionalAccount(admin, testInfo.project.name, `Pendente ${run}`, "pending");
      const reader = await createPersonalAccount(admin, testInfo.project.name, "Leitor OptIn QA");
      created.push(pro.userId, pending.userId, reader.userId);

      const proContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const proPage = await proContext.newPage();
      await signIn(proPage, baseURL!, pro, "?context=professional");
      await gotoHydrated(proPage, "/pro/perfil");
      const section = proPage.getByTestId("public-profile");
      await expect(section.getByRole("heading", { name: "Perfil público", level: 2 })).toBeVisible();
      await expect(proPage.getByRole("heading", { name: "Registro e verificação", level: 2 })).toBeVisible();
      await expect(section.getByLabel("Exibir meu perfil na descoberta")).not.toBeChecked();
      await expect(proPage.getByTestId("discovery-visibility")).toHaveAttribute("data-visible", "false");

      await section.getByLabel("Nome de exibição").fill(`Pro ${run}`);
      await section.getByLabel("Cidade").fill("Curitiba");
      await section.getByLabel("UF").selectOption("PR");
      await section.locator("[data-option='modalidade:online']").click();
      await section.locator("[data-option='area:autoestima']").click();
      await section.getByLabel("Apresentação").fill("Atendimento online, com foco em rotina.");
      await section.getByLabel("Exibir meu perfil na descoberta").check();
      await expect(proPage.getByTestId("discovery-visibility")).toHaveAttribute("data-visible", "true");
      await expect(section.getByTestId("directory-card")).toContainText(`Pro ${run}`);
      await section.getByRole("button", { name: "Salvar perfil público" }).click();
      await expect(section.getByRole("status")).toContainText("Perfil público salvo");

      const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const readerPage = await readerContext.newPage();
      await signIn(readerPage, baseURL!, reader);
      await gotoHydrated(readerPage, `/profissionais?q=${run}`);
      await expect(results(readerPage)).toHaveCount(1);
      await expect(results(readerPage).first()).toContainText("Curitiba/PR");

      await section.getByLabel("Exibir meu perfil na descoberta").uncheck();
      await section.getByRole("button", { name: "Salvar perfil público" }).click();
      await expect(section.getByRole("status")).toContainText("sem aparecer na descoberta");
      await gotoHydrated(readerPage, `/profissionais?q=${run}`);
      await expect(readerPage.getByText("Nenhum perfil com esses filtros")).toBeVisible();

      // Pendente (F1): o portal nao abre; a Area profissional explica o estado.
      const pendingContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const pendingPage = await pendingContext.newPage();
      await signIn(pendingPage, baseURL!, pending, "?context=professional");
      await gotoHydrated(pendingPage, "/pro/perfil");
      await expect(pendingPage).toHaveURL(/\/area-profissional$/);
      await expect(pendingPage.getByTestId("professional-state-card")).toHaveAttribute(
        "data-professional-state",
        "UNDER_AUTOMATED_REVIEW",
      );

      // A API recusa publicar incompleto e campo fora do contrato.
      const incomplete = await pendingPage.request.put(`${baseURL}/api/professional/public-profile`, {
        data: { listed: true, displayName: "X Y", bio: null, city: null, state: null, modalities: [], areas: [], languages: [] },
      });
      expect(incomplete.status()).toBe(400);
      const extra = await pendingPage.request.put(`${baseURL}/api/professional/public-profile`, {
        data: { listed: false, displayName: null, bio: null, city: null, state: null, modalities: [], areas: [], languages: [], cpf: "000" },
      });
      expect(extra.status()).toBe(400);
      // Conta sem perfil profissional nao cria perfil publico.
      const noProfile = await readerPage.request.put(`${baseURL}/api/professional/public-profile`, {
        data: { listed: false, displayName: null, bio: null, city: null, state: null, modalities: [], areas: [], languages: [] },
      });
      expect(noProfile.status()).toBe(403);

      await proContext.close();
      await readerContext.close();
      await pendingContext.close();
    } finally {
      await cleanupAccounts(admin, created);
    }
  });

  test("paginacao limitada e vazao por conta", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const admin = qaAdmin();
    const created: string[] = [];
    const run = tag();
    try {
      for (let index = 1; index <= 13; index += 1) {
        const item = await publish(admin, testInfo.project.name, `Pag ${run} ${String(index).padStart(2, "0")}`, "verified");
        created.push(item.account.userId);
      }
      const reader = await createPersonalAccount(admin, testInfo.project.name, "Leitor Pagina QA");
      created.push(reader.userId);
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      await signIn(page, baseURL!, reader);

      await gotoHydrated(page, `/profissionais?q=${run}`);
      await expect(results(page)).toHaveCount(12);
      const pagination = page.getByRole("navigation", { name: "Paginação" });
      await expect(pagination.getByRole("link", { name: "Anterior" })).toHaveCount(0);
      await pagination.getByRole("link", { name: "Próxima" }).click();
      await expect(page).toHaveURL(new RegExp(`pagina=2`));
      await expect(results(page)).toHaveCount(1);
      await expect(results(page).first()).toContainText(`Pag ${run} 13`);
      await expect(pagination.getByRole("link", { name: "Próxima" })).toHaveCount(0);

      // 40 leituras por minuto por conta no app; a seguinte recebe a tela de limite.
      let limited = false;
      for (let attempt = 0; attempt < 45 && !limited; attempt += 1) {
        await page.goto(`${baseURL}/profissionais?q=${run}&pagina=${(attempt % 2) + 1}`);
        limited = (await page.getByText("Muitas consultas seguidas").count()) > 0;
      }
      expect(limited, "limite de vazao da descoberta").toBe(true);
      await context.close();
    } finally {
      await cleanupAccounts(admin, created);
    }
  });
});

test.describe("Stage 29 / PRO-5 - visual", () => {
  test("0, 1 e muitos resultados; perfil; editor: sem espaco morto, sem palavra partida, axe", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const shots = process.env.ELYRA_SHOTS_DIR ?? "test-results/stage29-shots";
    const admin = qaAdmin();
    const created: string[] = [];
    const run = tag();
    const project = testInfo.project.name;
    try {
      const first = await publish(admin, project, `Beatriz ${run}`, "verified", {
        modalities: ["online", "in_person"],
        areas: ["luto", "estresse", "relacionamentos"],
        languages: ["pt", "libras"],
      });
      created.push(first.account.userId);
      for (let index = 1; index <= 6; index += 1) {
        const item = await publish(admin, project, `Muitos ${run} ${index}`, "verified", { areas: ["familia", "trabalho_carreira"] });
        created.push(item.account.userId);
      }
      const reader = await createPersonalAccount(admin, project, "Leitora Visual QA");
      created.push(reader.userId);

      const context = await browser.newContext({
        storageState: { cookies: [], origins: [] },
        viewport: testInfo.project.use.viewport ?? undefined,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
        userAgent: testInfo.project.use.userAgent,
        deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
      });
      const page = await context.newPage();
      await signIn(page, baseURL!, reader);
      const widths: Record<string, Array<{ width: number; height: number }>> = {
        desktop: [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }],
        tablet: [{ width: 834, height: 1112 }],
        mobile: [{ width: 360, height: 780 }, { width: 393, height: 851 }, { width: 412, height: 915 }],
      };
      const views = [
        { slug: "zero", path: `/profissionais?q=${run}-vazio` },
        { slug: "um", path: `/profissionais?q=Beatriz ${run}` },
        { slug: "muitos", path: `/profissionais?q=${run}` },
        { slug: "perfil", path: `/profissionais/${first.slug}` },
      ];
      for (const size of widths[project]!) {
        await page.setViewportSize(size);
        for (const view of views) {
          await gotoHydrated(page, view.path);
          await page.waitForTimeout(250);
          await page.screenshot({ path: `${shots}/discovery-${project}-${size.width}/${view.slug}.png`, fullPage: true });
          const metrics = await measureDeadSpace(page);
          const where = `${view.slug} ${size.width}px`;
          expect(metrics.horizontalOverflow, `${where}: rolagem lateral`).toBeLessThanOrEqual(0);
          expect(metrics.widthUse, `${where}: largura util`).toBeGreaterThanOrEqual(0.9);
          expect(await brokenGuardedWords(page), where).toEqual([]);
          for (const grid of metrics.grids) {
            if (!grid.sideBySide) continue;
            expect(grid.gap <= 260 || grid.shortRatio >= 0.75, `${where}: colunas a ${Math.round(grid.gap)} px`).toBe(true);
          }
        }
      }
      if (project === "mobile") {
        // Design Pass 2: no celular, filtros secundarios ficam atras de "Mais filtros".
        await page.setViewportSize({ width: 360, height: 780 });
        await gotoHydrated(page, `/profissionais?q=${run}`);
        await expect(page.getByLabel("UF")).toBeHidden();
        await page.getByRole("button", { name: "Mais filtros" }).click();
        await expect(page.getByLabel("UF")).toBeVisible();
        await gotoHydrated(page, `/profissionais?q=${run}&uf=SP`);
        await expect(page.getByLabel("UF")).toBeVisible();
        await expect(page.getByRole("button", { name: "Menos filtros" })).toBeVisible();
      }
      for (const view of views) {
        await gotoHydrated(page, view.path);
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`), view.slug).toEqual([]);
      }

      // Editor do Perfil publico, com o preview, no mesmo viewport.
      const proContext = await browser.newContext({
        storageState: { cookies: [], origins: [] },
        viewport: testInfo.project.use.viewport ?? undefined,
        isMobile: testInfo.project.use.isMobile,
        hasTouch: testInfo.project.use.hasTouch,
        userAgent: testInfo.project.use.userAgent,
        deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
      });
      const proPage = await proContext.newPage();
      await signIn(proPage, baseURL!, first.account, "?context=professional");
      for (const size of widths[project]!) {
        await proPage.setViewportSize(size);
        await gotoHydrated(proPage, "/pro/perfil");
        await proPage.screenshot({ path: `${shots}/discovery-${project}-${size.width}/editor.png`, fullPage: true });
        const metrics = await measureDeadSpace(proPage);
        expect(metrics.horizontalOverflow, `editor ${size.width}px`).toBeLessThanOrEqual(0);
        // Design Pass 2: formulario longo ao lado do preview deixava ~630 px de buraco em 1440.
        for (const grid of metrics.grids) {
          if (!grid.sideBySide) continue;
          expect(grid.gap <= 260 || grid.shortRatio >= 0.75, `editor ${size.width}px: colunas a ${Math.round(grid.gap)} px`).toBe(true);
        }
      }
      const axe = await new AxeBuilder({ page: proPage }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`), "editor").toEqual([]);
      await proContext.close();
      await context.close();
    } finally {
      await cleanupAccounts(admin, created);
    }
  });
});
