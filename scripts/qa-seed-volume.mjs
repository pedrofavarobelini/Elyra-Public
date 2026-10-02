

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const DB_CONTAINER = process.env.ELYRA_OPS_DB_CONTAINER ?? "supabase_db_elyra-public-snapshot-local";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Perfil de volume: ~2,5 anos de uso diario intenso. */
const VOLUME = {
  checkins: 900,
  factorsPerCheckin: 2,
  journal: 500,
  sleep: 600,
  goals: 25,
  progressPerGoal: 60,
  cycleRecords: 500,
};

function log(line) {
  process.stdout.write(`${line}\n`);
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-At", "-c", sql],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

function assertLocalTarget() {
  if (!url || !serviceRoleKey) {
    log("SEED_VOLUME BLOCKED reason=credenciais_ausentes");
    process.exit(2);
  }
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host)) {
    log(`SEED_VOLUME BLOCKED reason=alvo_nao_local host=${host}`);
    process.exit(2);
  }
}

function assertSyntheticEmail(email) {
  if (!/^stage26-volume-[a-z0-9]+@elyra\.invalid$/.test(email)) {
    log("SEED_VOLUME BLOCKED reason=identidade_nao_sintetica");
    process.exit(2);
  }
}

async function main() {
  assertLocalTarget();
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const args = process.argv.slice(2);
  const emailArg = args.find((a) => a.startsWith("--email="))?.split("=")[1];
  const drop = args.includes("--drop");

  if (drop) {
    const email = emailArg;
    if (!email) {
      log("SEED_VOLUME BLOCKED reason=drop_exige_email");
      return 2;
    }
    assertSyntheticEmail(email);
    const id = psql(`select id from auth.users where email = '${email}'`);
    if (!id) {
      log("SEED_VOLUME DROP nada_a_remover");
      return 0;
    }
    await admin.from("audit_logs").delete().eq("actor_user_id", id);
    const removed = await admin.auth.admin.deleteUser(id);
    if (removed.error) {
      log(`SEED_VOLUME BLOCKED reason=drop_falhou code=${removed.error.status ?? "?"}`);
      return 1;
    }
    log(`SEED_VOLUME=DROPPED email=${email}`);
    return 0;
  }

  const email = emailArg ?? `stage26-volume-${randomUUID().replaceAll("-", "").slice(0, 10)}@elyra.invalid`;
  assertSyntheticEmail(email);
  const password = `Qa${randomUUID().replaceAll("-", "")}9`;

  let userId = psql(`select id from auth.users where email = '${email}'`);
  if (!userId) {
    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Pessoa Volume QA" },
    });
    if (created.error || !created.data.user) {
      log(`SEED_VOLUME BLOCKED reason=criacao_falhou code=${created.error?.status ?? "?"}`);
      return 1;
    }
    userId = created.data.user.id;
    const consent = await admin.from("consent_events").insert({
      user_id: userId,
      purpose: "terms_privacy",
      document_version: "v1",
      event_type: "granted",
    });
    if (consent.error) log(`SEED_VOLUME WARN consentimento=${consent.error.code ?? "?"}`);
  }

  const t0 = Date.now();
  /*
    Tudo em SQL, num unico ida-e-volta por dominio: 900 inserts pela API
    custariam minutos e nao e isso que esta sendo medido. Texto deliberadamente
    ficticio e repetitivo — nenhum dado de pessoa real entra aqui.
  */
  psql(`
    insert into public.emotional_checkins
      (user_id, occurred_at, mood_score, perceived_anxiety_score, energy_score, primary_feeling, note)
    select '${userId}',
           now() - (g || ' days')::interval,
           3 + (g % 5), 1 + (g % 4), 2 + (g % 4),
           (array['feliz','tranquilo','neutro','triste','ansioso'])[1 + (g % 5)],
           'Nota sintetica de volume ' || g
    from generate_series(1, ${VOLUME.checkins}) g;

    insert into public.emotional_checkin_factors (checkin_id, factor_id)
    select c.id, f.id
    from public.emotional_checkins c
    cross join lateral (
      select id from public.emotional_factors
      where owner_user_id is null
      order by md5(c.id::text || id::text)
      limit ${VOLUME.factorsPerCheckin}
    ) f
    where c.user_id = '${userId}'
    on conflict do nothing;

    insert into public.journal_entries (user_id, title, content, status, created_at, updated_at)
    select '${userId}',
           'Anotacao sintetica ' || g,
           repeat('Texto sintetico de volume para medir payload. ', 12),
           'saved',
           now() - (g || ' days')::interval,
           now() - (g || ' days')::interval
    from generate_series(1, ${VOLUME.journal}) g;

    insert into public.sleep_records (user_id, night, duration_minutes, sleep_quality_score)
    select '${userId}', (current_date - g), 360 + (g % 120), 2 + (g % 4)
    from generate_series(1, ${VOLUME.sleep}) g
    on conflict do nothing;

    insert into public.goals (user_id, title, kind, status, recurrence, target, unit)
    select '${userId}', 'Meta sintetica ' || g, 'frequency',
           case when g % 7 = 0 then 'paused' else 'active' end,
           'daily', 3, null
    from generate_series(1, ${VOLUME.goals}) g;

    insert into public.goal_progress_entries (goal_id, occurred_on, amount)
    select gl.id, (current_date - s), 1
    from public.goals gl
    cross join generate_series(1, ${VOLUME.progressPerGoal}) s
    where gl.user_id = '${userId}' and gl.status = 'active'
    on conflict do nothing;

    insert into public.cycle_profiles (user_id, enabled, opted_in_at)
    values ('${userId}', true, now())
    on conflict (user_id) do update set enabled = true, opted_in_at = coalesce(public.cycle_profiles.opted_in_at, now());

    insert into public.cycle_daily_records (user_id, record_date, flow, note)
    select '${userId}', (current_date - g),
           (array['light','medium','heavy'])[1 + (g % 3)],
           'Registro sintetico ' || g
    from generate_series(1, ${VOLUME.cycleRecords}) g
    on conflict do nothing;
  `);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);

  const counts = psql(`
    select
      (select count(*) from public.emotional_checkins where user_id = '${userId}') || ' checkins, ' ||
      (select count(*) from public.emotional_checkin_factors f join public.emotional_checkins c on c.id = f.checkin_id where c.user_id = '${userId}') || ' fatores, ' ||
      (select count(*) from public.journal_entries where user_id = '${userId}') || ' anotacoes, ' ||
      (select count(*) from public.sleep_records where user_id = '${userId}') || ' sonos, ' ||
      (select count(*) from public.goals where user_id = '${userId}') || ' metas, ' ||
      (select count(*) from public.goal_progress_entries p join public.goals g on g.id = p.goal_id where g.user_id = '${userId}') || ' progressos, ' ||
      (select count(*) from public.cycle_daily_records where user_id = '${userId}') || ' registros de ciclo'
  `);

  log(`SEED_VOLUME=PASS email=${email} seconds=${seconds}`);
  log(`SEED_VOLUME COUNTS ${counts}`);
  log(`SEED_VOLUME CREDENTIAL password_env=SEED_VOLUME_PASSWORD (nao impressa)`);
  process.env.SEED_VOLUME_PASSWORD = password;
  // A senha vai para stdout **apenas** quando pedida explicitamente, para o
  // medidor poder entrar. Conta sintetica, banco local, dado ficticio.
  if (args.includes("--print-credentials")) log(`SEED_VOLUME PASSWORD ${password}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    log(`SEED_VOLUME BLOCKED reason=erro message=${String(error?.message ?? error).slice(0, 160)}`);
    process.exitCode = 1;
  });
