import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";

test.describe("Stage 09 - PedroCore textual fail-closed", () => {
  test("consentimento e obrigatorio antes da chamada", async ({ page }) => {
    let insightRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/reports/insights") {
        insightRequests += 1;
      }
    });

    await gotoHydrated(page, "/relatorios");
    await page.getByRole("button", { name: "Interpretar com IA" }).click();

    await expect(page.getByRole("status")).toContainText(
      "Autorize explicitamente",
    );
    expect(insightRequests).toBe(0);
  });

  test("indisponibilidade da IA preserva o relatorio deterministico", async ({
    page,
  }) => {
    const externalAiRequests: string[] = [];
    page.on("request", (request) => {
      const url = request.url().toLowerCase();
      if (
        url.includes("gemini") ||
        url.includes("googleapis.com") ||
        url.includes("openai") ||
        url.includes("pedrocore")
      ) {
        externalAiRequests.push(url);
      }
    });

    await gotoHydrated(page, "/relatorios");
    await page
      .getByLabel(/Autorizo o envio deste snapshot minimizado/)
      .check();
    await page.getByRole("button", { name: "Interpretar com IA" }).click();

    await expect(page.getByRole("status")).toContainText(
      "interpretação por IA está indisponível",
    );
    await expect(
      page.getByRole("heading", { name: "Evolução ao longo do tempo" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Insights do seu período" }),
    ).toBeVisible();
    expect(externalAiRequests).toEqual([]);
  });
});
