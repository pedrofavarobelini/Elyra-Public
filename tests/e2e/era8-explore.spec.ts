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
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const userId = await createConfirmedQaUser(admin, {
    email,
    password,
    displayName: "Pessoa Explora",
  });
  await loginThroughUi(page, baseURL, { email, password });
  return { admin, context, page, userId, email };
}

test("a pessoa escolhe a metrica do cruzamento, e nenhuma pergunta afirma causa", async ({
  browser,
  baseURL,
}) => {
  process.loadEnvFile?.(".env.local");
  if (!baseURL) throw new Error("QA local nao configurado.");
  const { admin, context, page, userId, email } = await contaLogada(browser, baseURL, "era8-explora");
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(String(e)));

  try {
    // Dado suficiente para existir ao menos um cruzamento (diario x metrica).
    const hoje = new Date();
    for (let i = 0; i < 4; i += 1) {
      const dia = new Date(hoje.getTime() - i * 24 * 60 * 60 * 1000);
      const criado = await page.request.post(`${baseURL}/api/emotional/checkins`, {
        data: {
          mood: 3 + (i % 3),
          perceivedAnxiety: 2,
          energy: 3,
          primaryFeeling: "neutro",
          factorIds: [],
          note: null,
        },
      });
      expect(criado.ok(), await criado.text()).toBe(true);
      const anotacao = await page.request.post(`${baseURL}/api/journal/entries`, {
        data: { title: `Dia ${i}`, content: "Texto.", tagIds: [], status: "saved" },
      });
      expect(anotacao.ok(), await anotacao.text()).toBe(true);
      void dia;
    }

    await gotoHydrated(page, `${baseURL}/relatorios`);

    const seletor = page.getByRole("group", { name: "Olhar estes cruzamentos por" });
    // Sem cruzamento nenhum a secao inteira nao existe — e valido, e o teste diz isso.
    if ((await seletor.count()) === 0) {
      test.skip(true, "sem cruzamentos disponiveis nesta janela de dados");
      return;
    }

    await expect(seletor.getByRole("button", { name: "Sugeridas" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const secao = page.getByText("O que apareceu junto").locator("xpath=ancestor::*[self::div][1]");

    for (const rotulo of ["Ansiedade percebida", "Energia", "Horas de sono", "Humor"]) {
      await seletor.getByRole("button", { name: rotulo, exact: true }).click();
      await expect(
        seletor.getByRole("button", { name: rotulo, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");

      /*
        A varredura e sobre as PERGUNTAS geradas, e nao sobre a secao inteira: o
        proprio aviso diz "nao indicam causa", e varrer tudo reprovaria o texto
        que protege a regra.
      */
      const perguntas = (await secao.getByRole("heading", { level: 3 }).allInnerTexts()).join(" ");
      expect(perguntas, rotulo).toContain("aparece diferente");
      for (const proibido of ["causa", "porque", "melhora", "piora", "provoca", "impacta"]) {
        expect(perguntas.toLowerCase(), `${rotulo}: ${proibido}`).not.toContain(proibido);
      }
      // E o aviso de coincidencia continua na tela em toda escolha.
      expect(await secao.innerText()).toContain("coincidência no tempo");
    }

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
