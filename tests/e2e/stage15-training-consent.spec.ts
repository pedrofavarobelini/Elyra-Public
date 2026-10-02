import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./hydrated";



const CONSENT_SWITCH = "Permitir uso dos meus relatórios para aprendizado";

test.describe("Stage 15 - consentimento de treino", () => {
  test("nasce desligado, e concedido, persiste e pode ser revogado", async ({
    page,
  }) => {
    await gotoHydrated(page, "/configuracoes/privacidade");
    const consent = page.getByRole("switch", { name: CONSENT_SWITCH });

    // Opt-in: nenhuma identidade nova comeca contribuindo.
    await expect(consent).toHaveAttribute("aria-checked", "false");
    await expect(consent).toBeEnabled();

    await consent.click();
    await expect(consent).toHaveAttribute("aria-checked", "true");

    // Persistencia real: o estado vem do log append-only, nao do componente.
    await gotoHydrated(page, "/configuracoes/privacidade");
    await expect(
      page.getByRole("switch", { name: CONSENT_SWITCH }),
    ).toHaveAttribute("aria-checked", "true");

    // Revogacao explicita, pelo mesmo controle.
    await page.getByRole("switch", { name: CONSENT_SWITCH }).click();
    await expect(
      page.getByRole("switch", { name: CONSENT_SWITCH }),
    ).toHaveAttribute("aria-checked", "false");

    await gotoHydrated(page, "/configuracoes/privacidade");
    await expect(
      page.getByRole("switch", { name: CONSENT_SWITCH }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("explica que e opcional e que relatorio nao vira treino", async ({
    page,
  }) => {
    await gotoHydrated(page, "/configuracoes/privacidade");

    await expect(
      page.getByText("A Elyra funciona por completo com isto desligado."),
    ).toBeVisible();
    await expect(page.getByText("não envia nada para treino")).toBeVisible();
    await expect(
      page.getByText(/Desligar vale imediatamente/),
    ).toBeVisible();
  });
});
