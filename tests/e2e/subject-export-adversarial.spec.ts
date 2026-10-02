import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { subjectDataExportSchema } from "@/lib/contracts/subject-rights";
import type { Database } from "@/lib/supabase/database.types";
import {
  SUBJECT_EXPORT_EXCLUSIONS,
  SUBJECT_EXPORT_REGISTRY,
} from "@/server/subject-export/registry";
import { cleanupQaUser } from "../qa-cleanup";
import { createConfirmedQaUser } from "../qa-identity";
import { gotoHydrated } from "./hydrated";

interface QaIdentity {
  project: string;
  email: string;
  password: string;
  userId: string;
}

async function login(
  browser: Browser,
  baseURL: string,
  identity: Pick<QaIdentity, "email" | "password">,
) {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await gotoHydrated(page, `${baseURL}/entrar`);
  await page.getByLabel("E-mail").fill(identity.email);
  await page.getByLabel("Senha", { exact: true }).fill(identity.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return { context, page };
}

async function exportSubject(page: Page, actor: string) {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/me/export", { cache: "no-store" });
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      body: await response.json(),
    };
  });
  expect(result.status, `${actor}: ${JSON.stringify(result.body)}`).toBe(200);
  expect(result.contentType).toContain("application/json");
  expect(result.cacheControl).toContain("no-store");
  return subjectDataExportSchema.parse(result.body);
}

function expectRegistryShape(payload: ReturnType<typeof subjectDataExportSchema.parse>) {
  expect(Object.keys(payload.data).sort()).toEqual(
    SUBJECT_EXPORT_REGISTRY.map((descriptor) => descriptor.table).sort(),
  );
  expect(payload.excluded.sort()).toEqual(
    SUBJECT_EXPORT_EXCLUSIONS.map((descriptor) => descriptor.table).sort(),
  );
  for (const exclusion of SUBJECT_EXPORT_EXCLUSIONS) {
    expect(payload.data).not.toHaveProperty(exclusion.table);
  }
}

/**
 * Nada de credencial, token ou URL assinada sai na portabilidade.
 *
 * A exportacao e o unico ponto do produto que serializa varias tabelas de uma
 * vez: se um campo interno vazasse para o schema, e aqui que ele apareceria.
 */
function expectNoSecretMaterial(
  payload: ReturnType<typeof subjectDataExportSchema.parse>,
) {
  const serialized = JSON.stringify(payload);
  const forbidden = [
    "password",
    "encrypted_password",
    "service_role",
    "SUPABASE_SERVICE_ROLE_KEY",
    "refresh_token",
    "access_token",
    "api_key",
    "apikey",
    "authorization",
    "eyJhbGciOi",
    "X-Amz-Signature",
    "?token=",
    "storage_path",
    "event_key",
  ];
  for (const marker of forbidden) {
    expect(
      serialized.toLowerCase().includes(marker.toLowerCase()),
      `Material sensivel "${marker}" no export`,
    ).toBe(false);
  }
}

function containsMarker(
  payload: ReturnType<typeof subjectDataExportSchema.parse>,
  marker: string,
) {
  return JSON.stringify(payload.data).includes(marker);
}

test("subject export separa paciente, profissional e nao relacionado e exclui a conta", async ({
  browser,
  baseURL,
  page,
}, testInfo) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) {
    throw new Error("Playwright QA local nao configurado.");
  }

  const identities = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test-results", ".auth", "identity.json"),
      "utf8",
    ),
  ) as QaIdentity[];
  const professional = identities.find(
    (candidate) => candidate.project === testInfo.project.name,
  );
  const patient = identities.find(
    (candidate) => candidate.project === `${testInfo.project.name}-patient`,
  );
  if (!professional || !patient) {
    throw new Error("Par paciente/profissional QA ausente.");
  }

  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  const unrelatedEmail = `playwright-${testInfo.project.name}-${run}@elyra.invalid`;
  const unrelatedPassword = `Qa${crypto.randomUUID().replaceAll("-", "")}7`;
  const unrelatedId = await createConfirmedQaUser(admin, {
    email: unrelatedEmail,
    password: unrelatedPassword,
    displayName: "B Export QA",
  });

  const patientMarker = `EXPORT_PATIENT_${run}`;
  const professionalMarker = `EXPORT_PROFESSIONAL_${run}`;
  const unrelatedMarker = `EXPORT_UNRELATED_${run}`;
  const readAt = "2026-08-28T12:34:56.000Z";
  let deletionStartedAt: string | null = null;

  try {
    const { data: connection, error: connectionError } = await admin
      .from("professional_connections")
      .select("id")
      .eq("client_user_id", patient.userId)
      .eq("professional_user_id", professional.userId)
      .single();
    if (connectionError || !connection) {
      throw connectionError ?? new Error("Connection QA ausente.");
    }

    const { error: checkinError } = await admin.from("emotional_checkins").insert([
      {
        id: crypto.randomUUID(),
        user_id: patient.userId,
        mood_score: 6,
        note: patientMarker,
      },
      {
        id: crypto.randomUUID(),
        user_id: professional.userId,
        mood_score: 7,
        note: professionalMarker,
      },
      {
        id: crypto.randomUUID(),
        user_id: unrelatedId,
        mood_score: 8,
        note: unrelatedMarker,
      },
    ]);
    if (checkinError) throw checkinError;

    const { error: noteError } = await admin.from("professional_notes").insert({
      connection_id: connection.id,
      professional_user_id: professional.userId,
      client_user_id: patient.userId,
      body: `PRIVATE_PROFESSIONAL_NOTE_${run}`,
    });
    if (noteError) throw noteError;

    const patientNotificationId = crypto.randomUUID();
    const unrelatedNotificationId = crypto.randomUUID();
    const { error: notificationError } = await admin.from("notifications").insert([
      {
        id: patientNotificationId,
        user_id: patient.userId,
        kind: "checkin_reminder",
        event_key: "checkin_reminder:2026-08-27",
        read_at: readAt,
      },
      {
        id: unrelatedNotificationId,
        user_id: unrelatedId,
        kind: "goal_reminder",
        event_key: "goal_reminder:2026-08-26",
      },
    ]);
    if (notificationError) throw notificationError;

    const patientSession = await login(browser, baseURL, patient);
    const unrelatedSession = await login(browser, baseURL, {
      email: unrelatedEmail,
      password: unrelatedPassword,
    });
    try {
      await gotoHydrated(page, "/dashboard");
      const [patientExport, professionalExport, unrelatedExport] =
        await Promise.all([
          exportSubject(patientSession.page, "patient"),
          exportSubject(page, "professional"),
          exportSubject(unrelatedSession.page, "unrelated"),
        ]);

      for (const payload of [
        patientExport,
        professionalExport,
        unrelatedExport,
      ]) {
        expectRegistryShape(payload);
        expectNoSecretMaterial(payload);
        expect(JSON.stringify(payload.data)).not.toContain(
          `PRIVATE_PROFESSIONAL_NOTE_${run}`,
        );
      }

      expect(patientExport.subjectId).toBe(patient.userId);
      expect(containsMarker(patientExport, patientMarker)).toBe(true);
      expect(containsMarker(patientExport, professionalMarker)).toBe(false);
      expect(containsMarker(patientExport, unrelatedMarker)).toBe(false);
      expect(patientExport.data.professional_connections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: connection.id }),
        ]),
      );
      expect(patientExport.data.sharing_permissions?.length).toBeGreaterThan(0);
      // `read_at` volta como timestamptz do Postgres (`+00:00`), nao como o
      // literal `Z` que foi gravado: mesma instante, serializacao diferente.
      // Comparar texto aqui testaria o formato do driver, nao a portabilidade.
      const exportedNotification = (
        patientExport.data.notifications ?? []
      ).find(
        (row) => (row as { id?: string }).id === patientNotificationId,
      ) as { read_at?: string | null } | undefined;
      expect(exportedNotification).toBeDefined();
      expect(new Date(exportedNotification?.read_at ?? 0).toISOString()).toBe(
        new Date(readAt).toISOString(),
      );
      for (const notification of patientExport.data.notifications ?? []) {
        expect(notification).not.toHaveProperty("event_key");
      }

      expect(professionalExport.subjectId).toBe(professional.userId);
      expect(containsMarker(professionalExport, professionalMarker)).toBe(true);
      expect(containsMarker(professionalExport, patientMarker)).toBe(false);
      expect(containsMarker(professionalExport, unrelatedMarker)).toBe(false);
      expect(professionalExport.data.professional_connections).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: connection.id }),
        ]),
      );
      expect(professionalExport.data.sharing_permissions).toEqual([]);

      expect(unrelatedExport.subjectId).toBe(unrelatedId);
      expect(containsMarker(unrelatedExport, unrelatedMarker)).toBe(true);
      expect(containsMarker(unrelatedExport, patientMarker)).toBe(false);
      expect(containsMarker(unrelatedExport, professionalMarker)).toBe(false);
      expect(unrelatedExport.data.professional_connections).toEqual([]);
      expect(unrelatedExport.data.sharing_permissions).toEqual([]);
      expect(unrelatedExport.data.notifications).toEqual([
        expect.objectContaining({ id: unrelatedNotificationId }),
      ]);

      deletionStartedAt = new Date(Date.now() - 1_000).toISOString();
      const deletion = await unrelatedSession.page.evaluate(async () => {
        const response = await fetch("/api/me/account", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation: "EXCLUIR MINHA CONTA" }),
        });
        return { status: response.status, body: await response.json() };
      });
      expect(deletion.status).toBe(200);
      expect(deletion.body.data.status).toBe("domain_cleared");
      const { data: deletedUser, error: deletedUserError } =
        await admin.auth.admin.getUserById(unrelatedId);
      expect(deletedUser.user).toBeNull();
      expect(deletedUserError?.status).toBe(404);
    } finally {
      await patientSession.context.close();
      await unrelatedSession.context.close();
    }
  } finally {
    await cleanupQaUser(admin, unrelatedId);

    if (deletionStartedAt) {
      const { data: audits, error: auditReadError } = await admin
        .from("audit_logs")
        .select("id")
        .gte("occurred_at", deletionStartedAt)
        .in("action", [
          "account_deletion.requested",
          "account_deletion.learning_revoked",
          "account_deletion.storage_cleared",
          "account.deleted",
        ]);
      if (auditReadError) throw auditReadError;
      if ((audits ?? []).length > 0) {
        const { error } = await admin
          .from("audit_logs")
          .delete()
          .in("id", (audits ?? []).map((row) => row.id));
        if (error) throw error;
      }
      const { error: ledgerError } = await admin
        .from("deletion_ledger")
        .delete()
        .eq("subject_user_id", unrelatedId);
      if (ledgerError) throw ledgerError;
    }
  }
});
