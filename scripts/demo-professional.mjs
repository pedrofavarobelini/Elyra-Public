

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

import {
  DAY,
  DIRECTORY_PEERS,
  PEOPLE,
  ensureConsent,
  findUserByEmail,
  must,
  seedPersonData,
  seedTrustProfile,
  seedVerificationEvidence,
} from "./lib/demo-fixtures.mjs";
import { demoTargetRefusal } from "./lib/demo-local-guard.mjs";

try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

export const DEMO_EMAIL = "public.professional@demo.invalid";
export const DEMO_PASSWORD = process.env.ELYRA_DEMO_PASSWORD ?? "";
const DEMO_URL = "http://localhost:3000/entrar?context=professional";
const DEMO_NAME = "Marina Demo";
const DEMO_REGISTRATION = "DEMO-LOCAL-0001";
const PERSON_EMAIL = (n) => `public.person.${n}@elyra.invalid`;
const PEER_EMAIL = (n) => `public.directory.${n}@elyra.invalid`;

function log(line = "") {
  process.stdout.write(`${line}\n`);
}

function show() {
  log("ELYRA PROFESSIONAL DEMO");
  log("");
  log("URL:");
  log(DEMO_URL);
  log("");
  log("E-mail:");
  log(DEMO_EMAIL);
  log("");
  log("Senha:");
  log(DEMO_PASSWORD ? "Configurada em .env.local; nao exibida." : "Ausente; gere ELYRA_DEMO_PASSWORD localmente.");
  log("");
  log("Credencial sintetica e exclusivamente local: so existe no Supabase local (127.0.0.1:54381).");
  log("Nunca reutilize esta senha em conta real, staging ou producao.");
}

/** Tudo que depende da conta profissional, sem apagar a conta. */
async function clearProfessionalFixtures(admin, professionalId) {
  await must(admin.from("professional_connections").delete().eq("professional_user_id", professionalId), "vinculos");
  await must(admin.from("professional_profiles").delete().eq("user_id", professionalId), "perfil profissional");
}

async function dropPeople(admin) {
  let removed = 0;
  for (const person of PEOPLE) {
    const user = await findUserByEmail(admin, PERSON_EMAIL(person.n));
    if (!user) continue;
    await must(admin.from("professional_connections").delete().eq("client_user_id", user.id), "vinculos da pessoa");
    await must(admin.from("audit_logs").delete().eq("actor_user_id", user.id), "audit da pessoa");
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`remover pessoa ficticia: ${error.message}`);
    removed += 1;
  }
  return removed;
}

async function seedPublicProfile(admin, professionalId) {
  /*
    PRO-5: perfil publico opt-in. Se o schema de descoberta ainda nao existir
    nesta base (migration nao aplicada), o seed segue sem ele e avisa.
  */
  const { error } = await admin.from("professional_public_profiles").upsert({
    user_id: professionalId,
    listed: true,
    display_name: DEMO_NAME,
    bio: "Psicologa da demonstracao local. Perfil ficticio para validar a descoberta da Elyra.",
    city: "Sao Paulo",
    state: "SP",
    modalities: ["online", "in_person"],
    areas: ["ansiedade", "sono_rotina", "estresse"],
    languages: ["pt", "es"],
  });
  if (error) {
    log(`  aviso: perfil publico nao gravado (${error.code ?? "?"}) - aplique as migrations do PRO-5`);
    return false;
  }
  return true;
}

async function dropPeers(admin) {
  let removed = 0;
  for (const peer of DIRECTORY_PEERS) {
    const user = await findUserByEmail(admin, PEER_EMAIL(peer.n));
    if (!user) continue;
    await admin.from("professional_public_profiles").delete().eq("user_id", user.id);
    await admin.from("professional_profiles").delete().eq("user_id", user.id);
    await admin.from("audit_logs").delete().eq("actor_user_id", user.id);
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw new Error(`remover perfil de diretorio: ${error.message}`);
    removed += 1;
  }
  return removed;
}

async function seedPeers(admin) {
  const now = Date.now();
  for (const peer of DIRECTORY_PEERS) {
    let user = await findUserByEmail(admin, PEER_EMAIL(peer.n));
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: PEER_EMAIL(peer.n),
        password: `Demo-${randomUUID()}`,
        email_confirm: true,
        user_metadata: { display_name: peer.name },
      });
      if (error || !data.user) throw new Error(`criar perfil de diretorio: ${error?.message ?? "?"}`);
      user = data.user;
    }
    await ensureConsent(admin, user.id);
    await admin.from("profiles").update({ display_name: peer.name }).eq("user_id", user.id);
    await must(
      admin.from("professional_profiles").upsert({
        user_id: user.id,
        council_region: "06",
        registration_number: `DEMO-LOCAL-000${peer.n}`,
        specialty: "Psicologia (DEMO)",
        verification_status: "verified",
        verification_reviewed_at: new Date(now - DAY).toISOString(),
        verification_review_due_at: new Date(now + 365 * DAY).toISOString(),
      }),
      "perfil profissional do diretorio",
    );
    const { error } = await admin.from("professional_public_profiles").upsert({
      user_id: user.id,
      listed: true,
      display_name: peer.name,
      bio: peer.bio,
      city: peer.city,
      state: peer.state,
      modalities: peer.modalities,
      areas: peer.areas,
      languages: peer.languages,
    });
    if (error) throw new Error(`perfil publico do diretorio: ${error.code ?? error.message}`);
    await seedVerificationEvidence(admin, user.id);
  }
  return DIRECTORY_PEERS.length;
}

async function seed(admin) {
  let professional = await findUserByEmail(admin, DEMO_EMAIL);
  if (professional) {
    const { error } = await admin.auth.admin.updateUserById(professional.id, {
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: DEMO_NAME },
      ban_duration: "none",
    });
    if (error) throw new Error(`restaurar conta demo: ${error.message}`);
    await admin.from("profiles").update({ display_name: DEMO_NAME }).eq("user_id", professional.id);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { display_name: DEMO_NAME },
    });
    if (error || !data.user) throw new Error(`criar conta demo: ${error?.message ?? "?"}`);
    professional = data.user;
  }
  const professionalId = professional.id;
  await ensureConsent(admin, professionalId);

  await dropPeople(admin);
  await clearProfessionalFixtures(admin, professionalId);

  const now = Date.now();
  await must(
    admin.from("professional_profiles").insert({
      user_id: professionalId,
      council_region: "06",
      registration_number: DEMO_REGISTRATION,
      specialty: "Psicologia (DEMO)",
      verification_status: "verified",
      verification_reviewed_at: new Date(now - DAY).toISOString(),
      verification_review_due_at: new Date(now + 365 * DAY).toISOString(),
    }),
    "perfil profissional",
  );
  const publicProfile = await seedPublicProfile(admin, professionalId);
  const trustProfile = await seedTrustProfile(admin, professionalId);
  await seedVerificationEvidence(admin, professionalId);

  for (const [index, person] of PEOPLE.entries()) {
    const { data, error } = await admin.auth.admin.createUser({
      email: PERSON_EMAIL(person.n),
      password: `Demo-${randomUUID()}`,
      email_confirm: true,
      user_metadata: { display_name: person.name },
    });
    if (error || !data.user) throw new Error(`criar pessoa ficticia: ${error?.message ?? "?"}`);
    const personId = data.user.id;
    await ensureConsent(admin, personId);
    const { journalEntryId } = await seedPersonData(admin, personId, index);

    const connectionId = randomUUID();
    const accepted = new Date(now - (90 - index * 15) * DAY).toISOString();
    await must(
      admin.from("professional_connections").insert({
        id: connectionId,
        client_user_id: personId,
        professional_user_id: professionalId,
        invited_by_user_id: personId,
        status: person.status,
        accepted_at: accepted,
        paused_at: person.status === "paused" ? new Date(now - 3 * DAY).toISOString() : null,
      }),
      "vinculo",
    );
    await must(
      admin.from("sharing_permissions").insert(
        person.scopes.map((scope) => ({
          connection_id: connectionId,
          scope,
          journal_entry_id: scope === "journal_entry" ? journalEntryId : null,
          expires_at: person.validDays ? new Date(now + person.validDays * DAY).toISOString() : null,
          data_from: person.windowDays ? new Date(now - person.windowDays * DAY).toISOString().slice(0, 10) : null,
        })),
      ),
      "grants",
    );
  }

  const peers = await seedPeers(admin);
  log("DEMO_PROFESSIONAL=SEEDED");
  log(`  diretorio: ${peers + 1} perfis DEMO listados (Marina + ${peers}; registros DEMO-LOCAL, nenhum real)`);
  log(`  conta profissional: ${DEMO_EMAIL} (verificada localmente, registro ${DEMO_REGISTRATION})`);
  log(`  perfil publico de descoberta: ${publicProfile ? "ligado" : "indisponivel nesta base"}`);
  log(`  perfil de confianca: ${trustProfile ? "1 formacao verificada, 1 experiencia e 1 certificacao declaradas" : "indisponivel nesta base"}`);
  log(`  pessoas ficticias: ${PEOPLE.length} (${PEOPLE.filter((p) => p.status === "active").length} ativas, ${PEOPLE.filter((p) => p.status === "paused").length} pausada)`);
  log("");
  show();
}

async function drop(admin) {
  const removedPeople = await dropPeople(admin);
  const removedPeers = await dropPeers(admin);
  const professional = await findUserByEmail(admin, DEMO_EMAIL);
  if (professional) {
    await clearProfessionalFixtures(admin, professional.id);
    await must(admin.from("audit_logs").delete().eq("actor_user_id", professional.id), "audit da demo");
    const { error } = await admin.auth.admin.deleteUser(professional.id);
    if (error) throw new Error(`remover conta demo: ${error.message}`);
  }
  log(`DEMO_PROFESSIONAL=DROPPED conta=${professional ? 1 : 0} pessoas=${removedPeople} diretorio=${removedPeers}`);
}


async function check(admin) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const next = (reason, step) => {
    log(`DEMO_PROFESSIONAL_CHECK=FAIL reason=${reason}`);
    log(`  proximo passo: ${step}`);
    return 1;
  };
  log(`  alvo: ${url}`);

  let reachable = false;
  try {
    const health = await fetch(`${url}/auth/v1/health`, { signal: AbortSignal.timeout(5_000) });
    reachable = health.ok;
  } catch {
    reachable = false;
  }
  log(`  SUPABASE_AUTH_REACHABLE=${reachable ? "YES" : "NO"}`);
  if (!reachable) return next("supabase_unreachable", "abra o Docker e rode npm run demo (ele sobe o Supabase local)");

  const probe = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  log(`  SERVICE_KEY_MATCHES_INSTANCE=${probe.error ? "NO" : "YES"}`);
  if (probe.error) return next("service_key_mismatch", "npm run qa:env:local (regera as chaves do Supabase local; nao apaga outras)");

  const user = await findUserByEmail(admin, DEMO_EMAIL);
  log(`  USER_EXISTS=${user ? "YES" : "NO"}`);
  if (!user) {
    return next(
      "account_missing",
      "npm run demo:professional -- --seed  (a base local nao tem a demo: nunca semeada nesta maquina, ou apagada por qa:db:reset/E2E)",
    );
  }
  const banned = Boolean(user.banned_until && new Date(user.banned_until) > new Date());
  log(`  EMAIL_CONFIRMED=${user.email_confirmed_at ? "YES" : "NO"} BANNED=${banned ? "YES" : "NO"} DELETED=${user.deleted_at ? "YES" : "NO"}`);
  if (!user.email_confirmed_at || banned || user.deleted_at) {
    return next("account_state", "npm run demo:professional -- --seed  (restaura confirmacao e remove bloqueio)");
  }

  const anon = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: authError } = await anon.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  log(`  DIRECT_AUTH=${authError ? `FAIL code=${authError.code ?? "?"} status=${authError.status ?? "?"}` : "PASS"}`);
  if (authError) {
    if (authError.status === 429) return next("auth_rate_limited", "aguarde alguns minutos e rode --check de novo (nao precisa reseedar)");
    return next("password_mismatch", "npm run demo:professional -- --seed  (restaura a senha conhecida)");
  }
  await anon.auth.signOut();

  const { data: profile, error: profileError } = await admin
    .from("professional_profiles")
    .select("verification_status, registration_number, verification_review_due_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  const current =
    profile?.verification_status === "verified" &&
    (!profile.verification_review_due_at || new Date(profile.verification_review_due_at) > new Date());
  log(`  PROFESSIONAL_PROFILE=${profile ? "YES" : "NO"} status=${profile?.verification_status ?? "-"} registro=${profile?.registration_number ?? "-"} vigente=${current ? "YES" : "NO"}`);
  if (!current) return next("profile_not_verified", "npm run demo:professional -- --seed");

  const { data: pub } = await admin.from("professional_public_profiles").select("listed").eq("user_id", user.id).maybeSingle();
  const { data: connections, error: connError } = await admin
    .from("professional_connections")
    .select("id, status")
    .eq("professional_user_id", user.id);
  if (connError) throw connError;
  const active = connections.filter((c) => c.status === "active").length;
  const paused = connections.filter((c) => c.status === "paused").length;
  const { count: grants } = await admin
    .from("sharing_permissions")
    .select("id", { count: "exact", head: true })
    .in("connection_id", connections.map((c) => c.id));
  const { data: trust } = await admin.from("professional_credentials").select("trust_state").eq("user_id", user.id);
  log(`  TRUST_CREDENTIALS=${trust?.length ?? 0} VERIFIED=${(trust ?? []).filter((c) => c.trust_state === "verified").length}`);
  const { data: evidence } = await admin
    .from("professional_verification_evidence")
    .select("source_type,status")
    .eq("professional_user_id", user.id);
  const demoEvidence = (evidence ?? []).filter((row) => row.source_type === "demo_local" && row.status === "PASS").length;
  log(`  VERIFICATION_EVIDENCE=${evidence?.length ?? 0} DEMO_LOCAL_PASS=${demoEvidence} (sintetica, nunca verificacao real)`);
  log(`  PUBLIC_PROFILE_LISTED=${pub?.listed ? "YES" : "NO"} PEOPLE=${connections.length} ACTIVE=${active} PAUSED=${paused} GRANTS=${grants ?? 0}`);
  const { count: listed } = await admin
    .from("professional_public_profiles")
    .select("user_id", { count: "exact", head: true })
    .eq("listed", true)
    .like("display_name", "% Demo");
  log(`  DIRECTORY_DEMO_LISTED=${listed ?? 0} (esperado ${DIRECTORY_PEERS.length + 1})`);
  if (connections.length !== 4 || active !== 3 || paused !== 1 || !grants || !pub?.listed || (listed ?? 0) < DIRECTORY_PEERS.length + 1) {
    return next("demo_data_incomplete", "npm run demo:professional -- --seed  (recria as pessoas e os vinculos)");
  }

  log("DEMO_PROFESSIONAL_CHECK=PASS");
  log(`  entre em ${DEMO_URL}`);
  return 0;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const mode = ["--seed", "--show", "--drop", "--check"].find((flag) => args.has(flag));
  if (!mode) {
    log("Uso: npm run demo:professional -- --seed | --show | --drop | --check");
    log("  (no PowerShell, mantenha o `--` antes da opcao)");
    return 2;
  }
  // `--show` nao escreve nada, mas so faz sentido contra a base local.
  const refusal = demoTargetRefusal(process.env);
  if (refusal) {
    log(`DEMO_PROFESSIONAL=ABORT reason=${refusal}`);
    log("  A demo profissional so existe no Supabase local (npm run supabase:start + npm run qa:env:local).");
    return 2;
  }
  if (mode === "--show") {
    show();
    return 0;
  }
  if (mode !== "--drop" && !DEMO_PASSWORD) throw new Error("Configure ELYRA_DEMO_PASSWORD com valor aleatorio novo em .env.local antes de seed/check");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (mode === "--check") return check(admin);
  if (mode === "--drop") await drop(admin);
  else await seed(admin);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    log(`DEMO_PROFESSIONAL=BLOCKED message=${String(error?.message ?? error).slice(0, 200)}`);
    process.exitCode = 1;
  });
