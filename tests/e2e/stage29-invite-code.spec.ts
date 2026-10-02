import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import { axeBothSchemes } from "./offline-a11y";
import { cleanupAccounts, createPersonalAccount, createProfessionalAccount, qaAdmin, signIn, type QaAccount } from "./professional-fixtures";

/**
 * Codigo curto de convite (L-432/L-433/L-434/L-435), ponta a ponta:
 * profissional gera `ELY-XXXXX-XXXXX` -> pessoa escolhe "Tenho um codigo" em
 * /profissionais -> digita do jeito que der (caixa baixa, sem hifen) -> confere
 * -> aceita -> vinculo ativo, ZERO grants, aviso ao profissional; repetir e
 * idempotente so para ela; outra pessoa recebe o mesmo "indisponivel" de um
 * codigo inventado; cancelado e expirado tambem; o legado por UUID sumiu; o
 * codigo nao fica em storage, URL nem requisicao fora do corpo do POST.
 */

test.setTimeout(240_000);

const SHORT = /^ELY-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

async function open(browser: Browser, baseURL: string, account: QaAccount) {
  const context = await browser.newContext({ ...test.info().project.use, baseURL, storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await signIn(page, baseURL, account);
  return { context, page };
}

async function redeem(request: APIRequestContext, token: string, action: "preview" | "accept" | "decline") {
  const response = await request.post("/api/professional/invites/redeem", { data: { token, action } });
  return { status: response.status(), body: await response.text() };
}

async function noHorizontalScroll(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), label).toBeLessThanOrEqual(0);
}

/** Tudo o que o navegador guarda, como texto: storage, IndexedDB e Cache Storage. */
async function storedText(page: Page) {
  return page.evaluate(async () => {
    const parts: string[] = [];
    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i += 1) parts.push(`${store.key(i)}=${store.getItem(store.key(i)!)}`);
    }
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const name of Array.from(db.objectStoreNames)) {
        const rows = await new Promise<unknown[]>((resolve) => {
          const all = db.transaction(name).objectStore(name).getAll();
          all.onsuccess = () => resolve(all.result);
          all.onerror = () => resolve([]);
        });
        parts.push(JSON.stringify(rows));
      }
      db.close();
    }
    for (const key of await caches.keys()) {
      for (const request of await (await caches.open(key)).keys()) parts.push(request.url);
    }
    return parts.join("\n");
  });
}

test("codigo curto: gerar, digitar, conferir, aceitar, zero grants, aviso, idempotencia, leakage", async ({ browser, baseURL }, testInfo) => {
  const admin = qaAdmin();
  const created: string[] = [];
  try {
    const pro = await createProfessionalAccount(admin, testInfo.project.name, "Helena Código");
    const person = await createPersonalAccount(admin, testInfo.project.name, "Marina Código");
    const other = await createPersonalAccount(admin, testInfo.project.name, "Outra Pessoa Código");
    created.push(pro.userId, person.userId, other.userId);

    // 1. Profissional gera o convite na Central de solicitacoes.
    const proSide = await open(browser, baseURL!, pro);
    await gotoHydrated(proSide.page, "/pro/solicitacoes");
    await expect(proSide.page.getByTestId("invite-environment")).toContainText("Ambiente local");
    await expect(proSide.page.getByTestId("invite-environment")).toContainText("mesmo ambiente local");
    await proSide.page.getByRole("button", { name: "Gerar convite" }).click();
    const panel = proSide.page.getByTestId("invite-created");
    await expect(panel).toBeVisible();
    const code = (await panel.getByTestId("invite-code").textContent())!.trim();
    expect(code).toMatch(SHORT);
    await expect(panel).toContainText("Código de convite");
    await expect(panel.getByRole("button", { name: "Copiar código" })).toBeVisible();
    await proSide.context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await panel.getByRole("button", { name: "Copiar link" }).click();
    const copiedLink = new URL(await proSide.page.evaluate(() => navigator.clipboard.readText()));
    expect(copiedLink.origin).toBe(new URL(baseURL!).origin);
    expect(copiedLink.pathname).toBe("/convite");
    expect(copiedLink.search).toBe("");
    expect(copiedLink.hash.length).toBeGreaterThan(1);
    await expect(panel.getByRole("button", { name: "Cancelar convite" })).toBeVisible();
    await expect(proSide.page.getByText(/token/i)).toHaveCount(0);
    await axeBothSchemes(proSide.page, "/pro/solicitacoes com codigo");

    // 2. Pessoa: os dois caminhos no topo de /profissionais; B abre /convite.
    const personSide = await open(browser, baseURL!, person);
    const p = personSide.page;
    const requests: string[] = [];
    p.on("request", (request) => requests.push(`${request.url()} ${request.headers().referer ?? ""}`));
    await gotoHydrated(p, "/profissionais");
    const paths = p.getByTestId("connect-paths");
    await expect(paths.getByText("Buscar profissionais")).toBeVisible();
    await expect(paths.getByText("Tenho um código de convite")).toBeVisible();
    await noHorizontalScroll(p, "/profissionais");
    await paths.getByRole("link", { name: /Tenho um código de convite/ }).click();
    await expect(p).toHaveURL(/\/convite\?returnTo=%2Fprofissionais$/);
    await p.waitForSelector("html[data-hydrated='true']");

    // Entrada invalida: mensagem local, sem ida ao servidor.
    await p.getByLabel("Código de convite").fill("ELY-8K4M2-9QXZU");
    await p.getByRole("button", { name: "Ver convite" }).click();
    await expect(p.locator("#invite-error")).toHaveText("Confira o código informado.");
    await expect(p.getByLabel("Código de convite")).toHaveAttribute("aria-invalid", "true");

    // Digitado "do jeito que der": caixa baixa, sem hifen, com espacos.
    await p.getByLabel("Código de convite").fill(`  ${code.toLowerCase().replaceAll("-", "")}  `);
    await p.getByRole("button", { name: "Ver convite" }).click();
    await expect(p.getByRole("heading", { name: "Helena Código" })).toBeVisible();
    await expect(p.getByTestId("invite-no-sharing")).toContainText(
      "Aceitar o convite cria o vínculo. Nenhum dado é compartilhado automaticamente.",
    );
    await expect(p.getByTestId("invite-steps").locator("[aria-current='step']")).toContainText("Conferir profissional");
    await axeBothSchemes(p, "/convite conferir");

    await p.getByRole("button", { name: "Aceitar convite" }).click();
    const accepted = p.getByTestId("invite-accepted");
    await expect(accepted.getByRole("status")).toHaveText("Você está conectado com Helena Código. Nada foi compartilhado.");
    await expect(accepted.getByRole("link", { name: "Gerenciar compartilhamento" })).toBeVisible();
    await expect(accepted.getByRole("link", { name: "Agora não" })).toHaveAttribute("href", "/profissionais");
    await axeBothSchemes(p, "/convite aceito");
    await noHorizontalScroll(p, "/convite aceito");

    // 3. Banco: vinculo ativo e ZERO grants, em todos os escopos.
    const { data: rows } = await admin
      .from("professional_connections")
      .select("id,status")
      .eq("client_user_id", person.userId)
      .eq("professional_user_id", pro.userId);
    expect(rows).toHaveLength(1);
    expect(rows![0]!.status).toBe("active");
    const connectionId = rows![0]!.id;
    await expect(accepted.getByRole("link", { name: "Pedir horário" })).toHaveAttribute("href", `/agenda?vinculo=${connectionId}`);
    const { count: grants } = await admin
      .from("sharing_permissions")
      .select("id", { count: "exact", head: true })
      .eq("connection_id", connectionId);
    expect(grants, "ZERO_GRANTS_AFTER_INVITE").toBe(0);

    // 4. Aviso ao profissional, uma vez, sem codigo.
    const { data: notices } = await admin
      .from("notifications")
      .select("kind,event_key")
      .eq("user_id", pro.userId)
      .eq("kind", "invite_accepted");
    expect(notices).toHaveLength(1);
    expect(JSON.stringify(notices)).not.toContain(code.slice(4));

    // 5. Repetir: idempotente para a propria pessoa; outra pessoa = codigo inventado.
    const replay = await redeem(p.request, code, "accept");
    expect(replay.status).toBe(200);
    expect(JSON.parse(replay.body).data).toMatchObject({ outcome: "already_accepted", relationshipId: connectionId });
    const otherSide = await open(browser, baseURL!, other);
    const stolen = await redeem(otherSide.page.request, code, "accept");
    const invented = await redeem(otherSide.page.request, "ELY-00000-00000", "accept");
    expect(stolen.status).toBe(404);
    expect(stolen.body).toBe(invented.body);
    expect(stolen.body).not.toContain(pro.userId);
    const { data: stillOne } = await admin.from("notifications").select("id").eq("user_id", pro.userId).eq("kind", "invite_accepted");
    expect(stillOne, "repeticao nao duplica o aviso").toHaveLength(1);

    // 6. Vazamento: o codigo so viajou no corpo do POST.
    for (const variant of [code, code.replaceAll("-", ""), code.slice(4)]) {
      expect(requests.some((line) => line.toUpperCase().includes(variant)), `requisicao/Referer com ${variant}`).toBe(false);
      expect((await storedText(p)).toUpperCase(), `storage com ${variant}`).not.toContain(variant);
    }
    expect(p.url()).not.toContain(code);

    // 7. O profissional ve o aviso e quem aceitou.
    await gotoHydrated(proSide.page, "/notificacoes");
    await expect(proSide.page.getByText("Convite aceito").first()).toBeVisible();
    await gotoHydrated(proSide.page, "/pro/solicitacoes");
    await proSide.page.getByRole("button", { name: /Histórico/ }).click();
    await expect(proSide.page.getByTestId("invites-history")).toContainText("Aceito por Marina Código");

    // 8. Cancelar convite: o codigo novo deixa de abrir, com a mesma resposta.
    await proSide.page.getByRole("button", { name: "Gerar convite" }).click();
    const second = (await proSide.page.getByTestId("invite-code").textContent())!.trim();
    await proSide.page.getByTestId("invite-created").getByRole("button", { name: "Cancelar convite" }).click();
    await expect(proSide.page.getByTestId("invite-created")).toHaveCount(0);
    await proSide.page.getByRole("button", { name: /Histórico/ }).click();
    await expect(proSide.page.getByTestId("invites-history")).toContainText("Cancelado");
    const cancelled = await redeem(otherSide.page.request, second, "preview");
    expect(cancelled.status).toBe(404);
    expect(cancelled.body).toBe(invented.body);

    // 9. Expirado: `professional_invites` so muda por RPC (nem service_role
    //    tem UPDATE), entao o relogio nao se adianta daqui. A prova esta no

    //    Aqui fica provado que o atalho de teste NAO existe.
    const third = ((await (await proSide.page.request.post("/api/professional/invites")).json()) as { data: { inviteId: string } }).data;
    const { error: forbidden } = await admin
      .from("professional_invites")
      .update({ expires_at: new Date(Date.now() - 3_600_000).toISOString() })
      .eq("id", third.inviteId);
    expect(forbidden, "convite nao muda fora de RPC").not.toBeNull();

    // 10. Na tela: codigo bem formado mas indisponivel.
    await gotoHydrated(otherSide.page, "/convite");
    await otherSide.page.getByLabel("Código de convite").fill(second);
    await otherSide.page.getByRole("button", { name: "Ver convite" }).click();
    await expect(otherSide.page.locator("#invite-error")).toContainText("Este código não está disponível");
    await axeBothSchemes(otherSide.page, "/convite indisponivel");

    // 11. L-434: o caminho legado por UUID nao existe mais.
    const legacy = await otherSide.page.request.post("/api/professional/connections", { data: { professionalUserId: pro.userId } });
    expect(legacy.status()).toBe(405);
    const { count: legacyRows } = await admin
      .from("professional_connections")
      .select("id", { count: "exact", head: true })
      .eq("client_user_id", other.userId);
    expect(legacyRows).toBe(0);

    await Promise.all([proSide.context.close(), personSide.context.close(), otherSide.context.close()]);
  } finally {
    await cleanupAccounts(admin, created);
  }
});
