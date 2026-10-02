import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./hydrated";

/**
 * ReplayDock: espinha dorsal deterministica e sem dados fabricados da V2.
 * Fluxos que exigem conta descartavel, midia ou mutacao destrutiva vivem nas
 * suites especializadas chamadas pelo runner `qa:replay`.
 */
test("ReplayDock percorre todas as superficies pessoais canonicas", async ({ page }) => {
  const routes = [
    "/dashboard",
    "/diario",
    "/meu-humor",
    "/historico",
    "/relatorios",
    "/metas",
    "/ciclo",
    "/perfil",
    "/configuracoes",
    "/seguranca",
    "/notificacoes",
    "/sessoes",
  ] as const;

  for (const route of routes) {
    await gotoHydrated(page, route);
    await expect(page.locator("main#conteudo h1")).toHaveCount(1);
    await expect(page.locator("main#conteudo h1")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${route} criou overflow horizontal`).toBeLessThanOrEqual(1);
  }
});

test("ReplayDock inclui personalizacao persistente e reversivel", async ({ page }) => {
  await gotoHydrated(page, "/configuracoes/personalizacao");
  await page.getByRole("button", { name: "Maior", exact: true }).click();
  await page.getByRole("button", { name: "Contraste reforçado" }).click();
  await page.getByRole("button", { name: "Reduzir sempre" }).click();
  await gotoHydrated(page, "/dashboard");
  await expect(page.locator("html")).toHaveAttribute("data-elyra-text-size", "large");
  await expect(page.locator("html")).toHaveAttribute("data-elyra-contrast", "reinforced");
  await expect(page.locator("html")).toHaveAttribute("data-elyra-motion", "reduce");
  await gotoHydrated(page, "/configuracoes/personalizacao");
  await page.getByRole("button", { name: "Restaurar padrão" }).click();
});

test("ReplayDock mantem Sessoes no replay sem fingir hardware", async ({ page }) => {
  await gotoHydrated(page, "/sessoes");
  await expect(page.getByRole("heading", { name: "Sessões multimodais", level: 2, exact: true })).toBeVisible();
  const activation = page.getByRole("button", { name: "Ativar sessões multimodais" });
  if (await activation.isVisible()) {
    await expect(page.getByText(/nenhuma permissão de captura é concedida agora/i)).toBeVisible();
    await expect(activation).toBeEnabled();
  } else {
    await expect(page.getByRole("group", { name: "1. Escolha o tipo de sessão" })).toBeVisible();
    await expect(page.getByText(/todas começam desligadas/i)).toBeVisible();
    await expect(page.getByRole("region", { name: "Tabela de sessões anteriores" })).toBeVisible();
  }
});
