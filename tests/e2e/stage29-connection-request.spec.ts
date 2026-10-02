import { expect, test, type Browser } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import {
  cleanupAccounts,
  createPersonalAccount,
  createProfessionalAccount,
  qaAdmin,
  signIn,
  type QaAccount,
} from "./professional-fixtures";

/**
 * Fluxo B (auditoria de drift, GAP-01): a pessoa encontra o profissional na
 * descoberta, pede acompanhamento, o profissional recebe na Central de
 * solicitacoes e aceita. Mesma relationship do convite; nada compartilhado.
 */

async function contextFor(browser: Browser, baseURL: string, account: QaAccount) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "pt-BR" });
  const page = await context.newPage();
  await signIn(page, baseURL, account);
  return { context, page };
}

test.describe("Stage 29 - pedido de acompanhamento pela descoberta", () => {
  test("pessoa pede pela descoberta, profissional recebe e aceita, nada e compartilhado", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.setTimeout(180_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Helena Descoberta");
      const person = await createPersonalAccount(admin, testInfo.project.name, "Marina Descoberta");
      created.push(pro.userId, person.userId);
      const slug = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
      const { error } = await admin.from("professional_public_profiles").insert({
        user_id: pro.userId,
        slug,
        listed: true,
        display_name: "Helena Descoberta",
        city: "Recife",
        state: "PE",
        modalities: ["online"],
        areas: ["ansiedade"],
        languages: ["pt"],
      });
      if (error) throw error;

      // 1. Pessoa: perfil publico -> Solicitar acompanhamento.
      const personSide = await contextFor(browser, baseURL, person);
      await gotoHydrated(personSide.page, `/profissionais/${slug}`);
      const card = personSide.page.getByTestId("directory-accompaniment");
      await expect(card).toContainText("Pedir não compartilha nenhum dado");
      await card.getByRole("button", { name: "Solicitar acompanhamento" }).dblclick();
      await expect(card.getByRole("status")).toContainText("Solicitação enviada");
      await gotoHydrated(personSide.page, `/profissionais/${slug}`);
      await expect(card).toHaveAttribute("data-state", "pending");
      const { data: rows } = await admin
        .from("professional_connections")
        .select("id,status,invited_by_user_id")
        .eq("client_user_id", person.userId);
      expect(rows).toEqual([{ id: rows![0]!.id, status: "pending", invited_by_user_id: person.userId }]);
      const connectionId = rows![0]!.id;

      // Recusas: slug invalido, perfil inexistente, anonimo.
      expect((await personSide.page.request.post("/api/professional/connection-requests", { data: { slug: "x" } })).status()).toBe(400);
      expect(
        (await personSide.page.request.post("/api/professional/connection-requests", { data: { slug: "0000000000000000" } })).status(),
      ).toBe(404);
      const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      expect((await anon.request.post(`${baseURL}/api/professional/connection-requests`, { data: { slug } })).status()).toBe(401);
      await anon.close();

      // Configuracoes mostra o nome, nao o UUID.
      await gotoHydrated(personSide.page, "/configuracoes/privacidade");
      await expect(personSide.page.getByText("Helena Descoberta").first()).toBeVisible();
      await expect(personSide.page.getByText(pro.userId)).toHaveCount(0);

      // 2. Profissional: aviso in-app e Central de solicitacoes.
      const { count: notices } = await admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", pro.userId)
        .eq("kind", "connection_requested");
      expect(notices).toBe(1);
      const proSide = await contextFor(browser, baseURL, pro);
      await gotoHydrated(proSide.page, "/pro/solicitacoes");
      await expect(proSide.page.getByText("Solicitação de acompanhamento", { exact: true })).toBeVisible();
      await proSide.page.getByRole("button", { name: "Aceitar" }).click();
      await expect(proSide.page.getByText("Nenhuma solicitação esperando resposta")).toBeVisible();

      // 3. Mesma relationship, ativa, sem grant; a pessoa e avisada.
      const { data: after } = await admin.from("professional_connections").select("id,status").eq("client_user_id", person.userId);
      expect(after).toEqual([{ id: connectionId, status: "active" }]);
      const { count: grants } = await admin
        .from("sharing_permissions")
        .select("id", { count: "exact", head: true })
        .eq("connection_id", connectionId);
      expect(grants).toBe(0);
      const { count: accepted } = await admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", person.userId)
        .eq("kind", "relationship_created");
      expect(accepted).toBe(1);
      await gotoHydrated(personSide.page, `/profissionais/${slug}`);
      await expect(card.getByTestId("relationship-state")).toHaveText("Profissional conectado");
      await expect(card.getByRole("button", { name: "Solicitar acompanhamento" })).toHaveCount(0);

      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await cleanupAccounts(admin, created);
    }
  });
});
