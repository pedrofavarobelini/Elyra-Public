import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./hydrated";


test.describe("PREVIEW_FIX_01 layout de notificacoes", () => {
  test("a trilha de apoio acompanha a central sem deixar vazio inferior", async ({ page }, testInfo) => {
    await gotoHydrated(page, "/notificacoes");

    const layout = page.getByTestId("notifications-layout");
    const rail = page.getByTestId("notifications-support-grid");
    await expect(layout).toBeVisible();
    await expect(rail).toBeVisible();

    const main = page.getByTestId("notifications-main");
    await expect(main).toBeVisible();
    const inboxBox = (await main.boundingBox())!;
    const railBox = (await rail.boundingBox())!;
    expect(inboxBox).not.toBeNull();
    expect(railBox).not.toBeNull();

    if (testInfo.project.name === "desktop") {
      // Lado a lado: a trilha comeca depois da central no eixo X...
      expect(railBox.x).toBeGreaterThanOrEqual(inboxBox.x + inboxBox.width - 1);
      // ...e na mesma faixa vertical, e nao empurrada para baixo dela.
      expect(Math.abs(railBox.y - inboxBox.y)).toBeLessThanOrEqual(4);
      // A trilha carrega a maior parte da altura da pagina: nao sobra bloco
      // vazio do tamanho de um card sob a coluna curta.
      const layoutBox = (await layout.boundingBox())!;
      expect(railBox.height).toBeGreaterThan(layoutBox.height * 0.5);
    } else {
      // Tablet e mobile: uma coluna so, trilha abaixo da central.
      expect(railBox.y).toBeGreaterThanOrEqual(inboxBox.y + inboxBox.height - 1);
    }

    // Nenhum viewport pode gerar rolagem horizontal.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("continua sem violacao de acessibilidade com texto muito maior", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Um viewport basta para o contrato de token.");

    await gotoHydrated(page, "/configuracoes/personalizacao");
    await page.getByRole("button", { name: "Muito maior" }).click();

    await gotoHydrated(page, "/notificacoes");
    await expect(page.locator("html")).toHaveAttribute("data-elyra-text-size", "xlarge");
    await expect(page.getByTestId("notifications-support-grid")).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await gotoHydrated(page, "/configuracoes/personalizacao");
    await page.getByRole("button", { name: "Restaurar padrão" }).click();
  });
});
