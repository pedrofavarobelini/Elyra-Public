import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { gotoHydrated } from "./hydrated";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";



test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test("Hoje na Elyra convida, o check-in rapido grava e o painel se atualiza sozinho", async ({
  browser,
  baseURL,
}) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) throw new Error("QA local nao configurado.");

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `era8-hoje-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(String(e)));
  let userId = "";

  try {
    userId = await createConfirmedQaUser(admin, {
      email,
      password,
      displayName: "Pessoa Era 8",
    });
    await loginThroughUi(page, baseURL, { email, password });
    await gotoHydrated(page, `${baseURL}/dashboard`);

    const painel = page.getByRole("region", { name: "Hoje na Elyra" });
    await expect(painel).toBeVisible();

    // Conta nova: o unico fato do dia e o convite — nunca "zero registros".
    await expect(painel).toContainText("Você ainda não registrou como está hoje");
    await expect(painel).not.toContainText("0 ");

    // O check-in rapido aparece junto do convite.
    const grupo = painel.getByRole("group", { name: "Como você está agora?" });
    await expect(grupo).toBeVisible();

    await grupo.getByRole("button", { name: "Tranquilo" }).click();

    // O painel se recalcula sem recarregar a pagina.
    await expect(painel).toContainText("Você registrou como está hoje", { timeout: 30_000 });
    await expect(grupo).toBeHidden();

    // E gravou de verdade: uma linha, com o sentimento e sem inventar escala.
    const { data } = await admin
      .from("emotional_checkins")
      .select("primary_feeling,mood_score,perceived_anxiety_score,energy_score")
      .eq("user_id", userId);
    expect(data).toHaveLength(1);
    expect(data?.[0]?.primary_feeling).toBe("tranquilo");
    // `NULL` nao virou zero: o que nao foi informado continua ausente.
    expect(data?.[0]?.mood_score).toBeNull();
    expect(data?.[0]?.perceived_anxiety_score).toBeNull();
    expect(data?.[0]?.energy_score).toBeNull();

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

test("sem rede, o check-in rapido entra na fila e o painel avisa que a alteracao e local", async ({
  browser,
  baseURL,
}) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) throw new Error("QA local nao configurado.");

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const email = `era8-fila-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  let userId = "";

  try {
    userId = await createConfirmedQaUser(admin, {
      email,
      password,
      displayName: "Pessoa Fila",
    });
    await loginThroughUi(page, baseURL, { email, password });
    await gotoHydrated(page, `${baseURL}/dashboard`);
    // O service worker precisa estar ativo antes de cortar a rede.
    await page.waitForFunction(
      () => navigator.serviceWorker?.controller !== null,
      undefined,
      { timeout: 30_000 },
    );

    await context.setOffline(true);

    const painel = page.getByRole("region", { name: "Hoje na Elyra" });
    await painel
      .getByRole("group", { name: "Como você está agora?" })
      .getByRole("button", { name: "Feliz" })
      .click();

    // Registrou localmente e o painel reconhece a fila — sem erro na tela.
    await expect(painel).toContainText("Você registrou como está hoje", { timeout: 30_000 });
    await expect(painel).toContainText("só neste aparelho", { timeout: 30_000 });
    await expect(painel).toContainText("sozinhas quando a conexão voltar");

    // Nada chegou ao servidor enquanto a rede estava cortada.
    const durante = await admin
      .from("emotional_checkins")
      .select("id")
      .eq("user_id", userId);
    expect(durante.data ?? []).toHaveLength(0);

    await context.setOffline(false);

    // De volta a rede, a fila sobe sozinha — e chega UMA vez.
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("emotional_checkins")
            .select("id")
            .eq("user_id", userId);
          return data?.length ?? 0;
        },
        { timeout: 60_000 },
      )
      .toBe(1);
  } finally {
    await context.close();
    if (userId) {
      await admin.from("audit_logs").delete().eq("actor_user_id", userId);
      assertNotQaCanonicalAccount(email);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
