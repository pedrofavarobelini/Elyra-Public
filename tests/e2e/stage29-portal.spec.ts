import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { measureDeadSpace } from "./dead-space";
import { gotoHydrated } from "./hydrated";
import { openNav } from "./nav";



const PORTAL = [
  "/pro/dashboard",
  "/pro/acompanhamentos",
  "/pro/agenda",
  "/pro/sessoes",
  "/pro/relatorios",
  "/pro/solicitacoes",
  "/pro/pedidos",
  "/pro/vinculos",
  "/pro/perfil",
] as const;

function patientId(project: string) {
  const identities = JSON.parse(
    readFileSync(resolve(process.cwd(), "test-results", ".auth", "identity.json"), "utf8"),
  ) as Array<{ project: string; userId: string }>;
  const patient = identities.find((identity) => identity.project === `${project}-patient`);
  if (!patient) throw new Error("Paciente QA ausente.");
  return patient.userId;
}

async function seedPreferences(page: Page, prefs: Record<string, string>) {
  await page.addInitScript((value) => {
    if (sessionStorage.getItem("__stage29_prefs")) return;
    sessionStorage.setItem("__stage29_prefs", "1");
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("elyra.accessibility.v1")) localStorage.removeItem(key);
    }
    // Chave legada: o provider migra para a chave da conta no primeiro render.
    localStorage.setItem("elyra.accessibility.v1", JSON.stringify(value));
  }, prefs);
}

test.describe("Stage 29 / PRO-4 - navegacao e rotas", () => {
  test("menu agrupado, rota ativa marcada, Agenda e Sessoes (ADR-0024), sem Pedidos de ajuda nem SOS", async ({ page }) => {
    await gotoHydrated(page, "/pro/vinculos");
    const nav = await openNav(page);
    for (const group of ["Visão geral", "Trabalho", "Relacionamento", "Profissional"]) {
      await expect(nav.getByRole("list", { name: group })).toBeVisible();
    }
    await expect(nav.getByRole("list", { name: "Trabalho" }).getByRole("link")).toHaveCount(4);
    await expect(nav.getByRole("list", { name: "Trabalho" }).getByRole("link", { name: "Agenda", exact: true })).toBeVisible();
    await expect(nav.getByRole("list", { name: "Trabalho" }).getByRole("link", { name: "Sessões", exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Vínculos e acessos" })).toHaveAttribute("aria-current", "page");
    for (const absent of ["Pedidos de ajuda", "Revisões", "Administração"]) {
      await expect(nav.getByRole("link", { name: absent, exact: true })).toHaveCount(0);
    }
  });

  for (const path of PORTAL) {
    test(`${path}: h1 unico, sem SOS em nenhum lugar`, async ({ page }) => {
      const response = await gotoHydrated(page, path);
      expect(response?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByRole("button", { name: /SOS/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /SOS/ })).toHaveCount(0);
      await expect(page.getByText(/Agenda de hoje|Sessões de hoje/)).toHaveCount(0);
    });
  }

  test("rotas legadas redirecionam com seguranca", async ({ page }, testInfo) => {
    await gotoHydrated(page, "/pro/pacientes");
    await expect(page).toHaveURL(/\/pro\/acompanhamentos$/);

    const id = patientId(testInfo.project.name);
    await gotoHydrated(page, `/pro/pacientes/${id}`);
    await expect(page).toHaveURL(new RegExp(`/pro/acompanhamentos/${id}$`));

    const invalid = await page.goto("/pro/pacientes/nao-e-uuid");
    expect(invalid?.status()).toBe(404);

    // PRO-7 (ADR-0024 addendum): /pro/sessoes deixou de redirecionar; e a lista real.
    await gotoHydrated(page, "/pro/sessoes");
    await expect(page).toHaveURL(/\/pro\/sessoes$/);
    await expect(page.getByRole("heading", { level: 1, name: "Sessões" })).toBeVisible();
  });
});

test.describe("Stage 29 / PRO-4 - telas", () => {
  test("cockpit: numeros levam as telas que os explicam", async ({ page }) => {
    await gotoHydrated(page, "/pro/dashboard");
    await expect(page.getByRole("link", { name: /1\s*Acompanhamentos ativos/ })).toHaveAttribute(
      "href",
      "/pro/acompanhamentos",
    );
    await expect(page.getByRole("navigation", { name: "Atalhos" }).getByRole("link", { name: "Gerar convite" })).toHaveAttribute(
      "href",
      "/pro/solicitacoes",
    );
    await expect(page.getByText("Ana Paula QA").first()).toBeVisible();
  });

  test("acompanhamentos: com uma pessoa, lista sem controles vazios", async ({ page }) => {
    await gotoHydrated(page, "/pro/acompanhamentos");
    const list = page.getByTestId("acompanhamentos-lista");
    await expect(list.getByText("Ana Paula QA")).toBeVisible();
    await expect(list.getByRole("link", { name: /Abrir dossiê/ })).toBeVisible();
    // Busca, filtro e ordenacao sobre um item nao organizam nada (W1). Com

    await expect(page.getByLabel("Buscar por nome")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Filtrar por estado do vínculo" })).toHaveCount(0);
    await expect(page.getByLabel("Ordenar por")).toHaveCount(0);
  });

  test("dossie: aba Acesso somente leitura, sem controle de grant", async ({ page }, testInfo) => {
    await gotoHydrated(page, `/pro/acompanhamentos/${patientId(testInfo.project.name)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Ana Paula QA" })).toBeVisible();
    await page.getByRole("tab", { name: "Acesso" }).click();
    const grants = page.getByTestId("grants-list");
    await expect(grants.getByText("Emocional")).toBeVisible();
    await expect(grants.getByText("Vigente").first()).toBeVisible();
    const panel = page.getByRole("tabpanel");
    await expect(panel.getByRole("button")).toHaveCount(0);
    await expect(panel.getByRole("switch")).toHaveCount(0);
  });

  test("IDOR na interface: UUID de terceiro e mesma mensagem, sem dado", async ({ page }) => {
    const foreign = "00000000-0000-4000-8000-000000000000";
    await gotoHydrated(page, `/pro/acompanhamentos/${foreign}`);
    await expect(page.getByRole("heading", { level: 1, name: "Dossiê indisponível" })).toBeVisible();
    await gotoHydrated(page, `/pro/relatorios?pessoa=${foreign}&periodo=28`);
    await expect(page.getByText("Relatório indisponível para você agora")).toBeVisible();
    const malformed = await page.goto("/pro/acompanhamentos/nao-e-uuid");
    expect(malformed?.status()).toBe(404);
    await gotoHydrated(page, "/pro/relatorios?pessoa=nao-e-uuid&periodo=999");
    await expect(page.getByRole("heading", { level: 1, name: "Relatórios e evolução" })).toBeVisible();
    await expect(page.getByText(/Relatório indisponível/)).toHaveCount(0);
  });

  test("relatorios separam registro, calculo e IA", async ({ page }, testInfo) => {
    await gotoHydrated(page, `/pro/relatorios?pessoa=${patientId(testInfo.project.name)}&periodo=90`);
    await expect(page.locator("[data-layer='deterministic']").first()).toBeVisible();
    await expect(page.locator("[data-layer='observed']")).toBeVisible();
    await expect(page.locator("[data-layer='ai']")).toBeVisible();
    await expect(page.getByText("Leituras assistidas por IA não fazem parte deste acesso.")).toBeVisible();
    await expect(page.getByText(/diagn[oó]stico de|risco clínico|% de/i)).toHaveCount(0);
  });

  test("vinculos: grants e encerramento com confirmacao (cancelado)", async ({ page }) => {
    await gotoHydrated(page, "/pro/vinculos");
    await expect(page.getByTestId("grants-list").first()).toBeVisible();
    await page.getByRole("button", { name: "Encerrar vínculo" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Encerrar este vínculo?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Manter vínculo" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("[data-relationship-status='active']").first()).toBeVisible();
  });

  test("perfil: estado, proximo passo e validade da verificacao", async ({ page }) => {
    await gotoHydrated(page, "/pro/perfil");
    const card = page.getByTestId("verification-card");
    await expect(card.getByRole("heading", { name: "Registro verificado" })).toBeVisible();
    await expect(card.getByText("Próximo passo")).toBeVisible();
    await expect(card.getByText(/^Até \d{2}\/\d{2}\/\d{4}$/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Revis|Aprovar/ })).toHaveCount(0);
  });
});

/*
  Personalizacao: tres combinacoes que cobrem todos os valores de tema,
  densidade, formato de card e navegacao. Em cada uma, cada tela do portal
  continua sem rolagem lateral, sem buraco estrutural e sem violacao axe.
*/
const COMBOS = [
  { theme: "dark", density: "compact", cardShape: "minimal", navigation: "compact", cardStyle: "elevated" },
  { theme: "light", density: "spacious", cardShape: "rounded", navigation: "expanded", cardStyle: "soft" },
  { theme: "system", density: "comfortable", cardShape: "balanced", navigation: "expanded", cardStyle: "standard" },
];

for (const combo of COMBOS) {
  test(`personalizacao ${combo.theme}/${combo.density}/${combo.cardShape}/${combo.navigation}: portal integro`, async ({
    page,
  }, testInfo) => {
    await seedPreferences(page, combo);
    for (const path of PORTAL) {
      await gotoHydrated(page, path);
      await expect(page.locator("html")).toHaveAttribute("data-elyra-density", combo.density);
      if (process.env.ELYRA_SHOTS_DIR) {
        await page.screenshot({
          path: `${process.env.ELYRA_SHOTS_DIR}/${testInfo.project.name}-${combo.theme}-${combo.density}${path.replaceAll("/", "_")}.png`,
          fullPage: true,
        });
      }
      const metrics = await measureDeadSpace(page);
      expect(metrics.horizontalOverflow, `${path}: rolagem lateral`).toBeLessThanOrEqual(0);
      for (const grid of metrics.grids) {
        if (!grid.sideBySide) continue;
        expect(grid.gap <= 260 || grid.shortRatio >= 0.75, `${path}: colunas a ${Math.round(grid.gap)} px`).toBe(true);
      }
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        results.violations.map((violation) => `${violation.id}: ${violation.nodes.length}`),
        `${testInfo.project.name} ${path}`,
      ).toEqual([]);
    }
  });
}

test.describe("Stage 29 / PRO-4 - globais no contexto profissional", () => {
  test("Configuracoes do contexto profissional (ADR-0027); App Lock bloqueia portal e APIs profissionais", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.setTimeout(120_000);
    if (!baseURL) throw new Error("baseURL ausente.");
    process.loadEnvFile?.(".env.local");
    const { createClient } = await import("@supabase/supabase-js");
    const { createConfirmedQaUser, loginThroughUi } = await import("../qa-identity");
    const { cleanupQaUser } = await import("../qa-cleanup");
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
    const credentials = {
      email: `playwright-${testInfo.project.name}-${run}@elyra.invalid`,
      password: `Qa${crypto.randomUUID().replaceAll("-", "")}3`,
    };
    const userId = await createConfirmedQaUser(admin as never, { ...credentials, displayName: "Pro Lock QA" });
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const { error } = await admin.from("professional_profiles").insert({
        user_id: userId,
        council_region: "06",
        registration_number: `LOCK-${run}`,
        specialty: "Psicologia",
        verification_status: "verified",
        verification_reviewed_at: new Date().toISOString(),
        verification_review_due_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      });
      if (error) throw error;
      const lockPage = await context.newPage();
      await loginThroughUi(lockPage, baseURL, credentials);

      // F4 (ADR-0027, revisa ADR-0020 §2): o menu profissional leva as
      // configuracoes do proprio contexto, com as secoes globais compartilhadas.
      await gotoHydrated(lockPage, "/pro/dashboard");
      const nav = await openNav(lockPage);
      await nav.getByRole("link", { name: "Configurações" }).click();
      await expect(lockPage).toHaveURL(/\/pro\/configuracoes$/);
      await expect(lockPage.getByTestId("settings-hub")).toHaveAttribute("data-settings-context", "professional");

      await gotoHydrated(lockPage, "/seguranca");
      await lockPage.getByRole("button", { name: "Ativar App Lock" }).click();
      const dialog = lockPage.getByRole("dialog", { name: "Criar PIN da Elyra" });
      await dialog.getByLabel("Novo PIN").fill("314159");
      await dialog.getByLabel("Confirmar PIN").fill("314159");
      await dialog.getByRole("button", { name: "Ativar", exact: true }).click();
      await expect(lockPage.getByRole("status")).toContainText("App Lock ativado");
      await lockPage.getByRole("button", { name: "Bloquear agora" }).click();
      await expect(lockPage.getByRole("heading", { name: "Elyra bloqueada" })).toBeVisible();

      await lockPage.goto(`${baseURL}/pro/vinculos`);
      await expect(lockPage).toHaveURL(/\/bloqueio\?next=%2Fpro%2Fvinculos/);
      const api = await lockPage.request.get(`${baseURL}/api/professional/invites`);
      expect(api.status()).toBe(423);
    } finally {
      await context.close();
      await admin.from("app_lock_sessions").delete().eq("user_id", userId);
      await cleanupQaUser(admin as never, userId);
    }
  });
});
