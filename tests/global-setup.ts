import { chromium, type FullConfig } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  CUSTOM_FACTORS,
  CUSTOM_TAGS,
  MOCK_CHECKINS,
  MOCK_GOALS,
  MOCK_GOAL_PROGRESS,
  MOCK_JOURNAL,
  MOCK_SLEEP,
} from "@/mocks/data";
import {
  CUSTOM_SYMPTOMS,
  mockCycleRecords,
  mockPeriods,
} from "@/mocks/cycle-data";
import type { Database } from "@/lib/supabase/database.types";
import { cleanupQaUser } from "./qa-cleanup";
import { createConfirmedQaUser, loginThroughUi } from "./qa-identity";


interface QaIdentity {
  project: string;
  email: string;
  password: string;
  userId: string;
}

async function seedProfessionalQa(
  admin: SupabaseClient<Database>,
  professionalUserId: string,
  patientUserId: string,
) {
  const { error: professionalError } = await admin
    .from("professional_profiles")
    .insert({
      user_id: professionalUserId,
      // Unico por conta: a credencial normalizada e unica por conselho+regiao (PRO-1).
      registration_number: `QA-ELYRA-${professionalUserId.slice(0, 8)}`,
      specialty: "Acompanhamento sintetico",
      council_region: "06",

      verification_status: "verified",
      verification_reviewed_at: new Date().toISOString(),
      verification_review_due_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    });
  if (professionalError) throw professionalError;

  const connectionId = crypto.randomUUID();
  const acceptedAt = new Date().toISOString();
  const { error: connectionError } = await admin
    .from("professional_connections")
    .insert({
      id: connectionId,
      client_user_id: patientUserId,
      professional_user_id: professionalUserId,
      invited_by_user_id: patientUserId,
      status: "active",
      accepted_at: acceptedAt,
    });
  if (connectionError) throw connectionError;

  const { data: journalEntry, error: journalError } = await admin
    .from("journal_entries")
    .select("id")
    .eq("user_id", patientUserId)
    .eq("status", "saved")
    .is("trashed_at", null)
    .limit(1)
    .single();
  if (journalError || !journalEntry) throw journalError ?? new Error("Entrada QA ausente.");

  const { error: permissionError } = await admin
    .from("sharing_permissions")
    .insert([
      ...[
        "emotional",
        "sleep",
        "goals",
        "cycle",
        "reports",
        "multimodal_result",
      ].map((scope) => ({
        connection_id: connectionId,
        scope,
        journal_entry_id: null,
      })),
      {
        connection_id: connectionId,
        scope: "journal_entry",
        journal_entry_id: journalEntry.id,
      },
    ]);
  if (permissionError) throw permissionError;
}

function normalizeIdentities(raw: unknown): QaIdentity[] {
  if (Array.isArray(raw)) return raw as QaIdentity[];
  return raw && typeof raw === "object" ? [raw as QaIdentity] : [];
}

async function seedEmotionalQa(
  admin: SupabaseClient<Database>,
  userId: string,
) {
  const customFactorId = crypto.randomUUID();
  const customTemplate = CUSTOM_FACTORS[0];
  if (!customTemplate) throw new Error("Seed custom factor ausente.");

  const { error: factorError } = await admin.from("emotional_factors").insert({
    id: customFactorId,
    label: customTemplate.label,
    origin: "custom",
    owner_user_id: userId,
  });
  if (factorError) throw factorError;

  const checkinIds = new Map<string, string>();
  const { error: checkinError } = await admin.from("emotional_checkins").insert(
    MOCK_CHECKINS.map((checkin) => {
      const id = crypto.randomUUID();
      checkinIds.set(checkin.id, id);
      return {
        id,
        user_id: userId,
        occurred_at: checkin.occurredAt,
        mood_score: checkin.mood,
        perceived_anxiety_score: checkin.perceivedAnxiety,
        energy_score: checkin.energy,
        primary_feeling: checkin.primaryFeeling,
        note: checkin.note,
      };
    }),
  );
  if (checkinError) throw checkinError;

  const links = MOCK_CHECKINS.flatMap((checkin) =>
    checkin.factorIds.map((factorId) => ({
      checkin_id: checkinIds.get(checkin.id) ?? "",
      factor_id:
        factorId === customTemplate.id ? customFactorId : factorId,
    })),
  );
  if (links.length > 0) {
    const { error } = await admin.from("emotional_checkin_factors").insert(links);
    if (error) throw error;
  }

  const { error: sleepError } = await admin.from("sleep_records").insert(
    MOCK_SLEEP.map((record) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      night: record.night,
      duration_minutes: record.durationMinutes,
      sleep_quality_score: record.quality,
    })),
  );
  if (sleepError) throw sleepError;
}

const SYSTEM_TAG_IDS: Record<string, string> = {
  "t-gratidao": "20000000-0000-4000-8000-000000000001",
  "t-trabalho": "20000000-0000-4000-8000-000000000002",
  "t-reflexao": "20000000-0000-4000-8000-000000000003",
  "t-relacoes": "20000000-0000-4000-8000-000000000004",
};

async function seedStage06Qa(
  admin: SupabaseClient<Database>,
  userId: string,
) {
  const tagIds = new Map<string, string>(Object.entries(SYSTEM_TAG_IDS));
  for (const tag of CUSTOM_TAGS) {
    const id = crypto.randomUUID();
    tagIds.set(tag.id, id);
    const { error } = await admin.from("journal_tags").insert({
      id,
      label: tag.label,
      origin: "custom",
      owner_user_id: userId,
    });
    if (error) throw error;
  }

  const entryIds = new Map<string, string>();
  const { error: journalError } = await admin.from("journal_entries").insert(
    MOCK_JOURNAL.map((entry) => {
      const id = crypto.randomUUID();
      entryIds.set(entry.id, id);
      return {
        id,
        user_id: userId,
        title: entry.title,
        content: entry.content,
        status: entry.status,
        created_at: entry.createdAt,
        updated_at: entry.updatedAt,
        trashed_at: entry.trashedAt,
      };
    }),
  );
  if (journalError) throw journalError;

  const journalLinks = MOCK_JOURNAL.flatMap((entry) =>
    entry.tagIds.map((tagId) => ({
      entry_id: entryIds.get(entry.id) ?? "",
      tag_id: tagIds.get(tagId) ?? "",
    })),
  );
  if (journalLinks.length > 0) {
    const { error } = await admin.from("journal_entry_tags").insert(journalLinks);
    if (error) throw error;
  }

  const goalIds = new Map<string, string>();
  const { error: goalsError } = await admin.from("goals").insert(
    MOCK_GOALS.map((goal) => {
      const id = crypto.randomUUID();
      goalIds.set(goal.id, id);
      return {
        id,
        user_id: userId,
        title: goal.title,
        kind: goal.kind,
        status: goal.status,
        recurrence: goal.recurrence,
        target: goal.target,
        unit: goal.unit,
        created_at: goal.createdAt,
      };
    }),
  );
  if (goalsError) throw goalsError;

  const { error: progressError } = await admin.from("goal_progress_entries").insert(
    MOCK_GOAL_PROGRESS.map((entry) => ({
      id: crypto.randomUUID(),
      goal_id: goalIds.get(entry.goalId) ?? "",
      occurred_on: entry.day,
      amount: entry.amount,
    })),
  );
  if (progressError) throw progressError;
}

const SYSTEM_CYCLE_SYMPTOM_IDS: Record<string, string> = {
  "sy-colica": "30000000-0000-4000-8000-000000000001",
  "sy-cabeca": "30000000-0000-4000-8000-000000000002",
  "sy-sensibilidade": "30000000-0000-4000-8000-000000000003",
  "sy-cansaco": "30000000-0000-4000-8000-000000000004",
  "sy-inchaco": "30000000-0000-4000-8000-000000000005",
  "sy-apetite": "30000000-0000-4000-8000-000000000006",
};

async function seedStage07Qa(
  admin: SupabaseClient<Database>,
  userId: string,
) {
  const { error: profileError } = await admin.from("cycle_profiles").insert({
    user_id: userId,
    enabled: false,
    opted_in_at: null,
  });
  if (profileError) throw profileError;

  const { error: periodError } = await admin.from("cycle_periods").insert(
    mockPeriods().map((period) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      start_date: period.startDate,
      end_date: period.endDate,
    })),
  );
  if (periodError) throw periodError;

  const symptomIds = new Map<string, string>(
    Object.entries(SYSTEM_CYCLE_SYMPTOM_IDS),
  );
  for (const symptom of CUSTOM_SYMPTOMS) {
    const id = crypto.randomUUID();
    symptomIds.set(symptom.id, id);
    const { error } = await admin.from("cycle_symptoms").insert({
      id,
      label: symptom.label,
      origin: "custom",
      owner_user_id: userId,
    });
    if (error) throw error;
  }

  const recordIds = new Map<string, string>();
  const records = mockCycleRecords();
  const { error: recordError } = await admin.from("cycle_daily_records").insert(
    records.map((record) => {
      const id = crypto.randomUUID();
      recordIds.set(record.id, id);
      return {
        id,
        user_id: userId,
        record_date: record.date,
        flow: record.flow,
        note: record.note,
      };
    }),
  );
  if (recordError) throw recordError;

  const links = records.flatMap((record) =>
    record.symptoms.map((symptom) => ({
      record_id: recordIds.get(record.id) ?? "",
      symptom_id: symptomIds.get(symptom.symptomId) ?? "",
      severity: symptom.severity,
    })),
  );
  if (links.length > 0) {
    const { error } = await admin.from("cycle_daily_symptoms").insert(links);
    if (error) throw error;
  }
}



const AQUECIMENTO_MS_SAUDAVEL = 1_500;
const AQUECIMENTO_TENTATIVAS = 30;
/**
 * Acima do pool padrao do PostgREST (10), de proposito.
 *
 * Sondagem sequencial nao serve: ela reaproveita a conexao que acabou de ser
 * consertada e devolve "rapido" enquanto o resto do pool continua morto. Foi o
 * que aconteceu na segunda versao deste aquecimento - as sondas passaram e
 * `set_cycle_enabled` ainda levou 7338 ms depois. So uma rajada concorrente
 * maior que o pool obriga **todas** as conexoes a serem tocadas.
 */
const AQUECIMENTO_CONCORRENCIA = 16;
/**
 * Teto de tempo total do aquecimento.
 *
 * Sem ele, 30 rajadas contra um pool degradado podiam consumir minutos antes de
 * o primeiro teste comecar - e foi o que aconteceu numa execucao em que a
 * maquina estava paginando: o aquecimento virou parte do problema que deveria
 * resolver.
 *
 * Aquecer e uma otimizacao, nao um pre-requisito. Se o ambiente nao esquentar
 * dentro do orcamento, o certo e seguir e deixar o aviso no log, e nao segurar a
 * suite indefinidamente.
 */
const AQUECIMENTO_ORCAMENTO_MS = 20_000;

async function aquecerSupabase(admin: SupabaseClient<Database>) {
  let consecutivasSaudaveis = 0;
  let pior = 0;
  const limite = performance.now() + AQUECIMENTO_ORCAMENTO_MS;

  for (let i = 0; i < AQUECIMENTO_TENTATIVAS; i++) {
    if (performance.now() >= limite) {
      console.warn(
        `[qa] aquecimento interrompido pelo orcamento de ${AQUECIMENTO_ORCAMENTO_MS} ms apos ${i} rajadas (ultima: ${pior} ms).`,
      );
      return;
    }
    const sondas = [
      // PostgREST: uma por conexao do pool, todas ao mesmo tempo.
      ...Array.from({ length: AQUECIMENTO_CONCORRENCIA }, () => async () => {
        await admin.from("profiles").select("user_id", { head: true, count: "exact" });
      }),
      // GoTrue tem pool proprio, e `/auth/v1/health` nao consulta o banco -
      // `listUsers` obriga a ida ate o Postgres, que e o custo real.
      async () => {
        await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
      },
    ];

    const inicio = performance.now();
    await Promise.all(
      sondas.map(async (sonda) => {
        try {
          await sonda();
        } catch {
          // Indisponibilidade momentanea e o proprio motivo de estarmos aqui.
        }
      }),
    );
    pior = Math.round(performance.now() - inicio);

    // Duas rajadas rapidas seguidas: uma so pode ser coincidencia de ordem.
    consecutivasSaudaveis = pior <= AQUECIMENTO_MS_SAUDAVEL ? consecutivasSaudaveis + 1 : 0;
    if (consecutivasSaudaveis >= 2) {
      if (i > 1) console.log(`[qa] pool do Supabase aquecido em ${i + 1} rajadas (ultima: ${pior} ms).`);
      return;
    }
  }

  // Nao derruba a suite: aquecer e uma protecao, e a falta dela vira sinal, nao
  // veredito. Quem le o relatorio precisa saber que a suite comecou em ambiente
  // lento - isso muda a leitura de qualquer falha que venha depois.
  console.warn(
    `[qa] pool do Supabase ainda lento apos ${AQUECIMENTO_TENTATIVAS} rajadas (ultima: ${pior} ms).`,
  );
}

export default async function globalSetup(config: FullConfig) {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Playwright QA local nao configurado.");

  const identityFile = resolve(
    process.cwd(),
    "test-results",
    ".auth",
    "identity.json",
  );
  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await aquecerSupabase(admin);

  if (existsSync(identityFile)) {
    const residues = normalizeIdentities(
      JSON.parse(readFileSync(identityFile, "utf8")),
    );
    for (const residue of residues) {
      await cleanupQaUser(admin, residue.userId);
    }
  }

  mkdirSync(dirname(identityFile), { recursive: true });
  const baseURL = String(config.projects[0]?.use.baseURL ?? "http://localhost:3100");

  const browser = await chromium.launch();
  const identities: QaIdentity[] = [];


  const persistIdentities = () => {
    writeFileSync(identityFile, JSON.stringify(identities), {
      encoding: "utf8",
      mode: 0o600,
    });
  };
  try {
    for (const project of config.projects) {
      const authFile = resolve(
        process.cwd(),
        "test-results",
        ".auth",
        `${project.name}.json`,
      );
      const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
      const email = `playwright-${project.name}-${run}@elyra.invalid`;
      const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
      const context = await browser.newContext();
      const page = await context.newPage();

      try {

        const userId = await createConfirmedQaUser(admin, {
          email,
          password,
          displayName: "Demo",
        });
        identities.push({ project: project.name, email, password, userId });
        persistIdentities();

        // A sessao precisa nascer no navegador para virar `storageState`.
        await loginThroughUi(page, baseURL, { email, password });
        await context.storageState({ path: authFile });
        persistIdentities();
        await seedEmotionalQa(admin, userId);
        await seedStage06Qa(admin, userId);
        await seedStage07Qa(admin, userId);

        const patientEmail = `playwright-patient-${project.name}-${run}@elyra.invalid`;
        const patientPassword = `Qa${crypto.randomUUID().replaceAll("-", "")}8`;
        const patientUserId = await createConfirmedQaUser(admin, {
          email: patientEmail,
          password: patientPassword,
          displayName: "Ana Paula QA",
        });
        identities.push({
          project: `${project.name}-patient`,
          email: patientEmail,
          password: patientPassword,
          userId: patientUserId,
        });
        persistIdentities();
        await seedEmotionalQa(admin, patientUserId);
        await seedStage06Qa(admin, patientUserId);
        await seedStage07Qa(admin, patientUserId);
        await seedProfessionalQa(admin, userId, patientUserId);
      } finally {
        await context.close();
      }
    }

    persistIdentities();
  } catch (error) {
    for (const identity of identities) {
      await cleanupQaUser(admin, identity.userId);
    }
    throw error;
  } finally {
    await browser.close();
  }
}
