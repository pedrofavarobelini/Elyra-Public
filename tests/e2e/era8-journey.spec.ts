import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { gotoHydrated } from "./hydrated";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";



test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test("a jornada reune os dominios em ordem, sem duplicar, e o calendario e legivel sem cor", async ({
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
  const email = `era8-jornada-${run}@elyra.invalid`;
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
      displayName: "Pessoa Jornada",
    });
    await loginThroughUi(page, baseURL, { email, password });

    // Dado real, em dois dominios e dois dias, pelo caminho do produto.
    const hoje = new Date();
    const ontem = new Date(hoje.getTime() - 24 * 60 * 60 * 1000);
    const dia = (d: Date) => d.toISOString().slice(0, 10);

    /*
      Cada preparo e conferido: um POST recusado em silencio faria o teste falhar
      la na frente, na assercao da tela, apontando para o lugar errado.
    */
    const criar = async (rota: string, data: unknown, metodo: "post" | "put" = "post") => {
      const resposta = await page.request[metodo](`${baseURL}${rota}`, { data });
      expect(resposta.ok(), `${rota} -> ${resposta.status()} ${await resposta.text()}`).toBe(
        true,
      );
    };

    await criar("/api/emotional/checkins", {
      mood: 4,
      perceivedAnxiety: null,
      energy: null,
      primaryFeeling: "tranquilo",
      factorIds: [],
      note: null,
    });
    await criar("/api/journal/entries", {
      title: "Marco da jornada",
      content: "Conteúdo privado.",
      tagIds: [],
      status: "saved",
    });
    // Sono e upsert por noite (PUT), e nao criacao: uma noite tem um registro.
    await criar(
      "/api/emotional/sleep",
      { night: dia(ontem), durationMinutes: 450, quality: 4 },
      "put",
    );

    await gotoHydrated(page, `${baseURL}/historico`);

    const timeline = page.getByRole("region", { name: "Linha do tempo" });
    await expect(timeline).toBeVisible();

    // Os tres dominios chegaram a MESMA lista.
    await expect(timeline).toContainText("Check-in — Tranquilo");
    await expect(timeline).toContainText("Diário — Marco da jornada");
    await expect(timeline).toContainText("Sono —");

    // E o conteudo da anotacao nao vaza para a linha do tempo.
    await expect(timeline).not.toContainText("Conteúdo privado");

    // Sem duplicata: cada registro aparece uma unica vez.
    const texto = (await timeline.innerText()).split("Check-in — Tranquilo").length - 1;
    expect(texto).toBe(1);

    // Ordem: o dia de hoje vem antes do dia de ontem.
    const corpo = await timeline.innerText();
    const posHoje = corpo.indexOf("Diário — Marco da jornada");
    const posOntem = corpo.indexOf("Sono —");
    expect(posHoje).toBeGreaterThanOrEqual(0);
    expect(posOntem).toBeGreaterThan(posHoje);

    // Minha semana (8.4/8.5): contagem de fatos e o resumo deterministico.
    const semana = page.getByRole("region", { name: "Minha semana" });
    await expect(semana).toBeVisible();
    await expect(semana).toContainText("Minha semana em resumo");
    // O que existe e contado...
    await expect(semana).toContainText("1 check-in em 1 dia.");
    await expect(semana).toContainText("1 anotação no Diário.");
    // ...e o que faltou e NOMEADO, sem cobranca.
    await expect(semana).not.toContainText("você não");
    await expect(semana).not.toContainText("sequência");
    /*
      A visao e o texto contam a mesma coisa: o card "Check-ins" existe ao lado
      do resumo que diz "1 check-in". (`getByRole("term")` nao serve aqui: o role
      de `<dt>` nao deriva nome do conteudo.)
    */
    await expect(semana).toContainText("Check-ins");
    await expect(semana).toContainText("Anotações");

    // Conquistas e consistencia (8.11/8.12): descricao, nunca placar.
    const acompanhamento = page.getByRole("region", { name: "Seu acompanhamento" });
    await expect(acompanhamento).toBeVisible();
    await expect(acompanhamento).toContainText("de acompanhamento nesta semana");
    await expect(acompanhamento).toContainText("Primeiro check-in");
    // Nada de jogo, cobranca ou elogio.
    for (const proibido of ["sequência", "streak", "seguidos", "parabéns", "ranking", "pontos"]) {
      await expect(acompanhamento).not.toContainText(proibido);
    }

    // Calendario: a informacao existe em texto, e nao so na cor.
    const calendario = page.getByRole("region", { name: "Dias acompanhados" });
    await expect(calendario).toBeVisible();
    const numeroDeHoje = Number(dia(hoje).slice(-2));
    await expect(
      calendario.getByLabel(new RegExp(`^Dia ${numeroDeHoje}: [12] registros?$`)),
    ).toBeVisible();
    // Um dia sem registro tambem se anuncia — e sem palavra de julgamento.
    await expect(calendario.getByLabel(/sem registro/).first()).toBeVisible();
    await expect(calendario).toContainText("dias com registro neste mês");

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

test("sem rede, a jornada continua inteira com os dados do aparelho", async ({
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
  const email = `era8-jornada-off-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;

  // worker nao registra e nao ha leitura local para provar.
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  let userId = "";

  try {
    userId = await createConfirmedQaUser(admin, {
      email,
      password,
      displayName: "Pessoa Offline",
    });
    await loginThroughUi(page, baseURL, { email, password });
    const criado = await page.request.post(`${baseURL}/api/emotional/checkins`, {
      data: {
        mood: 3,
        perceivedAnxiety: null,
        energy: null,
        primaryFeeling: "neutro",
        factorIds: [],
        note: null,
      },
    });
    expect(criado.ok(), await criado.text()).toBe(true);

    await gotoHydrated(page, `${baseURL}/historico`);
    await expect(page.getByRole("region", { name: "Linha do tempo" })).toContainText(
      "Check-in — Neutro",
    );

    await page.waitForFunction(
      async () => {
        const registration = await navigator.serviceWorker.getRegistration();
        return Boolean(registration?.active && navigator.serviceWorker.controller);
      },
      null,
      { timeout: 60_000 },
    );
    /*
      Espera pelo snapshot que **contem** o registro, e nao por "existe algum
      snapshot": o aparelho pode ter um snapshot anterior, gravado antes deste
      check-in existir. Contar linhas passava por sorte e falhava quando outro
      teste rodava antes — corrida do teste, nao do produto.
    */
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise<string>((resolve) => {
                const pedido = indexedDB.open("elyra-offline");
                pedido.onsuccess = () => {
                  const db = pedido.result;
                  const todos = db
                    .transaction("snapshots", "readonly")
                    .objectStore("snapshots")
                    .getAll();
                  todos.onsuccess = () => resolve(JSON.stringify(todos.result ?? []));
                  todos.onerror = () => resolve("");
                };
                pedido.onerror = () => resolve("");
              }),
          ),
        { timeout: 30_000 },
      )
      .toContain("neutro");

    await context.setOffline(true);
    await page.reload();

    /*
      Sem rede a navegacao cai no shell offline; o que importa e que a jornada
      continua legivel com o que esta no aparelho, e nao que a rota original
      reabra igual.
    */
    await expect(page.getByRole("region", { name: "Linha do tempo" })).toContainText(
      "Check-in — Neutro",
      { timeout: 30_000 },
    );
    await expect(page.getByRole("region", { name: "Dias acompanhados" })).toBeVisible();
  } finally {
    await context.close();
    if (userId) {
      await admin.from("audit_logs").delete().eq("actor_user_id", userId);
      assertNotQaCanonicalAccount(email);
      await admin.auth.admin.deleteUser(userId);
    }
  }
});
