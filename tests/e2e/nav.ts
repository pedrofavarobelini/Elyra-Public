import { expect, type Locator, type Page } from "@playwright/test";



/** O gatilho do menu — existe abaixo de `lg` (tablet e mobile). */
export function navTrigger(page: Page): Locator {
  return page.getByRole("button", { name: "Abrir menu de navegação" });
}

/** A navegacao principal: sidebar persistente (desktop) ou conteudo do drawer. */
export function mainNavigation(page: Page): Locator {
  return page.getByRole("navigation", { name: "Navegação principal" });
}


export async function expectNavigationReachable(page: Page): Promise<void> {
  const trigger = navTrigger(page);
  if ((await trigger.count()) > 0 && (await trigger.isVisible())) {
    await expect(mainNavigation(page)).toHaveCount(0);
    return;
  }
  await expect(mainNavigation(page)).toBeVisible();
}

/**
 * Devolve a navegacao pronta para uso, abrindo o drawer quando necessario.
 *
 * Espera a visibilidade em vez de confiar no clique: o drawer entra animado, e
 * asserir sobre um elemento a meio caminho da animacao produz falha
 * intermitente - exatamente a classe de flake que `L-046` custou caro para
 * eliminar.
 */
export async function openNav(page: Page): Promise<Locator> {
  const nav = mainNavigation(page);
  const trigger = navTrigger(page);
  if (await trigger.isVisible()) {
    await trigger.click();
  }
  await expect(nav).toBeVisible();
  return nav;
}

/**
 * Navega por um destino do menu e espera a transicao terminar.
 *
 * No drawer, clicar num link dispara a navegacao **e** o fechamento animado;
 * esperar o drawer sumir **e** a rota ficar ativa transforma isso em espera por
 * evento, e nao por tempo (licao de `L-046`). Na sidebar persistente a espera e
 * pela marcacao `aria-current` do destino.
 */
export async function navigateTo(page: Page, label: string): Promise<void> {
  const usesDrawer = await navTrigger(page).isVisible();
  const nav = await openNav(page);
  await nav.getByRole("link", { name: label }).click();
  if (usesDrawer) {
    await expect(nav).toBeHidden();
  } else {
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });
}
