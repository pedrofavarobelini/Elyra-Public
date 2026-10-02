import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";



const MAILPIT = "http://127.0.0.1:54384";

// O fluxo atravessa URLs com credenciais de uso unico. Nenhum trace ou video
// pode persistir o link, o code do callback ou os cookies da sessao.
test.use({ trace: "off", video: "off", screenshot: "off" });

function admin() {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Playwright QA local nao configurado.");
  const target = new URL(url);
  if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.port !== "54381") {
    throw new Error("Signup QA recusado fora do Supabase local isolado.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function credenciais(prefixo: string) {
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  return {
    email: `${prefixo}-${run}@elyra.invalid`,
    password: `Qa${crypto.randomUUID().replaceAll("-", "")}9`,
  };
}

async function preencher(
  page: import("@playwright/test").Page,
  dados: { nome: string; email: string; password: string },
) {
  await page.getByLabel("Nome").fill(dados.nome);
  await page.getByLabel("E-mail").fill(dados.email);
  await page.getByLabel("Senha", { exact: true }).fill(dados.password);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Criar conta" }).click();
}

/**
 * O link de confirmacao que chegou para este endereco.
 *
 * O valor e usado internamente e **nunca** impresso: um link de confirmacao e
 * uma credencial de uso unico, e um relatorio de teste nao e lugar para ela.
 */
async function linkDeConfirmacao(email: string): Promise<string> {
  for (let tentativa = 0; tentativa < 15; tentativa += 1) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    if (!response.ok) throw new Error("Capturador local indisponivel.");
    const box = await response.json();
    const message = (box.messages ?? []).find(
      (item: { To?: { Address?: string }[] }) =>
        item.To?.[0]?.Address?.toLowerCase() === email.toLowerCase(),
    );
    if (!message) continue;

    const full = await (
      await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)
    ).json();
    const corpo = `${full.Text ?? ""} ${full.HTML ?? ""}`;
    const encontrado = corpo.match(
      /https?:\/\/[^"'\s<>]*\/auth\/v1\/verify\?[^"'\s<>]+/,
    );
    if (encontrado) {
      const link = new URL(encontrado[0].replace(/&amp;/g, "&"));
      if (link.origin !== "http://127.0.0.1:54381" ||
          link.pathname !== "/auth/v1/verify" ||
          link.searchParams.get("type") !== "signup") {
        throw new Error("Link de confirmacao fora do contrato QA local.");
      }
      return link.href;
    }
  }
  throw new Error("E-mail de confirmacao nao chegou ao capturador local.");
}

async function contarConsentimentos(
  supabase: ReturnType<typeof admin>,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("consent_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("purpose", "terms_privacy");
  if (error || count === null) throw new Error("Contagem de consentimento indisponivel.");
  return count;
}

/** Remove a conta criada pelo proprio teste. Nunca toca em conta humana. */
async function remover(
  supabase: ReturnType<typeof admin>,
  email: string,
): Promise<void> {
  // A conta canonica sobrevive a qualquer cleanup, inclusive por engano de alvo.
  assertNotQaCanonicalAccount(email);
  if (!/^signup(?:-[a-z]+)*-[a-f0-9]{14}@elyra\.invalid$/.test(email)) {
    throw new Error("Cleanup recusado fora das identidades deste spec.");
  }
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error("Consulta de cleanup indisponivel.");
  const userId = data?.users.find((user) => user.email === email)?.id;
  if (!userId) return;
  const audit = await supabase.from("audit_logs").delete().eq("actor_user_id", userId);
  if (audit.error) throw new Error("Cleanup de auditoria falhou.");
  const removed = await supabase.auth.admin.deleteUser(userId);
  if (removed.error) throw new Error("Cleanup de identidade falhou.");
}

test.describe("cadastro pela UI publica", () => {

  test.beforeEach(async ({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "contrato de cadastro nao depende de viewport; ver a nota sobre rate limiting",
    );
  });

  test("caso 1 - a jornada inteira: cadastro, confirmacao e primeiro acesso", async ({
    browser,
    baseURL,
  }) => {
    const supabase = admin();
    const { email, password } = credenciais("signup-novo");
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const erros: string[] = [];
    page.on("pageerror", (error) => erros.push(String(error).slice(0, 160)));

    try {
      await gotoHydrated(page, `${baseURL}/cadastro`);
      await preencher(page, { nome: "Pessoa Cadastro", email, password });

      /*
        Sem sessao imediata. A conta existe, e o acesso ainda nao: e essa
        distincao que a confirmacao de e-mail introduziu, e ela precisa aparecer
        na tela em vez de virar um redirect silencioso.
      */
      await expect(page.getByRole("status")).toContainText(
        "Verifique seu e-mail",
      );
      await expect(page).toHaveURL(/\/cadastro$/);

      expect((await context.cookies()).some((cookie) =>
        /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name)), "sem cookie de sessao antes da confirmacao").toBe(false);

      const { data: antes } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      const criado = antes?.users.find((user) => user.email === email);
      expect(criado, "usuario criado").toBeDefined();
      expect(
        criado?.email_confirmed_at ?? null,
        "e-mail ainda nao confirmado",
      ).toBeNull();
      expect(
        await contarConsentimentos(supabase, criado!.id),
        "nada de consentimento antes da prova de posse",
      ).toBe(0);

      // O link real, aberto no navegador: o cookie do verifier vive nele.
      try {
        await page.goto(await linkDeConfirmacao(email));
      } catch {
        throw new Error("Navegacao de confirmacao falhou (URL omitida).");
      }
      await page.waitForURL("**/dashboard", { timeout: 30_000 });

      const { data: depois } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      const confirmado = depois?.users.find((user) => user.email === email);
      expect(
        confirmado?.email_confirmed_at ?? null,
        "confirmado apos o link",
      ).not.toBeNull();

      /*
        O aceite dado no formulario sobreviveu a confirmacao. Ele nao podia virar
        evento no cadastro — sem sessao, a RLS recusa — entao virou intencao, e
        so agora e historico.
      */
      expect(await contarConsentimentos(supabase, criado!.id)).toBe(1);

      // Sessao real: uma rota protegida abre, e sobrevive ao reload.
      await gotoHydrated(page, `${baseURL}/sessoes`);
      await expect(page).toHaveURL(/\/sessoes$/);
      await page.reload();
      await expect(page).toHaveURL(/\/sessoes$/);

      const { count: perfis } = await supabase
        .from("profiles")
        .select("user_id", { count: "exact", head: true })
        .eq("user_id", criado!.id);
      expect(perfis, "perfil criado pelo trigger").toBe(1);

      expect(erros, "nenhum erro de pagina").toEqual([]);
    } finally {
      await remover(supabase, email);
      await context.close();
    }
  });

  test("caso 1b - entrar de novo nao duplica o consentimento", async ({
    browser,
    baseURL,
  }) => {
    /*
      A materializacao acontece a cada nascimento de sessao. Se ela nao fosse
      idempotente, cada login somaria um `consent_event` e o historico da pessoa
      viraria ruido — justamente o registro que precisa ser levado a serio.
    */
    const supabase = admin();
    const { email, password } = credenciais("signup-relogin");
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    try {
      await gotoHydrated(page, `${baseURL}/cadastro`);
      await preencher(page, { nome: "Pessoa Relogin", email, password });
      await expect(page.getByRole("status")).toContainText("Verifique seu e-mail");

      try {
        await page.goto(await linkDeConfirmacao(email));
      } catch {
        throw new Error("Navegacao de confirmacao falhou (URL omitida).");
      }
      await page.waitForURL("**/dashboard", { timeout: 30_000 });

      const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const userId = data?.users.find((user) => user.email === email)?.id ?? "";
      expect(await contarConsentimentos(supabase, userId)).toBe(1);

      // Sai e entra de novo, pela tela real.
      await gotoHydrated(page, `${baseURL}/perfil`);
      await page.getByRole("button", { name: "Sair" }).click();
      await page.waitForURL("**/entrar", { timeout: 30_000 });

      await page.getByLabel("E-mail").fill(email);
      await page.getByLabel("Senha", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await page.waitForURL("**/dashboard", { timeout: 30_000 });

      expect(await contarConsentimentos(supabase, userId)).toBe(1);
    } finally {
      await remover(supabase, email);
      await context.close();
    }
  });

  test("caso 2 - e-mail ja existente orienta sem confirmar que existe", async ({
    browser,
    baseURL,
  }) => {
    const supabase = admin();
    const { email, password } = credenciais("signup-repetido");
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const erros: string[] = [];
    page.on("pageerror", (error) => erros.push(String(error).slice(0, 160)));

    try {
      /*
        A pre-condicao — "ja existe uma conta com este e-mail" — e montada pela
        API administrativa, e nao pela UI. O sujeito deste teste e a **segunda**
        tentativa; a primeira e so cenario.

        `email_confirm: true` importa aqui: com a confirmacao ligada, o GoTrue
        so devolve `user_already_exists` para conta **confirmada** — medido
        contra a instalacao real, e nao deduzido.
      */
      const { error: erroCriacao } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: "Pessoa Repetida" },
      });
      expect(erroCriacao, "pre-condicao: conta existente").toBeNull();

      const limpo = await browser.newContext({
        storageState: { cookies: [], origins: [] },
      });
      const segunda = await limpo.newPage();
      try {
        await gotoHydrated(segunda, `${baseURL}/cadastro`);
        await preencher(segunda, { nome: "Pessoa Repetida", email, password });

        /*
          O alerta e localizado **dentro do formulario**: `getByRole("alert")`
          sozinho casa tambem o anunciador de rota do Next, que fica no fim do
          `body` e e vazio.
        */
        const alerta = segunda.locator('form [role="alert"]');
        await expect(alerta).toBeVisible();
        await expect(segunda).toHaveURL(/\/cadastro$/);

        /*
          A tela nao pode confirmar que a conta existe. Se pudesse, `/cadastro`
          responderia "este e-mail tem conta?" para quem perguntasse.
        */
        const texto = (await alerta.innerText()).toLowerCase();
        for (const vazamento of [
          "já está cadastrado",
          "ja esta cadastrado",
          "já existe",
          "ja existe",
          "already registered",
          "user_already_exists",
          "email_exists",
          "conta encontrada",
        ]) {
          expect(texto, `vazou "${vazamento}"`).not.toContain(vazamento);
        }

        // E precisa dar o proximo passo, que e entrar.
        expect(texto).toContain("entre");
        const entrar = segunda.getByRole("link", { name: "Entrar na minha conta" });
        await expect(entrar).toBeVisible();
        await entrar.click();
        await expect(segunda).toHaveURL(/\/entrar$/);

        expect(erros, "nenhum erro de pagina").toEqual([]);
      } finally {
        await limpo.close();
      }
    } finally {
      await remover(supabase, email);
      await context.close();
    }
  });

  test("caso 3 - senha invalida continua bloqueando, sem regressao", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();
    const { email } = credenciais("signup-senha");

    try {
      await gotoHydrated(page, `${baseURL}/cadastro`);
      await page.getByLabel("Nome").fill("Pessoa Senha");
      await page.getByLabel("E-mail").fill(email);
      // Sem digito: a politica exige letra **e** numero.
      await page.getByLabel("Senha", { exact: true }).fill("apenasletras");
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Criar conta" }).click();

      const alerta = page.locator('form [role="alert"]');
      await expect(alerta).toBeVisible();
      await expect(page).toHaveURL(/\/cadastro$/);
      // Mensagem sobre o que a pessoa digitou - essa pode e deve ser especifica.
      await expect(alerta).toContainText("número");
      // A action e seu teste versionado usam false para validacao de senha.
      // Conta existente e falha desconhecida continuam com a mesma resposta.
      await expect(
        page.getByRole("link", { name: "Entrar na minha conta" }),
      ).toHaveCount(0);

      // `VR-007`: o e-mail sobrevive ao erro; a senha nunca volta.
      await expect(page.getByLabel("E-mail")).toHaveValue(email);
      await expect(page.getByLabel("Senha", { exact: true })).toHaveValue("");
    } finally {
      await context.close();
    }
  });

  test("caso 4 - sem aceitar os termos, nada e criado", async ({
    browser,
    baseURL,
  }) => {
    /*
      O aceite e a base de tudo o que vem depois. Nenhum caminho pode produzir
      conta, intencao de consentimento ou evento sem ele — e a barreira e o
      proprio schema, entao ela age antes de qualquer ida ao servidor.
    */
    const supabase = admin();
    const { email, password } = credenciais("signup-sem-aceite");
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const page = await context.newPage();

    try {
      await gotoHydrated(page, `${baseURL}/cadastro`);
      await page.getByLabel("Nome").fill("Pessoa Sem Aceite");
      await page.getByLabel("E-mail").fill(email);
      await page.getByLabel("Senha", { exact: true }).fill(password);
      // A caixa NAO e marcada.
      await page.getByRole("button", { name: "Criar conta" }).click();

      expect(await page.getByRole("checkbox").evaluate((element: HTMLInputElement) =>
        element.validity.valueMissing), "barreira nativa de aceite obrigatorio").toBe(true);
      await expect(page).toHaveURL(/\/cadastro$/);
      const { data } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      expect(
        data?.users.some((user) => user.email === email),
        "nenhuma conta criada sem aceite",
      ).toBe(false);
    } finally {
      await remover(supabase, email);
      await context.close();
    }
  });
});
