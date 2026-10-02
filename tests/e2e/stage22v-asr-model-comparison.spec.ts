import { expect, test } from "@playwright/test";



const ROUTE = "/qa/asr-ab";

test.describe("Stage 22-V - comparacao A/B de modelos de ASR", () => {
  test("a rota de QA responde e mostra a fixture falada", async ({ page }) => {
    const response = await page.goto(ROUTE);
    expect(response?.status()).toBe(200);

    await expect(
      page.getByRole("heading", { name: "Comparar modelos de transcrição" }),
    ).toBeVisible();
    await expect(page.getByText("Hoje eu não vou compartilhar a tela")).toBeVisible();
    await expect(page.getByText("(silêncio)")).toBeVisible();
    await expect(page.getByText("Agora eu voltei a falar")).toBeVisible();
  });

  test("abrir a pagina nao baixa modelo nenhum", async ({ page }) => {
    const modelRequests: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.includes("/asr/models/") || url.endsWith(".onnx")) modelRequests.push(url);
    });

    await page.goto(ROUTE);
    await expect(
      page.getByRole("heading", { name: "Comparar modelos de transcrição" }),
    ).toBeVisible();

    /*
      Zero, e nao "poucos".

      O caminho que esta sendo recusado aqui e o que faria `/qa/asr-ab` custar
      251,8 MB para quem so abriu a pagina para ler o roteiro.
    */
    expect(modelRequests).toEqual([]);
  });

  test("o tamanho aparece antes de qualquer download", async ({ page }) => {
    await page.goto(ROUTE);

    await expect(page.getByText("Base q8 79.7 MB")).toBeVisible();
    await expect(page.getByText("Small q8 251.8 MB")).toBeVisible();
    await expect(page.getByText("331.5 MB")).toBeVisible();
    await expect(page.getByText("prefira Wi-Fi")).toBeVisible();

    // E nada de gravar antes de preparar.
    await expect(page.getByRole("button", { name: "Começar a gravar" })).toHaveCount(0);
  });

  test("a pagina nao e indexavel e nao aparece na navegacao do produto", async ({ page }) => {
    await page.goto(ROUTE);
    const robots = await page
      .locator('meta[name="robots"]')
      .getAttribute("content");
    expect(robots).toContain("noindex");

    // Nenhum link do produto leva aqui.
    await page.goto("/sessoes");
    expect(await page.locator(`a[href*="${ROUTE}"]`).count()).toBe(0);
  });

  test("o preflight de diagnostico existe, e nao baixa nada sozinho", async ({ page }) => {
    /*
      A H1-B devolveu `load_failed` sem causa. O preflight existe para responder
      ONDE quebrou sem pedir microfone, transcricao ou uma segunda gravacao.
    */
    const modelRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/asr/models/")) modelRequests.push(request.url());
    });

    await page.goto(ROUTE);
    await expect(
      page.getByRole("button", { name: "Small q8 sozinho" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Base q8, descarte, Small q8" }),
    ).toBeVisible();
    await expect(page.getByText("Nao liga o")).toBeVisible();

    // As duas variantes existem porque respondem perguntas diferentes.
    await expect(page.getByText("cabe neste aparelho")).toBeVisible();

    // E nada desceu so por abrir.
    expect(modelRequests).toEqual([]);
  });

  test("o voto so existe depois de haver resultado", async ({ page }) => {
    await page.goto(ROUTE);
    for (const label of ["Base melhor", "Small melhor", "Qualidade semelhante", "Nenhum aceitável"]) {
      await expect(page.getByRole("button", { name: label })).toHaveCount(0);
    }
  });
});
