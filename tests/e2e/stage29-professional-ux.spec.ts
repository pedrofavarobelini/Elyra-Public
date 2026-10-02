import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import {
  cleanupAccounts,
  createPersonalAccount,
  createProfessionalAccount,
  qaAdmin,
  signIn,
  type Admin,
  type QaAccount,
} from "./professional-fixtures";

/**
 * UX profissional pre-polimento (L-398, L-400, L-402).
 *
 * 1. Estados do vinculo no perfil: sem vinculo -> pendente -> cancelar ->
 *    convite por codigo -> ativo -> encerrar. Copy separada: "Cancelar
 *    solicitacao" (pendente), "Encerrar vinculo" (ativo); nunca "Revogar conexao".
 * 2. `returnTo`: convite e privacidade voltam ao perfil de origem; acesso direto
 *    e valores maliciosos caem no hub.
 * 3. Aceitar convite nao concede nenhum escopo (conferido no banco).
 * 4. Diretorio DEMO: 5 perfis ficticios e os filtros que a tela ja suporta.
 * 5. Telas alteradas: sem rolagem lateral em 1440/1366/1280/834/390, axe
 *    claro/escuro, reduced motion.
 */

async function contextFor(browser: Browser, baseURL: string, account: QaAccount) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "pt-BR" });
  const page = await context.newPage();
  await signIn(page, baseURL, account);
  return { context, page };
}

async function grantCount(admin: Admin, clientId: string) {
  const { data: rows } = await admin.from("professional_connections").select("id").eq("client_user_id", clientId);
  const ids = (rows ?? []).map((row) => row.id);
  if (ids.length === 0) return 0;
  const { count } = await admin.from("sharing_permissions").select("id", { count: "exact", head: true }).in("connection_id", ids);
  return count ?? 0;
}

async function noHorizontalScroll(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

async function seriousAxe(page: Page) {
  const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  return axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id);
}

test.describe("Stage 29 - UX profissional (estados, convite, returnTo, diretorio)", () => {
  test("vinculo: sem, pendente, cancelar, convite, ativo, encerrar; returnTo; nada compartilhado", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.setTimeout(240_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Helena UX Demo");
      const person = await createPersonalAccount(admin, testInfo.project.name, "Pessoa UX QA", { patient: true });
      created.push(pro.userId, person.userId);
      const slug = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
      const profilePath = `/profissionais/${slug}`;
      const encoded = encodeURIComponent(profilePath);
      const { error } = await admin.from("professional_public_profiles").insert({
        user_id: pro.userId,
        slug,
        listed: true,
        display_name: "Helena UX Demo",
        city: "Recife",
        state: "PE",
        modalities: ["online"],
        areas: ["ansiedade"],
        languages: ["pt"],
      });
      if (error) throw error;

      const { page: p, context: personContext } = await contextFor(browser, baseURL, person);

      // A. Sem profissional: a agenda explica e oferece os dois caminhos.
      await gotoHydrated(p, "/agenda");
      await expect(p.getByText("Para marcar uma sessão, primeiro conecte-se a um profissional.")).toBeVisible();
      await expect(p.getByRole("link", { name: "Encontrar profissional" }).first()).toBeVisible();
      await expect(p.getByRole("link", { name: "Tenho um código de convite" })).toHaveAttribute("href", "/convite?returnTo=%2Fagenda");

      // Perfil sem vinculo -> convite com returnTo -> Voltar ao perfil.
      await gotoHydrated(p, profilePath);
      const card = p.getByTestId("directory-accompaniment");
      await expect(card).toHaveAttribute("data-state", "none");
      const inviteLink = card.getByRole("link", { name: "Tenho um código de convite" });
      await expect(inviteLink).toHaveAttribute("href", `/convite?returnTo=${encoded}`);
      await inviteLink.click();
      await expect(p).toHaveURL(`${baseURL}/convite?returnTo=${encoded}`);
      await expect(p.getByRole("heading", { name: "Conectar com um profissional", level: 1 })).toBeVisible();
      await expect(p.getByTestId("invite-steps").locator("li")).toHaveCount(3);
      await expect(p.getByTestId("invite-how").getByRole("link", { name: /Encontrar profissiona/ })).toBeVisible();
      const back = p.getByTestId("invite-back");
      await expect(back).toHaveAttribute("href", profilePath);
      await back.click();
      await expect(p).toHaveURL(new RegExp(`${profilePath}$`));

      // B/C. Pendente -> "Cancelar solicitacao" (nunca "Revogar conexao").
      await card.getByRole("button", { name: "Solicitar acompanhamento" }).click();
      await expect(card).toHaveAttribute("data-state", "pending");
      await expect(card.getByTestId("relationship-state")).toHaveText("Aguardando resposta do profissional");
      await expect(card.getByText(/Revogar/)).toHaveCount(0);
      expect(await grantCount(admin, person.userId), "pedir nao compartilha").toBe(0);
      await gotoHydrated(p, profilePath);
      await expect(card).toHaveAttribute("data-state", "pending");
      await gotoHydrated(p, "/configuracoes/privacidade");
      await expect(p.getByRole("button", { name: "Cancelar solicitação" })).toBeVisible();
      await expect(p.getByRole("button", { name: /Revogar conexão/ })).toHaveCount(0);
      await gotoHydrated(p, profilePath);
      await card.getByRole("button", { name: "Cancelar solicitação" }).click();
      await expect(card.getByRole("status")).toHaveText("Solicitação cancelada.");
      await expect(card).toHaveAttribute("data-state", "none");
      const { data: cancelled } = await admin.from("professional_connections").select("status").eq("client_user_id", person.userId);
      expect(cancelled).toEqual([{ status: "revoked" }]);
      await gotoHydrated(p, profilePath);
      await expect(card.getByTestId("relationship-state")).toHaveText("Sem vínculo ativo");
      await expect(card).toContainText("O profissional não possui mais acesso aos seus dados.");
      await expect(card.getByRole("button", { name: "Conectar novamente" })).toBeVisible();
      await expect(card.getByRole("link", { name: "Encontrar outro profissional" })).toHaveAttribute("href", "/profissionais");

      // G-K. Convite por codigo, a partir do perfil: previa, aviso, aceite, volta ao perfil.
      const { page: q, context: proContext } = await contextFor(browser, baseURL, pro);
      const invite = await q.request.post("/api/professional/invites");
      expect(invite.status()).toBe(201);
      const token = ((await invite.json()) as { data: { token: string } }).data.token;
      await p.goto(`${baseURL}/convite?returnTo=${encoded}#${token}`);
      await p.waitForSelector("html[data-hydrated='true']");
      await expect(p.getByRole("heading", { name: "Helena UX Demo" })).toBeVisible();
      expect(p.url(), "token sai da barra de endereco; returnTo fica").toBe(`${baseURL}/convite?returnTo=${encoded}`);
      await expect(p.getByTestId("invite-no-sharing")).toContainText(
        "Aceitar o convite cria o vínculo. Nenhum dado é compartilhado automaticamente.",
      );
      await expect(p.getByTestId("invite-steps").locator("[aria-current='step']")).toContainText("Conferir profissional");
      await p.getByRole("button", { name: "Aceitar convite" }).click();
      await expect(p.getByRole("status")).toHaveText("Você está conectado com Helena UX Demo. Nada foi compartilhado.");
      // J. Aceitar nao concede escopo nenhum.
      expect(await grantCount(admin, person.userId), "aceitar convite nao concede escopos").toBe(0);
      await expect(p.getByRole("link", { name: "Gerenciar compartilhamento" })).toHaveAttribute(
        "href",
        `/configuracoes/privacidade?returnTo=${encoded}#cfg-profissional`,
      );
      await p.getByRole("link", { name: "Voltar ao perfil do profissional" }).last().click();
      await expect(p).toHaveURL(new RegExp(`${profilePath}$`));

      // D. Ativo: horario, recado, compartilhamento, encerrar.
      await expect(card).toHaveAttribute("data-state", "active");
      await expect(card.getByTestId("relationship-state")).toHaveText("Profissional conectado");
      const { data: activeRow } = await admin
        .from("professional_connections")
        .select("id")
        .eq("client_user_id", person.userId)
        .eq("status", "active")
        .single();
      await expect(card.getByRole("link", { name: "Pedir horário" })).toHaveAttribute("href", `/agenda?vinculo=${activeRow!.id}`);
      await expect(card.getByRole("link", { name: "Enviar recado" })).toHaveAttribute("href", "/pedidos");
      // Um so "Pedir horario" na pagina (o cartao de agenda nao duplica).
      await expect(p.getByRole("link", { name: "Pedir horário" })).toHaveCount(1);

      // L. Privacidade a partir do perfil: Voltar volta ao perfil.
      await card.getByRole("link", { name: "Gerenciar compartilhamento" }).click();
      await expect(p).toHaveURL(new RegExp(`/configuracoes/privacidade\\?returnTo=${encoded}`));
      await p.waitForSelector("html[data-hydrated='true']");
      const privacyBack = p.getByTestId("privacy-back");
      await expect(privacyBack).toHaveAttribute("href", profilePath);
      await expect(privacyBack).toContainText("Voltar ao perfil do profissional");

      // N/O. Compartilhamento simples + dupla chave + resumo no topo; nada ligado.
      const summary = p.getByTestId("sharing-summary");
      await expect(summary.getByRole("heading", { name: "Quem pode acessar o quê agora" })).toBeVisible();
      await expect(summary.getByTestId("sharing-summary-item").filter({ hasText: "Helena UX Demo" })).toBeVisible();
      await expect(p.getByTestId("sharing-group-registros").first()).toBeVisible();
      await expect(p.getByTestId("sharing-group-sessoes").first()).toBeVisible();
      await expect(p.getByTestId("sharing-double-key").first()).toContainText("As duas permissões precisam permitir o acesso.");
      await expect(p.getByRole("button", { name: "Encerrar vínculo" }).first()).toBeVisible();
      await privacyBack.click();
      await expect(p).toHaveURL(new RegExp(`${profilePath}$`));

      // M. Acesso direto e valores maliciosos: Voltar vai para o hub.
      for (const raw of [
        "",
        "?returnTo=https%3A%2F%2Fevil.com",
        "?returnTo=%2F%2Fevil.com",
        "?returnTo=javascript%3Aalert(1)",
        "?returnTo=data%3Atext%2Fhtml%2C1",
        "?returnTo=%252F%252Fevil.com",
        "?returnTo=%2F%5Cevil.com",
        "?returnTo=%2Fapi%2Fme",
        "?returnTo=%2Fprofissionais%2F..%2F..%2Fapi%2Fme",
      ]) {
        await gotoHydrated(p, `/configuracoes/privacidade${raw}`);
        await expect(p.getByTestId("privacy-back"), raw).toHaveAttribute("href", "/configuracoes");
      }
      await gotoHydrated(p, "/convite?returnTo=%2F%2Fevil.com");
      await expect(p.getByTestId("invite-back")).toHaveCount(0);

      // E/F. Encerrar vinculo com confirmacao.
      await gotoHydrated(p, profilePath);
      await card.getByRole("button", { name: "Encerrar vínculo" }).click();
      const confirm = card.getByRole("group", { name: "Confirmar encerramento" });
      await expect(confirm).toContainText("corta na hora todo acesso");
      await confirm.getByRole("button", { name: "Encerrar vínculo" }).click();
      await expect(card.getByRole("status")).toContainText("Vínculo encerrado");
      await expect(card.getByTestId("relationship-state")).toHaveText("Sem vínculo ativo");
      const { data: ended } = await admin.from("professional_connections").select("status").eq("id", activeRow!.id).single();
      expect(ended?.status).toBe("revoked");

      // P. Recado: uma linha de nao emergencia; lista completa so sob demanda.
      await gotoHydrated(p, "/pedidos");
      const sos = p.getByTestId("help-request-sos");
      await expect(sos).toContainText("Em risco imediato, use o botão SOS.");
      await expect(sos.getByText("Ligar 192")).toBeHidden();

      await proContext.close();
      await personContext.close();
    } finally {
      await cleanupAccounts(admin, created);
    }
  });

  test("diretorio DEMO: 5 perfis ficticios, marcados, com filtros reais", async ({ page }) => {
    const admin = qaAdmin();
    const { count } = await admin
      .from("professional_public_profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("listed", true)
      .like("display_name", "% Demo");
    test.skip((count ?? 0) < 5, "seed DEMO ausente: rode `npm run demo:professional -- --seed`");

    const results = page.getByTestId("directory-results").getByTestId("directory-card");
    const names = ["Camila Demo", "Fernanda Demo", "Lucas Demo", "Marina Demo", "Rafael Demo"];
    await gotoHydrated(page, "/profissionais?q=Demo");
    for (const name of names) {
      const item = results.filter({ hasText: name });
      await expect(item, name).toHaveCount(1);
      // Marcado como DEMO: nome e registro ficticio (nunca um CRP real).
      await expect(item, name).toContainText("DEMO-LOCAL-");
    }

    for (const [query, expected] of [
      ["q=Demo&uf=RJ", ["Rafael Demo"]],
      ["q=Demo&cidade=curitiba", ["Fernanda Demo"]],
      ["q=Demo&idioma=libras", ["Lucas Demo"]],
      ["q=Demo&area=relacionamentos", ["Camila Demo"]],
      ["q=Demo&uf=SP&modalidade=in_person", ["Lucas Demo", "Marina Demo"]],
    ] as const) {
      await gotoHydrated(page, `/profissionais?${query}`);
      await expect(results, query).toHaveCount(expected.length);
      for (const name of expected) await expect(results.filter({ hasText: name }), query).toHaveCount(1);
    }

    // Cada perfil abre individualmente.
    await gotoHydrated(page, "/profissionais?q=Lucas%20Demo");
    await results.first().getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "Lucas Demo", level: 1 })).toBeVisible();
    await expect(page.getByTestId("directory-accompaniment")).toBeVisible();
  });

  test("telas alteradas: sem rolagem lateral (1440/1366/1280/834/390), axe claro/escuro, reduced motion", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "larguras varridas explicitamente neste teste");
    test.setTimeout(240_000);
    const routes = ["/convite", "/configuracoes/privacidade", "/pedidos", "/profissionais", "/agenda", "/relatorios"];
    for (const width of [1440, 1366, 1280, 834, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const route of routes) {
        await gotoHydrated(page, route);
        expect(await noHorizontalScroll(page), `${route} @${width}`).toBeLessThanOrEqual(0);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const route of routes) {
      await gotoHydrated(page, route);
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        expect(await seriousAxe(page), `${route} ${theme}`).toEqual([]);
      }
    }
    // Reduced motion: o conteudo e a navegacao nao dependem de animacao.
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    for (const route of routes) {
      await gotoHydrated(page, route);
      await expect(page.getByRole("heading", { level: 1 }), route).toBeVisible();
    }
  });

  test("relatorios: 'Sobre os insights' e 'Exportar e salvar' lado a lado no desktop, empilhados no celular", async ({ page, browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.skip(testInfo.project.name !== "desktop", "larguras varridas explicitamente neste teste");
    test.setTimeout(180_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      // Com dados (identidade do projeto) e vazio (conta nova, sem registro nenhum).
      const empty = await createPersonalAccount(admin, testInfo.project.name, "Relatorio Vazio QA");
      created.push(empty.userId);
      const emptySide = await contextFor(browser, baseURL, empty);
      // Poucos dados = menor intervalo; muitos = maior; vazio = conta nova.
      for (const [label, target, range] of [
        ["poucos", page, "first"],
        ["muitos", page, "last"],
        ["vazio", emptySide.page, "first"],
      ] as const) {
        for (const width of [1440, 1366, 1280, 834, 390]) {
          await target.setViewportSize({ width, height: 900 });
          await gotoHydrated(target, "/relatorios");
          const options = await target.locator("#range option").evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
          await target.locator("#range").selectOption(range === "first" ? options[0]! : options.at(-1)!);
          const rail = target.getByRole("complementary", { name: "Interpretação e exportação" });
          const about = rail.getByRole("heading", { name: "Sobre os insights" });
          const exportTitle = rail.getByRole("heading", { name: "Exportar e salvar" });
          if ((await about.count()) === 0) {
            // Estado vazio pode nao mostrar o rail; entao nao ha espaco morto a medir.
            expect(await noHorizontalScroll(target), `${label} @${width}`).toBeLessThanOrEqual(0);
            continue;
          }
          const cards = rail.locator(":scope > *");
          const [a, b] = [await cards.nth(0).boundingBox(), await cards.nth(1).boundingBox()];
          await expect(exportTitle).toBeVisible();
          if (width >= 1024) {
            expect(Math.abs(a!.y - b!.y), `${label} @${width}: lado a lado`).toBeLessThan(2);
            expect(Math.abs(a!.height - b!.height), `${label} @${width}: mesma altura`).toBeLessThan(2);
          } else {
            expect(b!.y, `${label} @${width}: empilhados`).toBeGreaterThan(a!.y + a!.height - 1);
          }
          expect(await noHorizontalScroll(target), `${label} @${width}`).toBeLessThanOrEqual(0);
          await target.screenshot({ path: `test-results/reports-layout/${label}-${width}.png`, fullPage: true });
        }
      }
      await emptySide.context.close();
    } finally {
      await cleanupAccounts(admin, created);
    }
  });
});
