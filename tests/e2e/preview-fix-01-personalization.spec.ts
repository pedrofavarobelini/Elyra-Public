import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./hydrated";

test.describe("PREVIEW_FIX_01 personalizacao visual", () => {
  test("tema, accent, fundo e cards persistem por conta e o reset restaura tudo", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Contrato independe do viewport.");
    await gotoHydrated(page, "/configuracoes/personalizacao");

    const root = page.locator("html");
    const sosBefore = await root.evaluate((node) =>
      getComputedStyle(node).getPropertyValue("--color-sos").trim(),
    );

    await page.getByRole("button", { name: "Escuro" }).click();
    await page.getByRole("button", { name: "Verde sereno" }).click();
    await page.getByRole("button", { name: "Acolhedor" }).click();
    await page.getByRole("button", { name: "Elevado" }).click();
    await expect(root).toHaveAttribute("data-elyra-theme", "dark");
    await expect(root).toHaveAttribute("data-elyra-accent", "teal");
    await expect(root).toHaveAttribute("data-elyra-background", "warm");
    await expect(root).toHaveAttribute("data-elyra-card-style", "elevated");
    expect(
      await root.evaluate((node) =>
        getComputedStyle(node).getPropertyValue("--color-sos").trim(),
      ),
    ).toBe(sosBefore);

    await page.reload();
    await expect(root).toHaveAttribute("data-elyra-theme", "dark");
    await expect(root).toHaveAttribute("data-elyra-accent", "teal");
    await expect(root).toHaveAttribute("data-elyra-background", "warm");
    await expect(root).toHaveAttribute("data-elyra-card-style", "elevated");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.getByRole("button", { name: "Restaurar padrão" }).focus();
    await page.keyboard.press("Enter");
    await expect(root).toHaveAttribute("data-elyra-theme", "system");
    await expect(root).toHaveAttribute("data-elyra-accent", "violet");
    await expect(root).toHaveAttribute("data-elyra-background", "neutral");
    await expect(root).toHaveAttribute("data-elyra-card-style", "standard");
    await expect(root).toHaveAttribute("data-elyra-text-size", "default");
    await expect(root).toHaveAttribute("data-elyra-contrast", "default");
    await expect(root).toHaveAttribute("data-elyra-motion", "system");
  });

  test("cada fundo preserva o contraste minimo de ink-subtle sobre surface-muted", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Contrato de token independe do viewport.");
    await gotoHydrated(page, "/configuracoes/personalizacao");

    const root = page.locator("html");

    /* Relativa (WCAG 2.x): o par mais apertado do sistema e ink-subtle sobre
     * surface-muted, documentado em 4.69:1 no preset neutro. Nenhum preset de
     * fundo pode levar esse par abaixo de AA. */
    const contrast = () =>
      root.evaluate((node) => {
        const read = (token: string) =>
          getComputedStyle(node).getPropertyValue(token).trim();
        const luminance = (hex: string) => {
          const value = hex.replace("#", "");
          const channel = (index: number) => {
            const raw = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16) / 255;
            return raw <= 0.03928 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
        };
        const a = luminance(read("--color-ink-subtle"));
        const b = luminance(read("--color-surface-muted"));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      });

    for (const preset of ["Neutro", "Acolhedor", "Sereno"]) {
      await page.getByRole("button", { name: preset, exact: true }).click();
      expect(await contrast(), `fundo ${preset}`).toBeGreaterThanOrEqual(4.5);
    }

    await page.getByRole("button", { name: "Escuro" }).click();
    for (const preset of ["Neutro", "Acolhedor", "Sereno"]) {
      await page.getByRole("button", { name: preset, exact: true }).click();
      expect(await contrast(), `fundo ${preset} no escuro`).toBeGreaterThanOrEqual(4.5);
    }

    await page.getByRole("button", { name: "Restaurar padrão" }).click();
  });
});
