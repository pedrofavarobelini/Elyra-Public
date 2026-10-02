import { expect, test } from "@playwright/test";
import { gotoHydrated } from "../e2e/hydrated";
import { openNav } from "../e2e/nav";



test.describe("Design System - fundacao visual", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHydrated(page, "/design-system");
  });

  test("renderiza o App Shell com navegacao principal", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Design System", level: 1 }),
    ).toBeVisible();

    // A navegacao esta a um gesto: o acesso a ela e que precisa estar sempre
    // visivel. Ver `tests/e2e/nav.ts`.
    const nav = await openNav(page);

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

  test("valor ausente exibe 'Sem registro' e nunca zero", async ({ page }) => {
    const energia = page.getByRole("group", { name: "Energia" });
    await expect(energia).toBeVisible();

    // Invariante de contrato: ausencia de registro nunca vira zero.
    await expect(energia.getByText("Sem registro")).toBeVisible();
    await expect(energia.getByText("0", { exact: true })).toHaveCount(0);
    await expect(energia.getByText("0,0", { exact: true })).toHaveCount(0);

    // Um card com valor real continua exibindo o numero.
    const sono = page.getByRole("group", { name: "Qualidade do sono" });
    await expect(sono.getByText("7,6")).toBeVisible();
  });

  test("aviso nao clinico esta presente", async ({ page }) => {
    const notices = page.getByRole("note");
    await expect(notices.first()).toBeVisible();
    await expect(notices.first()).toContainText(/não fornece diagnóstico/i);
  });

  test("o grafico e renderizado", async ({ page }) => {
    await expect(page.getByText("Evolução emocional")).toBeVisible();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
  });

  test("acessibilidade basica: skip link e foco visivel", async ({ page }) => {
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Pular para o conteúdo" }),
    ).toBeFocused();
  });

  test("screenshot canonico", async ({ page }, testInfo) => {
    await page.waitForLoadState("load");
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
    const shot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`design-system-${testInfo.project.name}`, {
      body: shot,
      contentType: "image/png",
    });
  });
});
