import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";

import { gotoHydrated } from "./hydrated";
import {
  cleanupAccounts,
  createPersonalAccount,
  createProfessionalAccount,
  qaAdmin,
  signIn,
} from "./professional-fixtures";



test.describe("Stage 29 / F6 - perfil de confianca", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Contrato de dados independe do viewport; visual no design pass.");
    test.setTimeout(180_000);
  });

  test("declarado x verificado na pagina publica; nada sensivel; edicao pelo Perfil profissional", async ({
    browser,
    baseURL,
  }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Trust Profile QA");
      created.push(pro.userId);
      const reader = await createPersonalAccount(admin, testInfo.project.name, "Leitora Trust QA");
      created.push(reader.userId);
      const { data: pub, error } = await admin
        .from("professional_public_profiles")
        .insert({
          user_id: pro.userId,
          listed: true,
          display_name: "Trust Profile QA",
          city: "Curitiba",
          state: "PR",
          modalities: ["online"],
          areas: ["ansiedade"],
          languages: ["pt"],
        })
        .select("slug")
        .single();
      if (error) throw error;
      const digest = createHash("sha256").update(`trust-${pro.userId}`).digest("hex");
      const insert = await admin.from("professional_credentials").insert([
        {
          user_id: pro.userId, kind: "education", title: "Psicologia", institution: "Univ QA",
          start_year: 2010, end_year: 2015, trust_state: "verified", verified_at: new Date().toISOString(),
          evidence_digest: digest, verification_source: "document_manual", policy_version: "e2e", position: 0,
        },
        {
          user_id: pro.userId, kind: "experience", title: "Clinica QA", institution: "Org QA",
          start_year: 2016, end_year: null, trust_state: "declared", position: 0,
        },
      ]);
      if (insert.error) throw insert.error;

      // Leitora: pagina publica factual.
      const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await readerContext.newPage();
      try {
        await signIn(page, baseURL!, reader);
        await gotoHydrated(page, `/profissionais/${pub.slug}`);
        const trust = page.getByTestId("trust-facts");
        await expect(trust.getByRole("heading", { name: "O que a Elyra verificou" })).toBeVisible();
        await expect(trust.getByTestId("verification-disclaimer")).toHaveText(
          "A verificação confirma as informações apresentadas e não representa avaliação da qualidade profissional.",
        );
        await expect(trust.locator("[data-trust-state='verified']")).toContainText("Formação · Psicologia");
        await expect(trust.locator("[data-trust-state='verified']")).toContainText("Verificado");
        await expect(trust.locator("[data-trust-state='declared']")).toContainText("Experiência · Clinica QA");
        await expect(trust.locator("[data-trust-state='declared']")).toContainText("Declarado");
        const html = await page.content();
        for (const forbidden of [digest, "document_manual", "evidence", "CPF", "RG ", "estrela", "Recomendado", "Top "]) {
          expect(html, forbidden).not.toContain(forbidden);
        }
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);

        // Card da descoberta: so fatos.
        await gotoHydrated(page, `/profissionais?q=${encodeURIComponent("Trust Profile QA")}`);
        const card = page.getByTestId("directory-card").first();
        await expect(card).toContainText("conferido em");
        await expect(card).not.toContainText(/nota|estrela|ranking|recomendad|top/i);
      } finally {
        await readerContext.close();
      }

      // Profissional: editar item verificado o devolve a declarado.
      const proContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const proPage = await proContext.newPage();
      try {
        await signIn(proPage, baseURL!, pro);
        await gotoHydrated(proPage, "/pro/perfil#credenciais");
        const education = proPage.getByTestId("credentials-education");
        await expect(education).toContainText("Verificado pela Elyra");
        await education.getByRole("button", { name: "Editar Psicologia" }).click();
        const form = proPage.getByTestId("credential-form-education");
        await expect(form).toContainText("voltar a “declarado”");
        await form.getByLabel("Instituição").fill("Univ QA (campus)");
        await form.getByRole("button", { name: "Salvar item" }).click();
        await expect(education).toContainText("Declarado pelo profissional");
        const row = await admin.from("professional_credentials").select("trust_state, evidence_digest").eq("user_id", pro.userId).eq("kind", "education").single();
        expect(row.data).toEqual({ trust_state: "declared", evidence_digest: null });
      } finally {
        await proContext.close();
      }
    } finally {
      await admin.from("professional_credentials").delete().in("user_id", created);
      await cleanupAccounts(admin, created);
    }
  });
});
