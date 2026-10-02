import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import { createAnalyzedSession, removeSession } from "./real-session";



const CORRECTED = "Hoje conversei sobre a minha rotina de estudos e sobre o sono.";

test.describe("Stage 22-V - feedback e correcao", () => {
  test("a correcao humana nao sobrescreve o texto original do ASR", async ({
    page,
  }) => {
    const sessionId = await createAnalyzedSession(page);
    try {
      await gotoHydrated(page, `/sessoes/${sessionId}`);
      const original = await page
        .getByTestId("transcript-state")
        .textContent();
      expect(original?.trim()).toBeTruthy();

      await page.getByRole("button", { name: "Corrigir transcrição" }).click();

      /*
        O aviso aparece ANTES de a pessoa escrever. Deixar a expectativa de
        "o sistema vai aprender" de pe obteria consentimento por silencio.
      */
      await expect(
        page.getByText(/não é usada para treinar nenhum modelo/i),
      ).toBeVisible();

      const field = page.getByLabel("Escreva o que você disse de fato");
      await field.fill(CORRECTED);
      await page.getByRole("button", { name: "Salvar correção" }).click();

      await expect(page.getByText("Sua correção", { exact: true })).toBeVisible();
      await expect(page.getByText(CORRECTED)).toBeVisible();

      // O original permanece a vista, e identico ao que o ASR produziu.
      await expect(
        page.getByText("Texto original da transcrição automática"),
      ).toBeVisible();
      await expect(page.getByTestId("transcript-state")).toContainText(
        (original ?? "").trim().slice(0, 40),
      );

      // E sobrevive ao refresh, porque veio do banco e nao do estado da tela.
      await page.reload();
      await expect(page.getByText(CORRECTED)).toBeVisible();
      await expect(page.getByTestId("transcript-state")).toContainText(
        (original ?? "").trim().slice(0, 40),
      );

      // A proveniencia passa a dizer que houve revisao.
      await expect(page.getByTestId("transcript-provenance")).toBeVisible();
    } finally {
      await removeSession(page, sessionId);
    }
  });

  test("remover a correcao preserva o transcript original", async ({ page }) => {
    const sessionId = await createAnalyzedSession(page);
    try {
      await gotoHydrated(page, `/sessoes/${sessionId}`);
      const original = (
        await page.getByTestId("transcript-state").textContent()
      )?.trim();

      await page.getByRole("button", { name: "Corrigir transcrição" }).click();
      await page.getByLabel("Escreva o que você disse de fato").fill(CORRECTED);
      await page.getByRole("button", { name: "Salvar correção" }).click();
      await expect(page.getByText(CORRECTED)).toBeVisible();

      await page.getByRole("button", { name: "Remover correção" }).click();

      // Revogar tira a correcao de circulacao e nao toca no original.
      await expect(page.getByText("Sua correção", { exact: true })).toHaveCount(0);
      await expect(page.getByTestId("transcript-state")).toContainText(
        (original ?? "").slice(0, 40),
      );
    } finally {
      await removeSession(page, sessionId);
    }
  });

  test("avaliar a transcricao nao avalia a interpretacao", async ({ page }) => {
    const sessionId = await createAnalyzedSession(page);
    try {
      await gotoHydrated(page, `/sessoes/${sessionId}`);

      /*
        Os dois polegares avaliam SISTEMAS diferentes. Um controle unico
        produziria uma nota que ninguem sabe ler: uma queda nao diria se o
        reconhecedor errou as palavras ou se o Veltrix leu mal os sinais.
      */
      const transcriptUp = page.getByRole("button", {
        name: "A transcrição está correta",
      });
      await transcriptUp.click();
      await expect(page.getByText("Sua avaliação foi registrada")).toBeVisible();

      await page.reload();
      await expect(
        page.getByRole("button", { name: "A transcrição está correta" }),
      ).toHaveAttribute("aria-pressed", "true");

      // A interpretacao segue sem avaliacao: ela nao herdou nada.
      const interpretationUp = page.getByRole("button", {
        name: "A leitura faz sentido",
      });
      if ((await interpretationUp.count()) > 0) {
        await expect(interpretationUp).toHaveAttribute("aria-pressed", "false");
      }
    } finally {
      await removeSession(page, sessionId);
    }
  });

  test("a recusa oferece motivos que descrevem a maquina, e remover e possivel", async ({
    page,
  }) => {
    const sessionId = await createAnalyzedSession(page);
    try {
      await gotoHydrated(page, `/sessoes/${sessionId}`);

      await page
        .getByRole("button", { name: "A transcrição tem erros" })
        .click();
      await expect(page.getByText("Sua avaliação foi registrada")).toBeVisible();

      /*
        Nenhum motivo aponta para quem falou. A culpa de uma transcricao ruim e
        do reconhecedor, e a lista existe para dizer isso.
      */
      await expect(page.getByText("Faltou uma palavra")).toBeVisible();
      await expect(page.getByText("Número ou nome incorreto")).toBeVisible();
      await expect(
        page.getByText(/sotaque|inaudív|fala confusa|você falou/i),
      ).toHaveCount(0);

      await page.getByRole("button", { name: "Faltou uma palavra" }).click();
      await expect(page.getByText("Sua avaliação foi registrada")).toBeVisible();

      // Quem avaliou pode desavaliar.
      await page.getByRole("button", { name: "Remover avaliação" }).click();
      await expect(page.getByText("Avaliação removida")).toBeVisible();

      await page.reload();
      await expect(
        page.getByRole("button", { name: "A transcrição tem erros" }),
      ).toHaveAttribute("aria-pressed", "false");
    } finally {
      await removeSession(page, sessionId);
    }
  });
});
