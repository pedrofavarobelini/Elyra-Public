import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { gotoHydrated } from "./hydrated";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";



const FATOR = "Fator QA Era 3";

async function criarCheckin(
  page: Page,
  baseURL: string,
  diasAtras: number,
  mood: number,
  factorIds: string[],
) {
  const response = await page.request.post(`${baseURL}/api/emotional/checkins`, {
    data: {
      occurredAt: new Date(Date.now() - diasAtras * 86_400_000).toISOString(),
      mood,
      perceivedAnxiety: mood,
      energy: mood,
      primaryFeeling: null,
      factorIds,
      note: null,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
}

test("Era 3 - filtro por fator alcanca a media, e relatorio filtrado nao vira snapshot", async ({
  baseURL,
  browser,
}) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) {
    throw new Error("QA local da Era 3 nao configurado.");
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  const email = `era3-filtros-${run}@elyra.invalid`;
  let userId = "";

  try {
    const password = `Qa${run}Aa9`;
    userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa Era 3" });
    await loginThroughUi(page, baseURL, { email, password });

    const criado = await page.request.post(`${baseURL}/api/emotional/factors`, {
      data: { label: FATOR },
    });
    expect(criado.status(), await criado.text()).toBe(201);
    const { data: fator } = (await criado.json()) as { data: { id: string } };

    /*
      Dois grupos que nao podem ser confundidos. Tres dias com o fator e humor 8;
      tres dias sem o fator e humor 2. Sem filtro a media e 5; com filtro, 8.
      Tres de cada lado tambem e o minimo amostral, entao o filtro nao empurra o
      relatorio para `insufficient_data` por acidente.
    */
    for (const dia of [1, 2, 3]) {
      await criarCheckin(page, baseURL, dia, 8, [fator.id]);
    }
    for (const dia of [4, 5, 6]) {
      await criarCheckin(page, baseURL, dia, 2, []);
    }

    await gotoHydrated(page, "/relatorios");
    const humor = page.getByRole("group", { name: "Humor médio" });
    await expect(humor).toContainText("5,0");
    await expect(humor).toContainText("Este tem 6 dias");

    const salvar = page.getByRole("button", { name: "Salvar relatório" });
    await expect(salvar).toBeEnabled();

    // O filtro e aplicado pela interface, e nao por chamada direta: o que precisa
    // ser provado e o caminho inteiro, da tela ate o motor deterministico.

    // e parte do caminho real da pessoa, e nao atalho do teste.
    await page.getByRole("button", { name: "Filtros avançados" }).click();
    await page.getByRole("button", { name: FATOR, exact: true }).click();
    // R2: abaixo de lg o recorte abre num painel inferior (dialog). O resultado
    // atualiza por tras dele; fechar e o gesto real antes de ler os numeros.
    const painel = page.getByRole("dialog", { name: "Filtros do relatório" });
    if (await painel.isVisible()) {
      await painel.getByRole("button", { name: "Ver resultado" }).click();
      await expect(painel).toBeHidden();
    }

    await expect(humor).toContainText("8,0");
    // A base amostral encolhe junto com o conjunto. Se o filtro fosse cosmetico,
    // ela continuaria em 6 - e a media, em 5,0.
    await expect(humor).toContainText("Este tem 3 dias");

    // A trava de procedencia. Um snapshot salvo agora descreveria os 6 dias.
    await expect(salvar).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Interpretar com IA" }),
    ).toBeDisabled();

    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(humor).toContainText("5,0");
    await expect(salvar).toBeEnabled();
  } finally {
    if (userId) {
      await admin.from("audit_logs").delete().eq("actor_user_id", userId);
      // A conta QA canonica sobrevive a qualquer cleanup, inclusive por engano.
      assertNotQaCanonicalAccount(email);
      await admin.auth.admin.deleteUser(userId);
    }
    await context.close();
  }
});
