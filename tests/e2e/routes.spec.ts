import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { expectNavigationReachable, openNav } from "./nav";



const ROUTES = [
  { path: "/dashboard", heading: "Olá, Demo", nav: "Dashboard" },
  { path: "/meu-humor", heading: "Meu Humor", nav: "Meu Humor" },
  { path: "/historico", heading: "Histórico", nav: null },
  { path: "/diario", heading: "Diário", nav: "Diário" },
  { path: "/metas", heading: "Metas", nav: "Metas" },
  { path: "/perfil", heading: "Perfil", nav: "Perfil" },
  { path: "/configuracoes", heading: "Configurações", nav: null },

  { path: "/configuracoes/privacidade", heading: "Privacidade e consentimento", nav: null },
  { path: "/configuracoes/dados", heading: "Seus dados", nav: null },
  { path: "/configuracoes/personalizacao", heading: "Personalização", nav: null },
  { path: "/seguranca", heading: "Segurança", nav: null },
  { path: "/notificacoes", heading: "Notificações", nav: null },

  { path: "/convite", heading: "Conectar com um profissional", nav: null },
] as const;


const STAGE_03_NAV = ["Relatórios", "Sessões"] as const;


const mainNav = (page: Page) => openNav(page);

test.describe("Stage 02 - rotas da jornada", () => {
  for (const route of ROUTES) {
    test(`${route.path} renderiza com App Shell e h1 unico`, async ({ page }) => {
      const response = await gotoHydrated(page, route.path);
      expect(response?.status()).toBe(200);

      await expect(
        page.getByRole("heading", { name: route.heading, level: 1 }),
      ).toBeVisible();

      // Uma pagina, um h1. Evita hierarquia quebrada para leitor de tela.
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

      // A navegacao esta a um gesto de distancia (ou persistente, no desktop,

      // visivel e o acesso a ela.
      await expectNavigationReachable(page);
      await expect(page.getByRole("main")).toBeVisible();
    });
  }

  test("a raiz redireciona para o dashboard", async ({ page }) => {
    await gotoHydrated(page, "/");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a navegacao expoe os 7 itens do usuario", async ({ page }) => {
    await gotoHydrated(page, "/dashboard");
    const nav = await mainNav(page);

    for (const label of [
      "Dashboard",
      "Diário",
      "Meu Humor",
      "Relatórios",
      "Metas",
      "Sessões",
      "Perfil",
    ]) {
      await expect(nav.getByRole("link", { name: label })).toHaveCount(1);
    }
  });

  test("todo destino da navegacao existe (typedRoutes ligado)", async ({
    page,
  }) => {

    // existir e `typedRoutes: true` voltou. Um destino inexistente agora e erro
    // de compilacao; este teste guarda o comportamento em runtime.
    await gotoHydrated(page, "/dashboard");
    const nav = await mainNav(page);
    for (const label of STAGE_03_NAV) {
      await expect(nav.getByRole("link", { name: label })).toBeVisible();
    }

    for (const path of ["/relatorios", "/sessoes"]) {
      const response = await page.request.get(path);
      expect(response.status(), `${path} deveria responder 200`).toBe(200);
    }
  });

  test("a rota ativa e marcada com aria-current", async ({ page }) => {
    await gotoHydrated(page, "/metas");
    const nav = await mainNav(page);
    await expect(
      nav.getByRole("link", { name: "Metas" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      nav.getByRole("link", { name: "Dashboard" }),
    ).not.toHaveAttribute("aria-current", "page");
  });

  test("navegacao por link preserva o estado carregado entre rotas", async ({
    page,
  }) => {
    await gotoHydrated(page, "/dashboard");
    const nav = await mainNav(page);
    await nav.getByRole("link", { name: "Metas" }).click();
    await expect(
      page.getByRole("heading", { name: "Metas", level: 1 }),
    ).toBeVisible();
    const meditar = page.getByRole("listitem").filter({ hasText: "Meditar" });
    await expect(meditar.getByTestId(/^progress-/)).toHaveText(/\d+ de 10 min/);
  });

  test("acessibilidade: skip link recebe o primeiro foco", async ({ page }) => {
    await gotoHydrated(page, "/dashboard");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Pular para o conteúdo" }),
    ).toBeFocused();
  });

  test("acessibilidade: o teclado alcanca a acao principal do check-in", async ({
    page,
  }) => {
    await gotoHydrated(page, "/meu-humor");
    const submit = page.getByRole("button", { name: "Salvar check-in" });
    await submit.focus();
    await expect(submit).toBeFocused();
    await submit.press("Enter");
    await expect(page.getByText("Registro salvo")).toBeVisible();
  });

  test("o aviso nao clinico esta presente no dashboard", async ({ page }) => {
    await gotoHydrated(page, "/dashboard");
    const notice = page.getByRole("note").first();
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/não fornece diagnóstico/i);
  });
});
