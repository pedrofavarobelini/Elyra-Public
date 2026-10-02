import { expect, test, type Page } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { navigateTo } from "./nav";



const goalCard = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ hasText: title });

const checkinsTable = (page: Page) =>
  page.getByRole("table", { name: "Check-ins emocionais registrados", exact: true });

/**
 * Seleciona um sentimento clicando no rotulo visivel.
 *
 * O `input[type=radio]` e `sr-only` e fica coberto pelo emoji decorativo, entao
 * clicar no rotulo e o unico gesto que corresponde ao do usuario real.
 */
async function pickFeeling(page: Page, label: string) {
  await page.getByText(label, { exact: true }).click();
  await expect(page.getByRole("radio", { name: label })).toBeChecked();
}

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHydrated(page, "/dashboard");
  });

  /**
   * Ancorar na regiao, e nao so no nome do grupo.
   *
   * O dashboard passou a mostrar "Ansiedade percebida" duas vezes: o valor de
   * hoje e a comparacao da semana. Os dois grupos tem nomes acessiveis
   * distintos - a comparacao diz "comparação de 7 dias" -, mas `getByRole` casa
   * por **substring**, entao o nome curto continua alcancando os dois.
   *
   * Escopar pela regiao expressa o que o teste quer de fato ("a metrica de
   * hoje") e nao depende do sufixo do outro grupo continuar existindo.
   */
  const metricasDoDia = (page: Page) =>
    page.getByRole("region", { name: "Métricas do dia" });

  test("exibe as metricas do ultimo registro", async ({ page }) => {
    // Ultimo check-in do seed: ansiedade 3, energia 6. Ultimo sono: qualidade 8.
    await expect(
      metricasDoDia(page).getByRole("group", { name: "Ansiedade percebida" }),
    ).toContainText("3,0");
    await expect(
      metricasDoDia(page).getByRole("group", { name: "Energia" }),
    ).toContainText("6,0");
    await expect(
      metricasDoDia(page).getByRole("group", { name: "Qualidade do sono" }),
    ).toContainText("8,0");
    await expect(
      metricasDoDia(page).getByRole("group", { name: "Horas dormidas" }),
    ).toContainText("7h 12m");
  });

  test("ansiedade e apresentada como autorrelato, nao como medicao", async ({
    page,
  }) => {
    await expect(
      metricasDoDia(page).getByRole("group", { name: "Ansiedade percebida" }),
    ).toContainText("não medido pelo sistema");
  });

  test("o grafico da semana e renderizado e nao interpola lacunas", async ({
    page,
  }) => {
    await expect(page.getByText("Evolução emocional")).toBeVisible();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();
    await expect(
      page.getByText("Dias sem registro aparecem como lacuna"),
    ).toBeVisible();
  });

  test("o atalho de check-in leva a jornada de humor", async ({ page }) => {
    await page.getByRole("link", { name: "Fazer check-in" }).click();
    await expect(
      page.getByRole("heading", { name: "Meu Humor", level: 1 }),
    ).toBeVisible();
  });
});

test.describe("Check-in emocional", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHydrated(page, "/meu-humor");
  });

  test("registra um check-in completo e ele aparece no historico", async ({
    page,
  }) => {
    await pickFeeling(page, "Feliz");
    await page.getByRole("button", { name: "Trabalho", exact: false }).first().click();
    await page.getByLabel("Observação").fill("Registro de teste E2E.");
    await page.getByRole("button", { name: "Salvar check-in" }).click();

    await expect(page.getByText("Registro salvo")).toBeVisible();

    // Navegacao por link preserva o store em memoria.
    await navigateTo(page, "Dashboard");
    await navigateTo(page, "Meu Humor");
    await page.getByRole("link", { name: "Ver histórico" }).click();

    await expect(
      page.getByRole("heading", { name: "Histórico", level: 1 }),
    ).toBeVisible();
    // O registro criado e o mais recente e encabeca a tabela.
    await expect(checkinsTable(page).getByRole("row").nth(1)).toContainText("Feliz");
  });

  test("ausencia de score e registrada como ausencia, nunca como zero", async ({
    page,
  }) => {
    const energy = page.getByTestId("energy-value");
    await expect(energy).toHaveText("6/10");

    await page.getByTestId("energy-toggle").click();

    await expect(energy).toHaveText("Sem registro");

    await page.getByRole("button", { name: "Salvar check-in" }).click();
    await expect(page.getByText("Registro salvo")).toBeVisible();

    await page.getByRole("link", { name: "Ver histórico" }).click();
    const firstRow = checkinsTable(page).getByRole("row").nth(1);
    await expect(firstRow).toContainText("Sem registro");
    await expect(firstRow.getByText("0,0")).toHaveCount(0);
  });

  test("o sentimento predominante nao e derivado dos scores", async ({
    page,
  }) => {
    // Humor alto + sentimento "Ansioso" e uma combinacao valida: sao campos
    // independentes por contrato.
    await pickFeeling(page, "Ansioso");
    await expect(page.getByTestId("mood-value")).toHaveText("7/10");
    await page.getByRole("button", { name: "Salvar check-in" }).click();
    await expect(page.getByText("Registro salvo")).toBeVisible();

    await page.getByRole("link", { name: "Ver histórico" }).click();
    await expect(checkinsTable(page).getByRole("row").nth(1)).toContainText("Ansioso");
    await expect(checkinsTable(page).getByRole("row").nth(1)).toContainText("7,0");
  });

  test("permite criar um fator proprio e usa-lo no registro", async ({
    page,
  }) => {
    await page.getByLabel("Criar fator próprio").fill("Mudanca de rotina");
    await page.getByRole("button", { name: "Adicionar fator" }).click();

    const created = page.getByRole("button", { name: /Mudanca de rotina/ });
    await expect(created).toBeVisible();
    await expect(created).toHaveAttribute("aria-pressed", "true");
    await expect(created).toContainText("seu");
  });

  test("o sono e um registro separado do check-in", async ({ page }) => {
    await expect(
      page.getByText("Registro separado do check-in emocional"),
    ).toBeVisible();

    await page.getByLabel("Horas").fill("6");
    await page.getByLabel("Minutos").fill("30");
    await page.getByRole("button", { name: "Salvar sono" }).click();
    await expect(page.getByText("Registro salvo")).toBeVisible();

    await page.getByRole("link", { name: "Ver histórico" }).click();
    await expect(
      page.getByRole("heading", { name: "Sono", level: 2 }),
    ).toBeVisible();
    await expect(page.getByText("6h 30m").first()).toBeVisible();
  });

  test("multiplos check-ins no mesmo dia sao aceitos", async ({ page }) => {
    await expect(
      page.getByText("Você pode fazer mais de um check-in por dia"),
    ).toBeVisible();

    // Contagem relativa: o teste afirma o invariante (dois registros no mesmo
    // dia sao aceitos), nao o tamanho do seed.
    await page.getByRole("link", { name: "Ver histórico" }).click();
    // Espera a tabela existir antes de medir: sem isso o baseline e lido como 0
    // durante a navegacao e a comparacao passa a ser sobre nada.
    await expect(checkinsTable(page)).toBeVisible();
    const before = await checkinsTable(page).getByRole("row").count();
    expect(before).toBeGreaterThan(1);

    await navigateTo(page, "Meu Humor");
    await page.getByRole("button", { name: "Salvar check-in" }).click();
    await page.getByRole("button", { name: "Salvar check-in" }).click();

    await page.getByRole("link", { name: "Ver histórico" }).click();
    await expect(checkinsTable(page).getByRole("row")).toHaveCount(before + 2);
  });
});

test.describe("Historico", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHydrated(page, "/historico");
  });

  test("lista os check-ins do mais recente para o mais antigo", async ({
    page,
  }) => {
    // Cabecalho + ao menos os 7 registros recentes explicitos do seed.
    expect(await checkinsTable(page).getByRole("row").count()).toBeGreaterThan(7);
    const dates = await checkinsTable(page).getByRole("row").locator("td:first-child").allTextContents();
    const instants = dates.map((value) => {
      const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/.exec(value);
      if (!match) throw new Error(`Data inesperada no historico: ${value}`);
      const [, day, month, year, hour, minute] = match;
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`).getTime();
    });
    expect(instants).toEqual([...instants].sort((a, b) => b - a));
  });

  test("energia ausente do seed aparece como 'Sem registro'", async ({
    page,
  }) => {
    const table = checkinsTable(page);
    await expect(table.getByText("Sem registro").first()).toBeVisible();
  });

  test("qualidade de sono ausente nao vira zero", async ({ page }) => {
    // O seed tem uma noite com duracao registrada e qualidade ausente.
    await expect(page.getByText("7h 45m")).toBeVisible();
  });
});

test.describe("Diario", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHydrated(page, "/diario");
  });

  test("e privado por padrao", async ({ page }) => {
    await expect(page.getByText("Privado", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Suas anotações são privadas por padrão"),
    ).toBeVisible();
  });

  test("autosave grava rascunho com debounce", async ({ page }) => {
    const status = page.getByTestId("autosave-status");
    await expect(status).toHaveText("");

    await page.getByLabel("Anotação").fill("Texto em construcao");
    await expect(status).toHaveText("Salvando rascunho...");
    await expect(status).toHaveText("Rascunho salvo", { timeout: 5_000 });

    // O autosave nunca promove a entrada a "saved".
    const draft = page
      .getByRole("listitem")
      .filter({ hasText: "Texto em construcao" });
    await expect(draft).toBeVisible();
    await expect(draft.getByText("Rascunho")).toBeVisible();
  });

  test("salvar uma anotacao limpa o formulario e a lista", async ({ page }) => {
    await page.getByRole("textbox", { name: "Título" }).fill("Anotacao E2E");
    await page.getByLabel("Anotação").fill("Conteudo da anotacao E2E.");
    await page.getByRole("button", { name: "Gratidão" }).click();
    await page.getByRole("button", { name: "Salvar anotação" }).click();

    await expect(page.getByRole("textbox", { name: "Título" })).toHaveValue("");
    await expect(page.getByTestId("autosave-status")).toHaveText("");
    await expect(page.getByText("Anotacao E2E", { exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Anotações \(\d+\)/ })).toBeVisible();
  });

  test("lixeira: mover, restaurar e excluir em definitivo", async ({ page }) => {
    const ativas = page.getByRole("tab", { name: /Anotações/ });
    const lixeira = page.getByRole("tab", { name: /Lixeira/ });

    const activeBefore = Number((await ativas.textContent())?.match(/\d+/)?.[0]);
    const trashBefore = Number((await lixeira.textContent())?.match(/\d+/)?.[0]);
    expect(activeBefore).toBeGreaterThan(0);
    expect(trashBefore).toBeGreaterThan(0);

    await page
      .getByRole("button", { name: /Mover Semana puxada para a lixeira/ })
      .click();
    await expect(ativas).toHaveText(`Anotações (${activeBefore - 1})`);
    await expect(lixeira).toHaveText(`Lixeira (${trashBefore + 1})`);

    await lixeira.click();
    await expect(page.getByText(/Expurgo em \d+ dias/).first()).toBeVisible();

    await page.getByRole("button", { name: "Restaurar anotação" }).first().click();
    await expect(ativas).toHaveText(`Anotações (${activeBefore})`);

    // Exclusao permanente exige confirmacao explicita.
    await page.getByRole("button", { name: "Excluir em definitivo" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Esta ação não pode ser desfeita");

    await dialog.getByRole("button", { name: "Cancelar" }).click();
    await expect(lixeira).toHaveText(`Lixeira (${trashBefore})`);

    await page.getByRole("button", { name: "Excluir em definitivo" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Excluir em definitivo" })
      .click();
    await expect(lixeira).toHaveText(`Lixeira (${trashBefore - 1})`);
  });
});

test.describe("Metas", () => {
  test.beforeEach(async ({ page }) => {
    await gotoHydrated(page, "/metas");
  });

  test("progresso e streak derivam dos eventos registrados", async ({
    page,
  }) => {
    // Meta diaria "Meditar": 10 min hoje, eventos em 4 dias consecutivos.
    const meditar = goalCard(page, "Meditar");
    await expect(meditar.getByTestId(/^progress-/)).toHaveText("10 de 10 min");
    await expect(meditar.getByTestId(/^streak-/)).toContainText("4 dias seguidos");

    await goalCard(page, "Meditar")
      .getByRole("button", { name: "Registrar" })
      .click();

    await expect(meditar.getByTestId(/^progress-/)).toHaveText("20 de 10 min");
    await expect(meditar.getByTestId(/^streak-/)).toContainText("4 dias seguidos");
  });

  test("a barra de progresso e acessivel", async ({ page }) => {
    const bar = page.getByRole("progressbar", { name: "Progresso de Meditar" });
    await expect(bar).toHaveAttribute("aria-valuenow", "100");
    await expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  test("pausar e retomar altera o status da meta", async ({ page }) => {
    const card = goalCard(page, "Dormir melhor");
    await expect(card).toContainText("Ativa");

    await card.getByRole("button", { name: "Pausar" }).click();
    await expect(card).toContainText("Pausada");

    await card.getByRole("button", { name: "Retomar" }).click();

    /*
     * A tela captura falha de rede e mostra o erro num banner, sem quebrar - o
     * card simplesmente continua "Pausada". Sem olhar o banner, essa falha
     * reprova como "esperava Ativa, recebi Pausada", que descreve o sintoma e
     * esconde a causa.
     *
     * Asserir a **ausencia do erro** primeiro faz o teste dizer o que
     * aconteceu de verdade quando a requisicao falha.
     */
    await expect(
      page.locator("[role=alert]").filter({ hasText: /./ }),
    ).toHaveCount(0);
    await expect(card).toContainText("Ativa");
  });

  test("cria uma meta quantitativa com unidade", async ({ page }) => {
    await page.getByLabel("Título").fill("Beber agua");
    await page.getByLabel("Tipo").selectOption("quantitative");
    await page.getByLabel("Recorrência").selectOption("daily");
    await page.getByLabel("Alvo").fill("8");
    await page.getByLabel("Unidade").fill("copos");
    await page.getByRole("button", { name: "Criar meta", exact: true }).click();

    const card = goalCard(page, "Beber agua");
    await expect(card).toContainText("Quantitativa");
    await expect(card).toContainText("0 de 8 copos");
    await expect(card).toContainText("Sem sequência");
  });

  test("meta sem titulo e rejeitada com mensagem em portugues", async ({
    page,
  }) => {
    const before = await page.getByRole("listitem").count();
    await page.getByRole("button", { name: "Criar meta", exact: true }).click();

    // Escopo no formulario: o route announcer do Next tambem tem role=alert.
    const erro = page.locator("form").getByRole("alert");
    await expect(erro).toHaveText("Informe um título para a meta.");

    // Nenhuma meta adicional foi criada.
    await expect(page.getByRole("listitem")).toHaveCount(before);
  });
});

test.describe("Perfil e Configuracoes", () => {
  test("perfil conta os registros do usuario sem analisar", async ({ page }) => {
    await gotoHydrated(page, "/perfil");
    await expect(page.getByText("Contagem simples, sem análise")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Salvar alterações" }),
    ).toBeDisabled();

    // As contagens refletem o backend real e podem incluir registros criados
    // pelas jornadas anteriores do mesmo projeto Playwright.
    const registros = page.locator("dl");
    await expect(
      registros.locator("div").filter({ hasText: "Check-ins" }),
    ).toBeVisible();
    await expect(
      registros.locator("div").filter({ hasText: "Anotações no diário" }),
    ).toContainText(/\d+/);
    await expect(
      registros.locator("div").filter({ hasText: "Metas ativas" }),
    ).toContainText(/\d+/);
  });

  test("configuracoes sensiveis nascem desligadas (opt-in)", async ({ page }) => {
    await gotoHydrated(page, "/configuracoes");

    const ciclo = page.getByRole("switch", { name: "Acompanhamento do ciclo" });
    const sessoes = page.getByRole("switch", {
      name: "Sessões multimodais (Beta)",
    });

    await expect(ciclo).toHaveAttribute("aria-checked", "false");
    await expect(sessoes).toHaveAttribute("aria-checked", "false");

    await ciclo.click();
    await expect(ciclo).toHaveAttribute("aria-checked", "true");
    await ciclo.click();
    await expect(ciclo).toHaveAttribute("aria-checked", "false");
  });

  test("configuracoes declara privacidade do diario e revogacao", async ({
    page,
  }) => {
    await gotoHydrated(page, "/configuracoes");
    await expect(
      page.getByText("nunca aparece em registros do sistema"),
    ).toBeVisible();
    await expect(
      page.getByText("pode ser revogado a qualquer momento"),
    ).toBeVisible();
  });
});
