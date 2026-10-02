import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";



async function openPatientDossier(page: Page) {
  await gotoHydrated(page, "/pro/acompanhamentos");
  await page.getByRole("link", { name: /Abrir dossiê/i }).first().click();
  await page.waitForLoadState("load");
}

test.describe("Stage 22-V - escopo da correcao no dossie profissional", () => {
  test("o dossie declara transcricao nao compartilhada, com resultado compartilhado", async ({
    page,
  }) => {
    await openPatientDossier(page);

    /*
      O estado que torna o resto significativo: resultado SIM, transcricao NAO.
      E exatamente a combinacao em que a policy errada entregava a correcao.
    */
    await expect(page.getByTestId("sharing-multimodal_result")).toHaveText(
      "Compartilhado",
    );
    await expect(page.getByTestId("sharing-multimodal_transcript")).toHaveText(
      "Não compartilhado",
    );
  });

  test("nenhuma proveniencia de transcricao aparece sem o escopo de transcricao", async ({
    page,
  }) => {
    /*
      O rotulo de proveniencia so existe quando ha transcricao compartilhada.
      Sem o escopo ele nao pode aparecer nem como "revisada pela pessoa
      usuaria" — isso ja seria contar que houve correcao.
    */
    await openPatientDossier(page);
    await page.getByRole("tab", { name: "Sessões" }).click();
    await expect(page.getByTestId("pro-transcript-provenance")).toHaveCount(0);
  });

  test("o polegar da pessoa nunca aparece no dossie", async ({ page }) => {
    /*
      Avaliacao de produto e opiniao sobre a ferramenta, e nao sobre a pessoa.
      Leva-la ao dossie a transformaria em dado sobre quem falou — e mudaria o
      que a pessoa sente ao clicar no polegar, que passaria a ser uma mensagem
      para o seu profissional.

      As frases abaixo sao os rotulos REAIS dos controles no produto, entao a
      asserção nao e decorativa: se algum caminho passasse a renderiza-las aqui,
      o teste cai.
    */
    await openPatientDossier(page);
    await page.getByRole("tab", { name: "Sessões" }).click();
    const body = await page.locator("body").innerText();

    for (const leak of [
      "A transcrição está correta",
      "A transcrição tem erros",
      "A leitura faz sentido",
      "A leitura não faz sentido",
      "Faltou uma palavra",
      "Sua correção",
      "Texto original da transcrição automática",
    ]) {
      expect(body).not.toContain(leak);
    }
  });
});
