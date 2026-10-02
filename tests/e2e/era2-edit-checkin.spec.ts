import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { gotoHydrated } from "./hydrated";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";


test("Era 2 corrige check-in passado sem mover a data e sem alcancar o de outra pessoa", async ({
  browser,
  baseURL,
}) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Playwright QA local nao configurado.");

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  const email = `era2-edit-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  const outroEmail = `era2-outro-${run}@elyra.invalid`;

  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  let userId = "";
  let outroUserId = "";

  try {
    userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa Era 2" });
    await loginThroughUi(page, baseURL ?? "", { email, password });

    // Um check-in de ontem, para que a correcao seja de registro passado.
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const criado = await page.request.post(`${baseURL}/api/emotional/checkins`, {
      data: {
        occurredAt: ontem,
        mood: 4,
        perceivedAnxiety: 7,
        energy: 3,
        primaryFeeling: "triste",
        factorIds: [],
        note: null,
      },
    });
    expect(criado.ok(), await criado.text()).toBe(true);
    const { data: checkin } = (await criado.json()) as {
      data: { id: string; occurredAt: string };
    };

    // --- a correcao persiste, e a data nao se move -------------------------
    const corrigido = await page.request.patch(
      `${baseURL}/api/emotional/checkins`,
      {
        data: {
          id: checkin.id,
          mood: 8,
          perceivedAnxiety: null,
          energy: 6,
          primaryFeeling: "triste",
          factorIds: [],
          note: null,
        },
      },
    );
    expect(corrigido.ok(), await corrigido.text()).toBe(true);

    const { data: linhas, error: erroLinha } = await admin
      .from("emotional_checkins")
      .select("occurred_at, mood_score, perceived_anxiety_score, energy_score")
      .eq("id", checkin.id);
    if (erroLinha) throw erroLinha;
    const linha = linhas?.[0];
    expect(linha).toBeTruthy();
    expect(linha?.mood_score).toBe(8);
    expect(linha?.energy_score).toBe(6);
    // Ausencia e `null`, nunca `0` - `0` afirmaria o pior valor possivel.
    expect(linha?.perceived_anxiety_score).toBeNull();
    // A data original permanece: corrigir ontem nao traz o registro para hoje.
    expect(new Date(linha?.occurred_at ?? 0).toISOString()).toBe(
      new Date(checkin.occurredAt).toISOString(),
    );

    // --- data futura continua recusada ------------------------------------
    const futuro = await page.request.patch(
      `${baseURL}/api/emotional/checkins`,
      {
        data: {
          id: checkin.id,
          occurredAt: new Date(Date.now() + 86_400_000).toISOString(),
          mood: 5,
          perceivedAnxiety: null,
          energy: null,
          primaryFeeling: null,
          factorIds: [],
          note: null,
        },
      },
    );
    expect(futuro.status()).toBe(400);

    // --- check-in vazio continua recusado ---------------------------------
    const vazio = await page.request.patch(`${baseURL}/api/emotional/checkins`, {
      data: {
        id: checkin.id,
        mood: null,
        perceivedAnxiety: null,
        energy: null,
        primaryFeeling: null,
        factorIds: [],
        note: null,
      },
    });
    expect(vazio.status()).toBe(400);

    // --- o check-in de outra pessoa e inalcancavel ------------------------
    const { data: outro, error: erroOutro } = await admin.auth.admin.createUser({
      email: outroEmail,
      password: `Qa${crypto.randomUUID().replaceAll("-", "")}8`,
      email_confirm: true,
    });
    if (erroOutro || !outro.user) throw erroOutro ?? new Error("Outro QA nao criado.");
    outroUserId = outro.user.id;

    const outroCheckinId = crypto.randomUUID();
    const { error: erroInsert } = await admin.from("emotional_checkins").insert({
      id: outroCheckinId,
      user_id: outroUserId,
      occurred_at: ontem,
      mood_score: 5,
    });
    if (erroInsert) throw erroInsert;

    const alheio = await page.request.patch(
      `${baseURL}/api/emotional/checkins`,
      {
        data: {
          id: outroCheckinId,
          mood: 10,
          perceivedAnxiety: null,
          energy: null,
          primaryFeeling: null,
          factorIds: [],
          note: null,
        },
      },
    );
    // 404, e nao 403: responder "existe, mas nao e seu" ja contaria algo sobre
    // outra pessoa.
    expect(alheio.status()).toBe(404);

    const { data: intacto } = await admin
      .from("emotional_checkins")
      .select("mood_score")
      .eq("id", outroCheckinId);
    expect(intacto?.[0]?.mood_score).toBe(5);

    // --- a tela mostra o valor corrigido ----------------------------------
    await gotoHydrated(page, `${baseURL}/historico`);
    await expect(
      page.getByRole("button", { name: /^Corrigir o check-in de/ }).first(),
    ).toBeVisible();
  } finally {
    for (const id of [userId, outroUserId]) {
      if (!id) continue;
      await admin.from("audit_logs").delete().eq("actor_user_id", id);
      // A conta QA canonica sobrevive a qualquer cleanup, inclusive por engano.
      assertNotQaCanonicalAccount(email);
      await admin.auth.admin.deleteUser(id);
    }
    await context.close();
  }
});
