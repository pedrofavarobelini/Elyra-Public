import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { cleanupQaUser } from "../qa-cleanup";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { brokenGuardedWords, measureDeadSpace } from "./dead-space";
import { gotoHydrated } from "./hydrated";



const MAX_COLUMN_GAP = 260;

const PEOPLE: Array<{ name: string; status: "active" | "paused" | "pending" | "revoked" | "ended" }> = [
  { name: "Ana Beatriz Moura", status: "active" },
  { name: "Bruno Carvalho", status: "active" },
  { name: "Camila Duarte", status: "active" },
  { name: "Diego Esteves", status: "active" },
  { name: "Érica Fonseca", status: "active" },
  { name: "Fábio Guimarães", status: "active" },
  { name: "Gabriela Hoffmann", status: "active" },
  { name: "Heitor Ibrahim", status: "paused" },
  { name: "Isadora Junqueira", status: "paused" },
  { name: "João Kfouri", status: "pending" },
  { name: "Larissa Mendonça", status: "revoked" },
  { name: "Marcos Nogueira", status: "ended" },
];

const SCOPES = ["emotional", "sleep", "goals", "cycle", "reports"] as const;

function qaEmail(project: string, patient = false) {
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  return `playwright-${patient ? "patient-" : ""}${project}-${run}@elyra.invalid`;
}

function qaPassword() {
  return `Qa${crypto.randomUUID().replaceAll("-", "")}3`;
}

async function createProfessional(admin: SupabaseClient<Database>, project: string, displayName: string) {
  const credentials = { email: qaEmail(project), password: qaPassword() };
  const userId = await createConfirmedQaUser(admin, { ...credentials, displayName });
  const { error } = await admin.from("professional_profiles").insert({
    user_id: userId,
    council_region: "06",
    registration_number: `DENS-${userId.slice(0, 8)}`,
    specialty: "Psicologia",
    verification_status: "verified",
    verification_reviewed_at: new Date().toISOString(),
    verification_review_due_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
  });
  if (error) throw error;
  return { ...credentials, userId };
}

async function seedPeople(admin: SupabaseClient<Database>, project: string, professionalUserId: string) {
  const ids: string[] = [];
  const day = 86_400_000;
  for (const [index, person] of PEOPLE.entries()) {
    const userId = await createConfirmedQaUser(admin, {
      email: qaEmail(project, true),
      password: qaPassword(),
      displayName: person.name,
    });
    ids.push(userId);
    const now = Date.now();
    const accepted = new Date(now - (index + 2) * 7 * day).toISOString();
    const connectionId = crypto.randomUUID();
    const { error } = await admin.from("professional_connections").insert({
      id: connectionId,
      client_user_id: userId,
      professional_user_id: professionalUserId,
      invited_by_user_id: userId,
      status: person.status,
      accepted_at: person.status === "pending" ? null : accepted,
      paused_at: person.status === "paused" ? new Date(now - day).toISOString() : null,
      revoked_at: person.status === "revoked" ? new Date(now - 2 * day).toISOString() : null,
      ended_at: person.status === "ended" ? new Date(now - 3 * day).toISOString() : null,
    });
    if (error) throw error;
    if (person.status === "pending") continue;

    // Escopos variados: cada pessoa compartilha um recorte diferente, com
    // validade e janela de dados reais em algumas.
    const scopes = SCOPES.slice(0, 1 + (index % SCOPES.length));
    const { error: grantError } = await admin.from("sharing_permissions").insert(
      scopes.map((scope, position) => ({
        connection_id: connectionId,
        scope,
        journal_entry_id: null,
        expires_at: position === 0 && index % 3 === 0 ? new Date(now + 5 * day).toISOString() : null,
        data_from: index % 4 === 1 ? new Date(now - 60 * day).toISOString().slice(0, 10) : null,
      })),
    );
    if (grantError) throw grantError;
  }
  return ids;
}

async function measureRoutes(page: Page, options: {
  project: string;
  label: string;
  routes: Array<{ path: string; slug: string }>;
  widths: Array<{ width: number; height: number }>;
}) {
  for (const size of options.widths) {
    await page.setViewportSize(size);
    for (const route of options.routes) {
      await gotoHydrated(page, route.path);
      await page.waitForTimeout(300);
      await page.screenshot({
        path: `${process.env.ELYRA_SHOTS_DIR ?? "test-results/stage29-shots"}/density-${options.label}-${options.project}-${size.width}/${route.slug}.png`,
        fullPage: true,
      });
      const metrics = await measureDeadSpace(page);
      const where = `${options.label} ${route.slug} ${size.width}px`;
      expect(metrics.horizontalOverflow, `${where}: rolagem lateral`).toBeLessThanOrEqual(0);
      expect(metrics.widthUse, `${where}: largura util`).toBeGreaterThanOrEqual(0.9);
      expect(await brokenGuardedWords(page), `${where}: palavra partida`).toEqual([]);
      for (const grid of metrics.grids) {
        if (!grid.sideBySide) continue;
        expect(
          grid.gap <= MAX_COLUMN_GAP || grid.shortRatio >= 0.75,
          `${where}: colunas terminam a ${Math.round(grid.gap)} px`,
        ).toBe(true);
      }
    }
  }
}

/** Um login por conta: o balde `auth` e 10/min por IP (ver `rate-limit.ts`). */
async function withSession(
  browser: Browser,
  baseURL: string,
  credentials: { email: string; password: string },
  run: (page: Page) => Promise<void>,
) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    await loginThroughUi(page, baseURL, credentials);
    await run(page);
  } finally {
    await context.close();
  }
}

test.describe("Stage 29 / PRO-4 - portal com 0 e com muitos acompanhamentos", () => {
  test("listas, cockpit e vinculos mantem a composicao de 0 a 12 pessoas", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    if (!baseURL) throw new Error("baseURL ausente.");
    const admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const project = testInfo.project.name;
    const widths: Record<string, Array<{ width: number; height: number }>> = {
      desktop: [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }],
      tablet: [{ width: 834, height: 1112 }],
      mobile: [{ width: 360, height: 780 }, { width: 393, height: 851 }, { width: 412, height: 915 }],
    };
    const routes = [
      { path: "/pro/dashboard", slug: "dashboard" },
      { path: "/pro/acompanhamentos", slug: "acompanhamentos" },
      { path: "/pro/vinculos", slug: "vinculos" },
    ];
    const created: string[] = [];
    try {
      const empty = await createProfessional(admin, project, "Pro Vazio QA");
      created.push(empty.userId);
      const busy = await createProfessional(admin, project, "Pro Cheio QA");
      created.push(busy.userId);
      created.push(...(await seedPeople(admin, project, busy.userId)));

      await withSession(browser, baseURL, empty, async (page) => {
        await measureRoutes(page, { project, label: "zero", routes, widths: widths[project]! });
        await gotoHydrated(page, "/pro/acompanhamentos");
        await expect(page.getByText("Nenhum acompanhamento ainda")).toBeVisible();
        // Sem ninguem, filtros e ordenacao nao aparecem: nao ha o que filtrar.
        await expect(page.getByRole("searchbox", { name: "Buscar por nome" })).toHaveCount(0);
      });

      await withSession(browser, baseURL, busy, async (page) => {
        await measureRoutes(page, { project, label: "doze", routes, widths: widths[project]! });
        await gotoHydrated(page, "/pro/acompanhamentos");
        const list = page.getByTestId("acompanhamentos-lista");
        const filters = page.getByRole("group", { name: "Filtrar por estado do vínculo" });
        // Pendente vive na Central de solicitacoes; aqui ficam 11 vinculos.
        await expect(filters.getByRole("button", { name: /^Todos/ })).toContainText("11");
        await expect(filters.getByRole("button", { name: /^Ativos/ })).toContainText("7");
        await expect(filters.getByRole("button", { name: /^Pausados/ })).toContainText("2");
        await expect(filters.getByRole("button", { name: /^Pendentes/ })).toHaveCount(0);

        const search = page.getByRole("searchbox", { name: "Buscar por nome" });
        await search.fill("erica");
        await expect(list.getByText("Érica Fonseca")).toBeVisible();
        await expect(list.getByText("Bruno Carvalho")).toHaveCount(0);
        await search.fill("ninguem com este nome");
        await expect(page.getByText("Nenhum acompanhamento com esses critérios")).toBeVisible();
        await search.fill("");

        await filters.getByRole("button", { name: /^Encerrados/ }).click();
        await expect(filters.getByRole("button", { name: /^Encerrados/ })).toHaveAttribute("aria-pressed", "true");
        await expect(list.getByRole("listitem")).toHaveCount(2);
        await expect(list.getByText("Larissa Mendonça")).toHaveCount(0);

        await filters.getByRole("button", { name: /^Ativos/ }).click();
        await page.getByLabel("Ordenar por").selectOption("name");
        await expect(list.getByRole("listitem").first()).toContainText("Ana Beatriz Moura");
        await expect(list.getByRole("listitem")).toHaveCount(7);

        // Pausa suspende os acessos: nenhum grant de vinculo pausado aparece como vigente.
        await gotoHydrated(page, "/pro/vinculos");
        await expect(page.getByTestId("grants-list").getByText("Suspenso", { exact: true })).toHaveCount(2);
      });
    } finally {
      await admin.from("professional_connections").delete().in("professional_user_id", created);
      for (const userId of created) await cleanupQaUser(admin as never, userId);
    }
  });
});
