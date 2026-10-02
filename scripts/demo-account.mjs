

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const DB_CONTAINER = process.env.ELYRA_OPS_DB_CONTAINER ?? "supabase_db_elyra-public-snapshot-local";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL_PREFIX = "demo-elyra";
const CONSENT_VERSION = "v1";

function log(line) {
  process.stdout.write(`${line}\n`);
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-At", "-c", sql],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  ).trim();
}

async function main() {
  if (!url || !serviceRoleKey) {
    log("DEMO_ACCOUNT BLOCKED reason=credenciais_ausentes");
    log("  Rode antes: npm run qa:env:local");
    return 2;
  }
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    log(`DEMO_ACCOUNT BLOCKED reason=alvo_nao_local host=${host}`);
    return 2;
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const args = process.argv.slice(2);

  if (args.includes("--drop")) {
    const emails = psql(
      `select email from auth.users where email like '${EMAIL_PREFIX}-%@elyra.invalid'`,
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (emails.length === 0) {
      log("DEMO_ACCOUNT DROP nada_a_remover");
      return 0;
    }
    for (const email of emails) {
      const id = psql(`select id from auth.users where email = '${email}'`);
      if (!id) continue;
      await admin.from("audit_logs").delete().eq("actor_user_id", id);
      await admin.auth.admin.deleteUser(id);
      log(`DEMO_ACCOUNT removida ${email}`);
    }
    log(`DEMO_ACCOUNT=DROPPED total=${emails.length}`);
    return 0;
  }

  const suffix = randomUUID().replaceAll("-", "").slice(0, 6);
  const email = `${EMAIL_PREFIX}-${suffix}@elyra.invalid`;
  const password = `Demo-${randomUUID().slice(0, 8)}-${suffix}`;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Pessoa Demo" },
  });
  if (created.error || !created.data.user) {
    log(`DEMO_ACCOUNT BLOCKED reason=criacao_falhou message=${created.error?.message ?? "?"}`);
    return 1;
  }
  const userId = created.data.user.id;

  const consent = await admin.from("consent_events").insert({
    user_id: userId,
    purpose: "terms_privacy",
    document_version: CONSENT_VERSION,
    event_type: "granted",
  });
  if (consent.error) {
    log(`DEMO_ACCOUNT BLOCKED reason=consentimento_falhou code=${consent.error.code ?? "?"}`);
    await admin.auth.admin.deleteUser(userId);
    return 1;
  }

  if (args.includes("--seed")) {
    /*
      Dado de vitrine, deliberadamente ficticio e curto: o suficiente para as telas
      nao aparecerem vazias numa apresentacao, sem simular historia longa (o vazio
      explicado tambem e parte do produto e vale mostrar).
    */
    psql(`
      insert into public.emotional_checkins
        (user_id, occurred_at, mood_score, perceived_anxiety_score, energy_score, primary_feeling, note)
      select '${userId}', now() - (g || ' days')::interval,
             3 + (g % 3), 2, 3,
             (array['feliz','tranquilo','neutro','ansioso'])[1 + (g % 4)],
             'Registro de demonstracao ' || g
      from generate_series(1, 6) g;

      insert into public.journal_entries (user_id, title, content, status, created_at, updated_at)
      select '${userId}', 'Anotacao de demonstracao ' || g,
             'Texto ficticio para a apresentacao. Nenhum dado pessoal real aqui.',
             'saved', now() - (g || ' days')::interval, now() - (g || ' days')::interval
      from generate_series(1, 3) g;

      insert into public.sleep_records (user_id, night, duration_minutes, sleep_quality_score)
      select '${userId}', (current_date - g), 420 + (g * 10), 3
      from generate_series(1, 5) g
      on conflict do nothing;

      insert into public.goals (user_id, title, kind, status, recurrence, target, unit)
      values ('${userId}', 'Caminhar 30 minutos', 'frequency', 'active', 'daily', 3, null),
             ('${userId}', 'Escrever no diario', 'frequency', 'active', 'weekly', 2, null);

      insert into public.goal_progress_entries (goal_id, occurred_on, amount)
      select gl.id, (current_date - s), 1
      from public.goals gl cross join generate_series(0, 2) s
      where gl.user_id = '${userId}' and gl.status = 'active';
    `);
    log("DEMO_ACCOUNT SEED dados ficticios inseridos (check-ins, diario, sono, metas)");
  }

  log("");
  log("DEMO_ACCOUNT=PASS");
  log(`  E-mail: ${email}`);
  log(`  Senha:  ${password}`);
  log("");
  log("  Guarde estas credenciais apenas nesta janela: nao vao para arquivo nem para o Git.");
  log("  Para remover depois: npm run demo:account -- --drop");
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    log(`DEMO_ACCOUNT BLOCKED reason=erro message=${String(error?.message ?? error).slice(0, 160)}`);
    process.exitCode = 1;
  });
