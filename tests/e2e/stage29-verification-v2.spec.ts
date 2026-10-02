import { expect, test, type Browser } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import { cleanupAccounts, createPersonalAccount, qaAdmin, signIn, type QaAccount } from "./professional-fixtures";

/**
 * Verificacao profissional V2 (ADR-0028) contra o banco real.
 *
 * Duas execucoes, porque o servidor le o ambiente na subida:
 *
 * - MODO GRATUITO (padrao da suite, sem variavel nenhuma): prova que, sem
 *   provider pago e sem fonte oficial automatizavel, o envio funciona, grava
 *   evidencia pelo executor confiavel e cai na fila humana — sem 500, sem
 *   recusa, sem mencao a pagamento.
 *
 * - FIXTURE LOCAL (`ELYRA_VERIFICATION_FIXTURES=local`, execucao dedicada):
 *   prova a aprovacao automatica ponta a ponta, a correcao e o timeout, com o
 *   interruptor `accept_fixture_evidence` ligado so durante o teste.
 */

const FIXTURES = process.env.ELYRA_VERIFICATION_FIXTURES === "local";

async function contextFor(browser: Browser, baseURL: string, account: QaAccount) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "pt-BR" });
  const page = await context.newPage();
  await signIn(page, baseURL, account);
  return { context, page };
}

async function submit(page: import("@playwright/test").Page, registrationNumber: string) {
  expect((await page.request.put("/api/professional/onboarding", { data: { step: "identidade", data: { confirmed: true } } })).status()).toBe(200);
  expect(
    (await page.request.put("/api/professional/onboarding", {
      data: { step: "registro", data: { councilRegion: "06", registrationNumber, specialty: "Psicologia" } },
    })).status(),
  ).toBe(200);
  const started = Date.now();
  const response = await page.request.post("/api/professional/onboarding");
  return { status: response.status(), body: await response.json(), ms: Date.now() - started };
}

test.describe("Verificacao V2 — modo gratuito", () => {
  test.skip(FIXTURES, "Esta execucao prova o modo sem fixture.");

  test("sem provider pago nem fonte oficial automatizavel: envio funciona e vai para a fila humana", async ({ browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Fluxo de servidor: um projeto basta.");
    if (!baseURL) throw new Error("baseURL ausente.");
    test.setTimeout(120_000);
    const admin = qaAdmin();
    const account = await createPersonalAccount(admin, testInfo.project.name, "Clara Gratuita");
    try {
      const side = await contextFor(browser, baseURL, account);
      const result = await submit(side.page, "123456");
      expect(result.status).toBe(200);
      expect(result.body.data).toMatchObject({ verificationStatus: "pending", policyVersion: "stage29.v2" });

      const { data: evidence } = await admin
        .from("professional_verification_evidence")
        .select("fact_type,source_type,provider,status,detail,assurance")
        .eq("professional_user_id", account.userId);
      const byFact = (fact: string) => evidence!.filter((row) => row.fact_type === fact);
      expect(byFact("professional_registry")).toContainEqual(
        expect.objectContaining({ provider: "cfp_official_open_data", status: "SOURCE_UNAVAILABLE", detail: "unverified_contract" }),
      );
      expect(byFact("identity_match")).toEqual([
        expect.objectContaining({ status: "UNVERIFIED", assurance: "identity_declared" }),
      ]);
      expect(evidence!.some((row) => row.source_type === "qa_fixture" || row.source_type === "optional_provider")).toBe(false);
      const { data: profile } = await admin.from("professional_profiles").select("verification_status").eq("user_id", account.userId).single();
      expect(profile!.verification_status).toBe("pending");

      await gotoHydrated(side.page, "/area-profissional");
      await expect(side.page.getByTestId("professional-state-card")).toHaveAttribute("data-professional-state", "UNDER_AUTOMATED_REVIEW");
      await expect(side.page.locator("body")).not.toContainText(/InfoSimples|Datavalid|cr[ée]dito|saldo|pague|compre/i);
      await side.context.close();
    } finally {
      await cleanupAccounts(admin, [account.userId]);
    }
  });
});

test.describe("Verificacao V2 — fixture local (execucao dedicada)", () => {
  test.skip(!FIXTURES, "Rode com ELYRA_VERIFICATION_FIXTURES=local.");

  test("fixture: aprovacao provada, correcao e timeout sem erro", async ({ browser, baseURL }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Fluxo de servidor: um projeto basta.");
    if (!baseURL) throw new Error("baseURL ausente.");
    test.setTimeout(180_000);
    const admin = qaAdmin();
    const created: string[] = [];
    await admin.from("professional_verification_settings").update({ accept_fixture_evidence: true }).eq("singleton", true);
    try {
      // 0001: ativo, mesmo titular, identidade de fixture conferida → VERIFIED.
      const approved = await createPersonalAccount(admin, testInfo.project.name, "Rita Aprovada");
      created.push(approved.userId);
      const a = await contextFor(browser, baseURL, approved);
      const okResult = await submit(a.page, "120001");
      expect(okResult.body.data.verificationStatus).toBe("verified");
      // A trilha nao e legivel nem pelo service_role (PRO-1): quem a le e o
      // proprio profissional, pela projecao dele.
      const history = (await (await a.page.request.get("/api/professional/verification")).json()).data as Array<{
        to_status: string; source: string; actor_role: string;
      }>;
      expect(history.filter((event) => event.to_status === "verified")).toEqual([
        expect.objectContaining({ source: "elyra_automated_verification", actor_role: "system" }),
      ]);
      await gotoHydrated(a.page, "/pro/dashboard");
      await expect(a.page).toHaveURL(/\/pro\/dashboard/);
      await a.context.close();

      // 0003: nao encontrado → correcao (pode ser digitacao), nunca recusa.
      const typo = await createPersonalAccount(admin, testInfo.project.name, "Rui Digitou");
      created.push(typo.userId);
      const b = await contextFor(browser, baseURL, typo);
      expect((await submit(b.page, "120003")).body.data.verificationStatus).toBe("needs_correction");
      await b.context.close();

      // 0004: fonte nao responde → timeout curto, fila humana, sem 500.
      const slow = await createPersonalAccount(admin, testInfo.project.name, "Lia Espera");
      created.push(slow.userId);
      const c = await contextFor(browser, baseURL, slow);
      const slowResult = await submit(c.page, "120004");
      expect(slowResult.status).toBe(200);
      expect(slowResult.body.data.verificationStatus).toBe("pending");
      expect(slowResult.ms).toBeLessThan(15_000);
      await c.context.close();
    } finally {
      await admin.from("professional_verification_settings").update({ accept_fixture_evidence: false }).eq("singleton", true);
      await cleanupAccounts(admin, created);
    }
  });
});
