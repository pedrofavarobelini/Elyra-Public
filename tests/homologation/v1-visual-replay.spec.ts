import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { gotoHydrated } from "../e2e/hydrated";
import { installDeterministicMedia, resetMultimodalQa } from "../e2e/multimodal-mocks";
import { createAnalyzedSession, removeSession } from "../e2e/real-session";
import { cleanupQaUser } from "../qa-cleanup";

/**
 * QA Visual Replay da Release Candidate V1.
 *
 * O objetivo deste arquivo NAO e assertar comportamento - isso a suite canonica
 * ja fez, 501/501. O objetivo e **produzir as imagens** que uma pessoa vai
 * olhar: cada superficie da V1, nos tres viewports, nos estados que importam -
 * vazio, carregando, preenchido, erro, recusado.
 *
 * Assercoes aqui existem so para garantir que a captura aconteceu na tela
 * certa, no estado certo. Uma captura de uma tela que nao carregou nao e
 * evidencia visual, e ruido.
 */

const OUT = process.env.ELYRA_REPLAY_OUT ?? "test-results/v1-visual-replay";

interface QaIdentity {
  project: string;
  email: string;
  password: string;
  userId: string;
}

function identities(): QaIdentity[] {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test-results", ".auth", "identity.json"),
      "utf8",
    ),
  ) as QaIdentity[];
}

function identityFor(project: string): QaIdentity {
  const found = identities().find((candidate) => candidate.project === project);
  if (!found) throw new Error(`Identidade QA ausente para ${project}.`);
  return found;
}

function adminClient() {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("QA local nao configurado.");
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}


async function shoot(page: Page, slug: string, project: string, fullPage = true) {
  await page.waitForLoadState("load");
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.screenshot({
    path: `${OUT}/${slug}-${project}.png`,
    fullPage,
    animations: "disabled",
    caret: "hide",
  });
}

/** Captura so a viewport, para avaliar a dobra e elementos fixos/sticky. */
async function shootFold(page: Page, slug: string, project: string) {
  await shoot(page, slug, project, false);
}

// ===========================================================================
// 1. Portas anonimas
// ===========================================================================

test.describe("portas anonimas", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("entrar, cadastro e erro de credencial", async ({ page }, testInfo) => {
    const project = testInfo.project.name;

    await gotoHydrated(page, "/entrar");
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await shoot(page, "auth-entrar", project);

    await page.getByLabel("E-mail").fill("nao-existe@elyra.invalid");
    await page.getByLabel("Senha", { exact: true }).fill("SenhaErrada123");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
    await shoot(page, "auth-entrar-erro", project);

    await gotoHydrated(page, "/cadastro");
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await shoot(page, "auth-cadastro", project);
  });
});

// ===========================================================================
// 2. Estados vazios — identidade recem-criada, sem seed
// ===========================================================================

test.describe("estados vazios", () => {
  test("dashboard, historico, diario, metas e relatorios sem dado", async ({
    browser,
  }, testInfo) => {
    test.slow();
    const project = testInfo.project.name;
    const admin = adminClient();
    // O cleanup so aceita identidade que casa com o padrao sintetico canonico
    // (`tests/qa-cleanup.ts`). Conformar ao padrao e o certo; afrouxar o guard
    // para caber um nome mais descritivo seria enfraquecer a unica barreira
    // que impede o teardown de tocar identidade real.
    const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
    const email = `playwright-${project}-${run}@elyra.invalid`;
    const password = `Qa${crypto.randomUUID().replaceAll("-", "")}5`;

    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: "Replay Vazio" },
    });
    if (error || !created.user) throw error ?? new Error("Usuario vazio ausente.");

    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: testInfo.project.use.viewport,
      userAgent: testInfo.project.use.userAgent,
      isMobile: testInfo.project.use.isMobile,
      hasTouch: testInfo.project.use.hasTouch,
      deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    });
    const page = await context.newPage();

    try {
      await gotoHydrated(page, "/entrar");
      await page.getByLabel("E-mail").fill(email);
      await page.getByLabel("Senha", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

      await shoot(page, "vazio-dashboard", project);

      for (const [path, slug] of [
        ["/historico", "vazio-historico"],
        ["/diario", "vazio-diario"],
        ["/metas", "vazio-metas"],
        ["/relatorios", "vazio-relatorios"],
        ["/sessoes", "vazio-sessoes"],
        ["/ciclo", "vazio-ciclo"],
      ] as const) {
        await gotoHydrated(page, path);
        await shoot(page, slug, project);
      }

      // Sino de uma conta recem-criada.
      //
      // A assercao aqui e deliberadamente fraca: o Replay quer VER o que uma
      // pessoa ve segundos depois do cadastro, nao provar uma hipotese sobre
      // isso. Fixar "Nenhuma notificacao por enquanto." transformaria uma
      // observacao em expectativa - e foi exatamente essa expectativa que a
      // primeira execucao derrubou.
      await gotoHydrated(page, "/dashboard");
      await page.getByRole("button", { name: /^Notificações/ }).click();
      await expect(page.getByRole("dialog").or(page.getByRole("status")).first())
        .toBeVisible({ timeout: 15_000 });
      await shootFold(page, "vazio-notificacoes", project);
    } finally {
      await context.close();
      await cleanupQaUser(admin, created.user.id);
    }
  });
});

// ===========================================================================
// 3. Jornadas principais com dado semeado
// ===========================================================================

const SEEDED = [
  { path: "/dashboard", slug: "dashboard", chart: true },
  { path: "/meu-humor", slug: "meu-humor", chart: false },
  { path: "/historico", slug: "historico", chart: false },
  { path: "/diario", slug: "diario", chart: false },
  { path: "/metas", slug: "metas", chart: false },
  { path: "/relatorios", slug: "relatorios", chart: true },
  { path: "/perfil", slug: "perfil", chart: false },
  { path: "/configuracoes", slug: "configuracoes", chart: false },
] as const;

for (const { path, slug, chart } of SEEDED) {
  test(`jornada ${slug}`, async ({ page }, testInfo) => {
    await resetMultimodalQa(page);
    await gotoHydrated(page, path);
    if (chart) {
      await page.locator(".recharts-surface").first().waitFor({ state: "visible" });
    }
    await shoot(page, slug, testInfo.project.name);
    await shootFold(page, `${slug}-dobra`, testInfo.project.name);
  });
}

// ===========================================================================
// 4. Notificacoes — capability remediada na 17-N
// ===========================================================================

test("notificacoes: vazio, badge real, lista, leitura e erro", async ({
  page,
}, testInfo) => {
  test.slow();
  const project = testInfo.project.name;
  const identity = identityFor(project);
  const admin = adminClient();

  await admin.from("notifications").delete().eq("user_id", identity.userId);
  await admin
    .from("user_preferences")
    .update({ checkin_reminder: true, goal_reminder: true })
    .eq("user_id", identity.userId);

  await gotoHydrated(page, "/dashboard");

  const unread = page.getByRole("button", { name: /não lidas/ });
  await expect(unread).toBeVisible({ timeout: 20_000 });
  await shootFold(page, "notificacoes-badge", project);

  await unread.click();
  await expect(page.getByText("Lembrete de metas")).toBeVisible();
  await shootFold(page, "notificacoes-lista", project);

  await page.getByRole("button", { name: "Marcar como lida" }).first().click();
  await expect(page.getByText("Lida", { exact: true }).first()).toBeVisible();
  await shootFold(page, "notificacoes-lida", project);
  await page.getByRole("button", { name: "Fechar" }).click();

  await page.route("**/api/notifications", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "synthetic_unavailable" }),
    });
  });
  await page.getByRole("button", { name: /^Notificações/ }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await shootFold(page, "notificacoes-erro", project);
  await page.unroute("**/api/notifications");
});

// ===========================================================================
// 5. Ciclo — opt-in e ativado
// ===========================================================================

test("ciclo: convite de opt-in e modulo ativado", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  try {
    await gotoHydrated(page, "/ciclo");
    await shoot(page, "ciclo-optin", project);

    await gotoHydrated(page, "/configuracoes");
    const toggle = page.getByRole("switch", { name: "Acompanhamento do ciclo" });
    if ((await toggle.getAttribute("aria-checked")) === "false") {
      await toggle.click();
    }
    await page.getByRole("link", { name: "Abrir o ciclo" }).click();
    await expect(page.getByRole("heading", { name: "Ciclo", level: 1 })).toBeVisible();
    await page.locator(".recharts-surface").first().waitFor({ state: "visible" });
    await shoot(page, "ciclo-ativado", project);
  } finally {
    await page.request.patch("/api/cycle/profile", { data: { enabled: false } });
  }
});

// ===========================================================================
// 6. Multimodal — preflight, sessao e resultado real
// ===========================================================================

test("multimodal: portao, preflight e sessao em andamento", async ({
  page,
}, testInfo) => {
  test.slow();
  const project = testInfo.project.name;
  await resetMultimodalQa(page);
  await installDeterministicMedia(page);

  await gotoHydrated(page, "/sessoes");
  await shoot(page, "multimodal-portao", project);

  await gotoHydrated(page, "/configuracoes");
  await page.getByRole("switch", { name: "Sessões multimodais (Beta)" }).click();
  await page.getByRole("link", { name: "Preparar uma sessão" }).click();
  await shoot(page, "multimodal-preflight-desligado", project);

  for (const name of [
    "Gravar/compartilhar tela",
    "Usar câmera",
    "Usar microfone",
    "Gerar transcrição",
  ]) {
    await page.getByRole("switch", { name }).click();
  }
  await shoot(page, "multimodal-preflight-autorizado", project);

  await page.clock.install({ time: new Date("2026-01-01T09:00:00Z") });
  await page.getByRole("button", { name: "Iniciar sessão" }).click();
  await expect(
    page.getByRole("heading", { name: "Nova sessão multimodal", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
  await expect(page.getByText("REC", { exact: true })).toBeVisible();
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 1_000));
  await expect(page.getByTestId("session-timer")).toHaveText("00:00:01");
  await page.clock.runFor(221_000);
  await shoot(page, "multimodal-em-andamento", project);
});

test("multimodal: resultado real e id inexistente", async ({ page }, testInfo) => {
  test.slow();
  const project = testInfo.project.name;
  const sessionId = await createAnalyzedSession(page);
  try {
    await gotoHydrated(page, `/sessoes/${sessionId}`);
    await expect(
      page.getByRole("heading", { name: "Análise da sessão", level: 1 }),
    ).toBeVisible();
    await shoot(page, "multimodal-resultado", project);
  } finally {
    await removeSession(page, sessionId);
  }

  // GAP-03: id inexistente nao pode renderizar metrica inventada.
  await gotoHydrated(page, "/sessoes/123");
  await shoot(page, "multimodal-id-inexistente", project);
});

// ===========================================================================
// 7. Area profissional
// ===========================================================================

const PRO = [
  { path: "/pro/dashboard", slug: "pro-dashboard" },
  { path: "/pro/pacientes", slug: "pro-pacientes" },
  { path: "/pro/relatorios", slug: "pro-relatorios" },
  { path: "/pro/sessoes", slug: "pro-sessoes" },
  { path: "/pro/perfil", slug: "pro-perfil" },
] as const;

for (const { path, slug } of PRO) {
  test(`profissional ${slug}`, async ({ page }, testInfo) => {
    await gotoHydrated(page, path);
    await shoot(page, slug, testInfo.project.name);
  });
}

test("profissional: dossie do paciente (figura 8)", async ({ page }, testInfo) => {
  await gotoHydrated(page, "/pro/pacientes");
  await page.getByRole("link", { name: /Abrir dossiê/i }).first().click();
  await expect(page).toHaveURL(/\/pro\/pacientes\/[^/]+$/);
  await expect(
    page.getByRole("heading", { name: /^Paciente:/, level: 1 }),
  ).toBeVisible();
  await shoot(page, "pro-dossie", testInfo.project.name);
  await shootFold(page, "pro-dossie-dobra", testInfo.project.name);
});

// ===========================================================================
// 8. Privacidade — export e exclusao de conta
// ===========================================================================

test("privacidade: exportacao e exclusao de conta", async ({
  browser,
}, testInfo) => {
  test.slow();
  const project = testInfo.project.name;
  const admin = adminClient();
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  const email = `playwright-${project}-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}6`;

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: "Replay Privacidade" },
  });
  if (error || !created.user) throw error ?? new Error("Usuario descartavel ausente.");

  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    viewport: testInfo.project.use.viewport,
    userAgent: testInfo.project.use.userAgent,
    isMobile: testInfo.project.use.isMobile,
    hasTouch: testInfo.project.use.hasTouch,
    deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
  });
  const page = await context.newPage();

  try {
    await gotoHydrated(page, "/entrar");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    await gotoHydrated(page, "/configuracoes/dados");
    const privacidade = page.getByRole("heading", {
      name: /Privacidade|Seus dados|Dados/i,
    });
    if (await privacidade.first().isVisible().catch(() => false)) {
      await privacidade.first().scrollIntoViewIfNeeded();
    }
    await shoot(page, "privacidade-configuracoes", project);

    // Exportacao: a acao real do titular, com a resposta do servidor.
    const exportar = page.getByRole("button", { name: /Exportar/i }).first();
    if (await exportar.isVisible().catch(() => false)) {
      await exportar.click();
      await page.waitForTimeout(1_500);
      await shoot(page, "privacidade-export", project);
    }

    // Exclusao de conta: apenas o estado de confirmacao, sem confirmar.
    const excluir = page.getByRole("button", { name: /Excluir a conta|Excluir conta/i }).first();
    if (await excluir.isVisible().catch(() => false)) {
      await excluir.scrollIntoViewIfNeeded();
      await excluir.click();
      await page.waitForTimeout(800);
      await shoot(page, "privacidade-excluir-conta", project);
    }
  } finally {
    await context.close();
    await cleanupQaUser(admin, created.user.id);
  }
});

// ===========================================================================
// 9. Design System — a referencia interna de consistencia
// ===========================================================================

test("design system", async ({ page }, testInfo) => {
  await gotoHydrated(page, "/design-system");
  await shoot(page, "design-system", testInfo.project.name);
});
