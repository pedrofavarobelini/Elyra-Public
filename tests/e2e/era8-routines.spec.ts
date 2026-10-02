import { expect, test, type Browser } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { gotoHydrated } from "./hydrated";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";



test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

async function contaLogada(browser: Browser, baseURL: string, prefixo: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `${prefixo}-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  const userId = await createConfirmedQaUser(admin, {
    email,
    password,
    displayName: "Pessoa Rotina",
  });
  await loginThroughUi(page, baseURL, { email, password });
  return { admin, context, page, userId, email };
}

test("o plano abre uma rotina que avanca sozinha e fecha pelo teclado", async ({
  browser,
  baseURL,
}) => {
  process.loadEnvFile?.(".env.local");
  if (!baseURL) throw new Error("QA local nao configurado.");
  const { admin, context, page, userId, email } = await contaLogada(browser, baseURL, "era8-rotina");
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(String(e)));

  try {
    await gotoHydrated(page, `${baseURL}/dashboard`);

    const plano = page.getByRole("region", { name: "Meu caminho na Elyra" });
    await expect(plano).toBeVisible();
    // Conta nova nao escolheu objetivo: o caminho geral aparece, sem cobrar escolha.
    await expect(plano).toContainText("Você pode começar por qualquer um destes espaços.");
    await expect(plano).not.toContainText("Escolha um objetivo");

    // A rotina sugerida abre num dialogo — sem rota nova.
    const urlAntes = page.url();
    await plano.getByRole("button", { name: /^Fazer agora:/ }).click();

    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("Passo 1 de");
    // Nada de promessa clinica na tela da rotina.
    await expect(dialogo).not.toContainText(/ansiedade|tratamento|terapia/i);
    await expect(dialogo).toContainText("Nada aqui é registrado.");
    expect(page.url()).toBe(urlAntes);

    // O tempo corre e o passo avanca sozinho.
    const barra = dialogo.getByRole("progressbar");
    await expect(barra).toHaveAttribute("aria-valuenow", "0");
    await dialogo.getByRole("button", { name: "Começar" }).click();
    await expect
      .poll(async () => Number(await barra.getAttribute("aria-valuenow")), { timeout: 20_000 })
      .toBeGreaterThan(1);

    // Escape fecha: o dialogo devolve o controle sem obrigar a concluir.
    await page.keyboard.press("Escape");
    await expect(dialogo).toBeHidden();

    expect(erros).toEqual([]);
  } finally {
    await context.close();
    if (userId) {
      await admin.from("audit_logs").delete().eq("actor_user_id", userId);
      assertNotQaCanonicalAccount(email);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});

test("a rotina funciona sem rede: o conteudo vem do proprio aplicativo", async ({
  browser,
  baseURL,
}) => {
  process.loadEnvFile?.(".env.local");
  if (!baseURL) throw new Error("QA local nao configurado.");
  const { admin, context, page, userId, email } = await contaLogada(browser, baseURL, "era8-rot-off");

  try {
    await gotoHydrated(page, `${baseURL}/dashboard`);
    await page.waitForFunction(
      async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return Boolean(registration?.active && navigator.serviceWorker.controller);
      },
      null,
      { timeout: 60_000 },
    );

    await context.setOffline(true);

    /*
      FULL_OFFLINE de verdade: os passos sao dado no bundle, entao a rotina abre e
      avanca sem nenhuma requisicao. Nem o shell offline atrapalha — o plano e a
      rotina vivem no mesmo aplicativo ja carregado.
    */
    const plano = page.getByRole("region", { name: "Meu caminho na Elyra" });
    await expect(plano).toBeVisible({ timeout: 30_000 });
    await plano.getByRole("button", { name: /^Fazer agora:/ }).click();

    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText("Passo 1 de");
    await dialogo.getByRole("button", { name: "Começar" }).click();
    await expect
      .poll(
        async () => Number(await dialogo.getByRole("progressbar").getAttribute("aria-valuenow")),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(1);
  } finally {
    await context.close();
    if (userId) {
      await admin.from("audit_logs").delete().eq("actor_user_id", userId);
      assertNotQaCanonicalAccount(email);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});

test("com movimento reduzido, a rotina continua funcionando e informando", async ({
  browser,
  baseURL,
}) => {
  process.loadEnvFile?.(".env.local");
  if (!baseURL) throw new Error("QA local nao configurado.");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `era8-rot-motion-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;

  // A preferencia do sistema, declarada no proprio contexto do navegador.
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  let userId = "";

  try {
    userId = await createConfirmedQaUser(admin, {
      email,
      password,
      displayName: "Pessoa Motion",
    });
    await loginThroughUi(page, baseURL, { email, password });
    await gotoHydrated(page, `${baseURL}/dashboard`);

    await page
      .getByRole("region", { name: "Meu caminho na Elyra" })
      .getByRole("button", { name: /^Fazer agora:/ })
      .click();

    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();
    await dialogo.getByRole("button", { name: "Começar" }).click();

    /*
      O que importa com movimento reduzido: a informacao **nao** depende da
      animacao. O numero do progresso continua avancando e o texto do passo
      continua mudando, mesmo sem transicao nenhuma.
      */
    await expect
      .poll(
        async () => Number(await dialogo.getByRole("progressbar").getAttribute("aria-valuenow")),
        { timeout: 20_000 },
      )
      .toBeGreaterThan(1);
    await expect(dialogo).toContainText("Passo 1 de");
  } finally {
    await context.close();
    if (userId) {
      await admin.from("audit_logs").delete().eq("actor_user_id", userId);
      assertNotQaCanonicalAccount(email);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
