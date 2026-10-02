

import { createHash, randomUUID } from "node:crypto";

export const DAY = 86_400_000;

/** Quatro perfis de diretorio alem do principal: so para a descoberta ter o que mostrar. */
export const DIRECTORY_PEERS = [
  {
    n: 2,
    name: "Rafael Demo",
    bio: "Perfil ficticio de demonstracao. Foco declarado em trabalho, estresse e organizacao da rotina.",
    city: "Rio de Janeiro",
    state: "RJ",
    modalities: ["online"],
    areas: ["trabalho_carreira", "estresse"],
    languages: ["pt", "en"],
  },
  {
    n: 3,
    name: "Camila Demo",
    bio: "Perfil ficticio de demonstracao. Foco declarado em relacoes e habilidades sociais.",
    city: "Belo Horizonte",
    state: "MG",
    modalities: ["online", "in_person"],
    areas: ["relacionamentos", "familia", "autoestima"],
    languages: ["pt"],
  },
  {
    n: 4,
    name: "Lucas Demo",
    bio: "Perfil ficticio de demonstracao. Foco declarado em universitarios e transicoes de vida.",
    city: "Cidade Demo",
    state: "SP",
    modalities: ["in_person"],
    areas: ["transicoes", "adolescencia", "ansiedade"],
    languages: ["pt", "libras"],
  },
  {
    n: 5,
    name: "Fernanda Demo",
    bio: "Perfil ficticio de demonstracao. Foco declarado em habitos, bem-estar e rotina.",
    city: "Curitiba",
    state: "PR",
    modalities: ["online"],
    areas: ["sono_rotina", "estresse", "autoestima"],
    languages: ["pt", "es"],
  },
];

/** Pessoas acompanhadas ficticias do profissional principal (ninguem entra nelas). */
export const PEOPLE = [
  { n: 1, name: "Aline Demo", status: "active", scopes: ["emotional", "sleep", "goals", "reports"], windowDays: null, validDays: null },
  { n: 2, name: "Bruno Demo", status: "active", scopes: ["emotional", "sleep"], windowDays: 45, validDays: 12 },
  { n: 3, name: "Carla Demo", status: "active", scopes: ["emotional", "journal_entry"], windowDays: null, validDays: null },
  { n: 4, name: "Davi Demo", status: "paused", scopes: ["emotional", "sleep", "goals"], windowDays: null, validDays: null },
];

export async function findUserByEmail(admin, email) {
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === target);
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  return null;
}

export async function must(result, what) {
  const { error } = await result;
  if (error) throw new Error(`${what}: ${error.code ?? ""} ${error.message ?? ""}`.trim());
}

export async function ensureConsent(admin, userId) {
  const { data, error } = await admin
    .from("consent_events")
    .select("id")
    .eq("user_id", userId)
    .eq("purpose", "terms_privacy")
    .eq("event_type", "granted")
    .limit(1);
  if (error) throw error;
  if (data.length > 0) return;
  await must(
    admin.from("consent_events").insert({
      user_id: userId,
      purpose: "terms_privacy",
      document_version: "v1",
      event_type: "granted",
    }),
    "consentimento",
  );
}

/** Humor, sono, metas e uma entrada de diario, com lacunas de proposito. */
export async function seedPersonData(admin, userId, index) {
  const now = Date.now();
  const feelings = ["tranquilo", "neutro", "feliz", "ansioso"];
  const checkins = [];
  for (let day = 1; day <= 75; day += 1) {
    // Lacunas de proposito: dia sem registro fica em branco (NULL nao e zero).
    if ((day + index) % 5 === 0) continue;
    const wave = Math.round(2 * Math.sin((day + index * 7) / 6));
    checkins.push({
      user_id: userId,
      occurred_at: new Date(now - day * DAY).toISOString(),
      mood_score: Math.min(10, Math.max(0, 6 + wave)),
      perceived_anxiety_score: Math.min(10, Math.max(0, 5 - wave + (index % 2))),
      energy_score: Math.min(10, Math.max(0, 5 + Math.round(wave / 2))),
      primary_feeling: feelings[(day + index) % feelings.length],
      note: null,
    });
  }
  await must(admin.from("emotional_checkins").insert(checkins), "check-ins");

  const sleep = [];
  for (let day = 1; day <= 60; day += 1) {
    if ((day + index) % 6 === 0) continue;
    sleep.push({
      user_id: userId,
      night: new Date(now - day * DAY).toISOString().slice(0, 10),
      duration_minutes: 360 + ((day * 17 + index * 23) % 150),
      sleep_quality_score: 5 + ((day + index) % 4),
    });
  }
  await must(admin.from("sleep_records").insert(sleep), "sono");

  await must(
    admin.from("goals").insert([
      { user_id: userId, title: "Caminhar 20 minutos", kind: "frequency", status: "active", recurrence: "weekly", target: 3, unit: null },
      { user_id: userId, title: "Registrar o dia antes de dormir", kind: "frequency", status: "active", recurrence: "daily", target: 1, unit: null },
    ]),
    "metas",
  );

  const { data: entry, error } = await admin
    .from("journal_entries")
    .insert({
      user_id: userId,
      title: "Semana de demonstracao",
      content: "Texto ficticio de demonstracao. Nenhum dado pessoal real.",
      status: "saved",
    })
    .select("id")
    .single();
  if (error) throw error;
  return { journalEntryId: entry.id };
}

/** Perfil de confianca: 1 formacao "verificada" por documento ficticio, 2 declaradas. */
export async function seedTrustProfile(admin, professionalId) {
  await admin.from("professional_credentials").delete().eq("user_id", professionalId);
  const verifiedDigest = createHash("sha256").update("elyra-demo-education").digest("hex");
  const { error } = await admin.from("professional_credentials").insert([
    {
      user_id: professionalId,
      kind: "education",
      title: "Psicologia (DEMO)",
      institution: "Universidade Ficticia da Demonstracao",
      start_year: 2010,
      end_year: 2015,
      trust_state: "verified",
      verified_at: new Date(Date.now() - DAY).toISOString(),
      evidence_digest: verifiedDigest,
      verification_source: "document_manual",
      policy_version: "stage29.f5.v1",
      position: 0,
    },
    {
      user_id: professionalId,
      kind: "experience",
      title: "Atendimento clinico (DEMO)",
      institution: "Clinica Ficticia",
      start_year: 2016,
      end_year: null,
      trust_state: "declared",
      position: 0,
    },
    {
      user_id: professionalId,
      kind: "certification",
      title: "Formacao complementar (DEMO)",
      institution: "Emissor Ficticio",
      expires_on: new Date(Date.now() + 365 * DAY).toISOString().slice(0, 10),
      trust_state: "declared",
      position: 0,
    },
  ]);
  return !error;
}

/**
 * Evidencia sintetica dos 7 gates, `source_type = demo_local`. O banco so a
 * ACEITA numa decisao automatica com `accept_fixture_evidence` ligado (so
 * local); fora dele ela aparece como origem "demo" e nao prova nada.
 */
export async function seedVerificationEvidence(admin, professionalId) {
  const item = (fact, extra = {}) => ({
    fact_type: fact,
    source_type: "demo_local",
    provider: "elyra_demo_seed",
    status: "PASS",
    detail: "demo_local_synthetic",
    policy_version: "stage29.v2",
    ...extra,
  });
  const { error } = await admin.rpc("record_verification_evidence_for", {
    p_professional_user_id: professionalId,
    p_submission: 0,
    p_items: [
      item("auth_account"),
      item("required_terms"),
      item("registry_format"),
      item("identity_match", { assurance: "identity_document_crosschecked" }),
      item("professional_registry"),
      item("registry_holder_match"),
      item("registry_status"),
    ],
  });
  if (error) throw new Error(`evidencia da demo: ${error.message}`);
}

/**
 * Perfil profissional "verificado" de DEMONSTRACAO: status escrito pelo
 * executor administrativo, registro `DEMO-<prefixo>-000N` (nunca CRP real),
 * especialidade marcada "(DEMO)". Nao e verificacao externa de ninguem.
 */
export async function upsertDemoProfessionalProfile(admin, userId, registration) {
  const now = Date.now();
  await must(
    admin.from("professional_profiles").upsert({
      user_id: userId,
      council_region: "06",
      registration_number: registration,
      specialty: "Psicologia (DEMO)",
      verification_status: "verified",
      verification_reviewed_at: new Date(now - DAY).toISOString(),
      verification_review_due_at: new Date(now + 365 * DAY).toISOString(),
    }),
    "perfil profissional",
  );
}

export async function upsertPublicProfile(admin, userId, profile) {
  const { error } = await admin.from("professional_public_profiles").upsert({
    user_id: userId,
    listed: true,
    display_name: profile.name,
    bio: profile.bio,
    city: profile.city,
    state: profile.state,
    modalities: profile.modalities,
    areas: profile.areas,
    languages: profile.languages,
  });
  if (error) throw new Error(`perfil publico: ${error.code ?? error.message}`);
}

/** Cria a conta confirmada ou devolve a existente; `password` so vale na criacao. */
export async function ensureConfirmedUser(admin, { email, name, password }) {
  const existing = await findUserByEmail(admin, email);
  if (existing) return { user: existing, created: false };
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: password ?? `Demo-${randomUUID()}`,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (error || !data.user) throw new Error(`criar conta ${email.split("@")[1]}: ${error?.message ?? "?"}`);
  return { user: data.user, created: true };
}
