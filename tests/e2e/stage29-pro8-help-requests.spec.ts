import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import {
  cleanupAccounts,
  createPersonalAccount,
  createProfessionalAccount,
  qaAdmin,
  signIn,
  type QaAccount,
} from "./professional-fixtures";



async function contextFor(browser: Browser, baseURL: string, account: QaAccount) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, locale: "pt-BR" });
  const page = await context.newPage();
  await signIn(page, baseURL, account);
  return { context, page };
}

async function a11yAndLayout(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: sem rolagem lateral`).toBeLessThanOrEqual(0);
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

const TEXT = "Queria conversar sobre a semana antes da próxima sessão.";

test.describe("Stage 29 / PRO-8 - pedidos de ajuda", () => {
  test("pessoa envia, profissional marca, pessoa encerra; revogacao corta a leitura", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.setTimeout(240_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Helena Pedidos");
      const person = await createPersonalAccount(admin, testInfo.project.name, "Marina Pedidos");
      const stranger = await createPersonalAccount(admin, testInfo.project.name, "Outra Pessoa");
      created.push(pro.userId, person.userId, stranger.userId);
      const { data: link, error } = await admin
        .from("professional_connections")
        .insert({
          client_user_id: person.userId,
          professional_user_id: pro.userId,
          invited_by_user_id: pro.userId,
          status: "active",
          accepted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;

      // 1. Pessoa: limite antes do campo, SOS na tela, envio com duplo clique.
      const personSide = await contextFor(browser, baseURL, person);
      const p = personSide.page;
      await gotoHydrated(p, "/pedidos");
      const form = p.getByTestId("help-request-form");
      const limit = form.getByTestId("help-request-limit");
      await expect(limit).toContainText("não é um canal de emergência");
      await expect(limit).toContainText("não há prazo de resposta");
      await expect(limit).toContainText("SOS");
      const limitBox = await limit.boundingBox();
      const fieldBox = await form.getByLabel("Seu recado").boundingBox();
      expect(limitBox!.y, "limite vem antes do campo").toBeLessThan(fieldBox!.y);
      // Caminho para ajuda imediata nao depende do botao flutuante (que sai de
      // cena no celular quando cobriria um campo): link no aviso -> contatos.
      const sosLink = limit.getByRole("link", { name: "Ver contatos de ajuda imediata" });
      await expect(sosLink).toBeVisible();
      await sosLink.click();
      await expect(p.getByTestId("help-request-sos").locator("a[href='tel:188']")).toBeInViewport();
      // L-398: fora desse caminho, a lista nao aparece aberta (so no SOS e aqui, sob demanda).
      if (testInfo.project.name === "desktop") await expect(p.locator("[data-elyra-sos]")).toBeVisible();
      await expect(form.getByLabel("Para quem")).toContainText("Helena Pedidos");
      await form.getByLabel("Seu recado").fill(TEXT);
      await form.getByRole("button", { name: "Enviar recado" }).dblclick();
      await expect(form.getByRole("status")).toContainText("Recado enviado");
      await expect(p.getByTestId("help-request-item").first()).toHaveAttribute("data-status", "open");
      await expect(p.getByTestId("help-request-item").first()).toContainText("Para Helena Pedidos");
      const { data: rows } = await admin.from("help_requests").select("id,status,body").eq("client_user_id", person.userId);
      expect(rows?.length, "duplo clique = um pedido").toBe(1);
      const requestId = rows![0]!.id;
      expect(rows![0]!.body).toBe(TEXT);
      await expect(form.getByRole("button", { name: "Enviar recado" })).toBeDisabled();
      await a11yAndLayout(p, "/pedidos");

      // 2. Recusas: anonimo, terceiro, acao fora de papel.
      const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      expect((await anon.request.get(`${baseURL}/api/help-requests`)).status()).toBe(401);
      expect(
        (await anon.request.post(`${baseURL}/api/help-requests`, {
          data: { connectionId: link.id, body: "x", idempotencyKey: crypto.randomUUID() },
        })).status(),
      ).toBe(401);
      await anon.close();
      const strangerSide = await contextFor(browser, baseURL, stranger);
      const list = await strangerSide.page.request.get("/api/help-requests");
      expect((await list.json()).data.requests).toEqual([]);
      expect(
        (await strangerSide.page.request.patch(`/api/help-requests/${requestId}`, { data: { action: "cancel" } })).status(),
      ).toBe(404);
      expect(
        (await strangerSide.page.request.post("/api/help-requests", {
          data: { connectionId: link.id, body: "x", idempotencyKey: crypto.randomUUID() },
        })).status(),
      ).toBe(404);
      await strangerSide.context.close();
      expect((await p.request.patch(`/api/help-requests/${requestId}`, { data: { action: "seen" } })).status()).toBe(409);
      expect((await p.request.patch(`/api/help-requests/${requestId}`, { data: { action: "claim" } })).status()).toBe(400);

      // 3. Aviso sem conteudo.
      const { data: notices } = await admin
        .from("notifications")
        .select("kind,event_key")
        .eq("user_id", pro.userId)
        .eq("kind", "help_request_received");
      expect(notices).toEqual([{ kind: "help_request_received", event_key: `help_request_received:${requestId}` }]);

      // 4. Profissional: le, marca lido e respondido. Nao ha campo de resposta.
      const proSide = await contextFor(browser, baseURL, pro);
      const q = proSide.page;
      await gotoHydrated(q, "/pro/pedidos");
      await expect(q.getByTestId("help-request-pro-note")).toContainText("não têm prazo");
      const item = q.getByTestId("help-request-item").first();
      await expect(item).toContainText("De Marina Pedidos");
      await expect(item).toContainText(TEXT);
      await expect(q.locator("textarea")).toHaveCount(0);
      await a11yAndLayout(q, "/pro/pedidos");
      await item.getByRole("button", { name: "Marcar como lido" }).click();
      await expect(q.getByTestId("help-request-item").first()).toHaveAttribute("data-status", "seen");
      await q.getByTestId("help-request-item").first().getByRole("button", { name: "Marcar como respondido" }).click();
      await expect(q.getByText("Nenhum recado aguardando")).toBeVisible();
      await expect(q.getByTestId("help-request-item").first()).toHaveAttribute("data-status", "responded");

      // 5. Pessoa: avisada, ve "Respondido", encerra.
      const { count: updated } = await admin
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", person.userId)
        .eq("kind", "help_request_updated");
      expect(updated).toBe(1);
      await gotoHydrated(p, "/pedidos");
      const mine = p.getByTestId("help-request-item").first();
      await expect(mine).toHaveAttribute("data-status", "responded");
      await mine.getByRole("button", { name: "Encerrar" }).click();
      await expect(p.getByTestId("help-request-item").first()).toHaveAttribute("data-status", "closed");

      // 5b. Tema escuro (onde o contraste ja falhou antes, L-320).
      await p.emulateMedia({ colorScheme: "dark" });
      await gotoHydrated(p, "/pedidos");
      await a11yAndLayout(p, "/pedidos escuro");
      await q.emulateMedia({ colorScheme: "dark" });
      await gotoHydrated(q, "/pro/pedidos");
      await a11yAndLayout(q, "/pro/pedidos escuro");

      // 6. Revogar o vinculo: o profissional deixa de ver na hora.
      await admin
        .from("professional_connections")
        .update({ status: "ended", ended_at: new Date().toISOString(), ended_by_user_id: person.userId })
        .eq("id", link.id);
      await gotoHydrated(q, "/pro/pedidos");
      await expect(q.getByTestId("help-request-item")).toHaveCount(0);
      await gotoHydrated(p, "/pedidos");
      await expect(p.getByTestId("help-request-item")).toHaveCount(1);
      await expect(p.getByText("Nenhum profissional disponível para recados")).toBeVisible();

      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await admin.from("help_requests").delete().in("client_user_id", created);
      await cleanupAccounts(admin, created);
    }
  });
});
