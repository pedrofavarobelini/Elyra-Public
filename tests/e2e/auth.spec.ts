import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface QaIdentity {
  project: string;
  email: string;
  password: string;
}

test.describe("Stage 04 - Auth e sessao", () => {
  test("rota privada redireciona usuario anonimo", async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await gotoHydrated(page, `${baseURL}/dashboard`);
    await expect(page).toHaveURL(/\/entrar$/);
    await context.close();
  });

  test("login por senha, sessao e logout funcionam", async ({ browser, baseURL }, testInfo) => {
    const identities = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "test-results", ".auth", "identity.json"),
        "utf8",
      ),
    ) as QaIdentity[];
    const identity = identities.find(
      (candidate) => candidate.project === testInfo.project.name,
    );
    if (!identity) {
      throw new Error(`Identidade QA ausente para ${testInfo.project.name}.`);
    }
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    await gotoHydrated(page, `${baseURL}/entrar`);
    await page.getByLabel("E-mail").fill(identity.email);
    await page.getByLabel("Senha", { exact: true }).fill(identity.password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Olá, Demo" })).toBeVisible();

    /*
      Os flags do cookie de sessao, no navegador de verdade.

      A homologacao fisica encontrou `httpOnly=false` e `secure=false` chegando
      ao Android: o `options` do `@supabase/ssr` passava direto, e a Elyra nao
      escolhia nada. Este bloco existe para que a regressao seja detectada aqui,
      e nao num aparelho.

      `secure` acompanha o transporte de proposito - ligado sempre, quebraria o
      desenvolvimento em `http://localhost`. Por isso a expectativa e derivada do
      protocolo do `baseURL`, e nao cravada.
    */
    const sessionCookies = (await context.cookies()).filter((cookie) =>
      cookie.name.includes("auth-token"),
    );
    expect(sessionCookies.length).toBeGreaterThan(0);
    const secureExpected = new URL(baseURL!).protocol === "https:";
    for (const cookie of sessionCookies) {
      expect(cookie.httpOnly, `${cookie.name} precisa ser HttpOnly`).toBe(true);
      expect(cookie.secure, `${cookie.name} deve seguir o transporte`).toBe(secureExpected);
      expect(cookie.path).toBe("/");
    }

    // E o token nao pode ser alcancavel por script na pagina.
    expect(
      await page.evaluate(() => document.cookie.includes("auth-token")),
    ).toBe(false);

    await gotoHydrated(page, `${baseURL}/perfil`);
    await expect(page.getByLabel("E-mail")).toHaveValue(identity.email);
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/entrar$/);

    await gotoHydrated(page, `${baseURL}/dashboard`);
    await expect(page).toHaveURL(/\/entrar$/);
    await context.close();
  });
});

/**
 * `VR-007` - erro de credencial nao pode apagar o e-mail digitado.
 *
 * O `<form action>` do React reseta os campos nao controlados quando a acao
 * termina. Numa acao que redireciona isso e invisivel; numa que volta com erro,
 * apaga o que a pessoa acabou de escrever - e ela redigita o e-mail inteiro
 * mesmo quando o e-mail estava certo.
 *
 * O teste fixa os **dois** lados: o e-mail sobrevive e a senha nao. Preservar a
 * senha seria devolver credencial ao cliente sem ganho nenhum, ja que quem
 * errou vai digitar outra de qualquer forma.
 */
test.describe("VR-007 - erro de login preserva o e-mail", () => {
  const EMAIL = "pessoa-vr007@elyra.invalid";

  test("credencial invalida mantem o e-mail e limpa a senha", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await gotoHydrated(page, `${baseURL}/entrar`);

    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Senha", { exact: true }).fill("senha-que-nao-existe-123");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    // O Next mantem um `role="alert"` vazio para anuncio de rota; o erro do
    // formulario e o que vive dentro do proprio `<form>`.
    const erro = page.locator("form [role=alert]");
    await expect(erro).toContainText("E-mail ou senha inválidos.");

    await expect(page.getByLabel("E-mail")).toHaveValue(EMAIL);
    await expect(page.getByLabel("Senha", { exact: true })).toHaveValue("");

    // A postura de seguranca do finding permanece: a mensagem nao revela se a
    // conta existe.
    const alerta = (await erro.textContent()) ?? "";
    expect(alerta).not.toMatch(/nao (existe|encontrad)/i);
    expect(alerta).not.toMatch(/conta.*(nao|inexistente)/i);

    await context.close();
  });

  test("erro de validacao tambem preserva o e-mail", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    await gotoHydrated(page, `${baseURL}/entrar`);

    // `type="email"` bloquearia o submit nativo; o campo aceita o valor e a
    // validacao de servidor e quem responde.
    await page.getByLabel("E-mail").fill(EMAIL);
    await page.getByLabel("Senha", { exact: true }).fill("x");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    await expect(page.locator("form [role=alert]")).toBeVisible();
    await expect(page.getByLabel("E-mail")).toHaveValue(EMAIL);

    await context.close();
  });
});
