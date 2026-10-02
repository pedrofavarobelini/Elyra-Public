import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import {
  cleanupAccounts,
  createPersonalAccount,
  createProfessionalAccount,
  qaAdmin,
  signIn,
  type FixtureVerification,
} from "./professional-fixtures";



const PORTAL_ROUTES = [
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

const PORTAL_APIS = [
  "/api/professional/notes?connectionId=00000000-0000-4000-8000-000000000000",
  "/api/professional/invites",
  "/api/scheduling/availability",
  "/api/scheduling/availability/exceptions",
] as const;

const MAILPIT = "http://127.0.0.1:54384";

/** Link de confirmacao (credencial de uso unico): usado, nunca impresso. */
async function confirmationLink(email: string): Promise<string> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const box = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    const message = (box.messages ?? []).find(
      (item: { To?: { Address?: string }[] }) => item.To?.[0]?.Address?.toLowerCase() === email.toLowerCase(),
    );
    if (!message) continue;
    const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
    const found = `${full.Text ?? ""} ${full.HTML ?? ""}`.match(/https?:\/\/[^"'\s<>]*\/auth\/v1\/verify\?[^"'\s<>]+/);
    if (found) return found[0].replace(/&amp;/g, "&");
  }
  throw new Error("E-mail de confirmacao nao chegou ao capturador local.");
}

const switcher = (page: Page) => page.locator("[data-testid='context-switcher']");

async function freshPage(browser: import("@playwright/test").Browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

test.describe("Stage 29 / F1 - portao profissional por estado", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Portao e fluxo independem do viewport; o visual roda em F1 visual.");
    test.setTimeout(240_000);
  });

  test("so VERIFIED abre /pro/* e as APIs do portal; deep link dos demais falha fechado", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const states: Array<[FixtureVerification | "none", string]> = [
        ["none", "NO_PROFILE"],
        ["pending", "UNDER_AUTOMATED_REVIEW"],
        ["under_review", "UNDER_AUTOMATED_REVIEW"],
        ["needs_correction", "PENDING_CORRECTION"],
        ["rejected", "REJECTED"],
        ["suspended", "SUSPENDED"],
        ["expired", "EXPIRED_REVIEW"],
      ];
      for (const [fixture, state] of states) {
        const account =
          fixture === "none"
            ? await createPersonalAccount(admin, testInfo.project.name, "Sem Perfil F1 QA")
            : await createProfessionalAccount(admin, testInfo.project.name, `Pro ${fixture} F1 QA`, fixture);
        created.push(account.userId);
        const { context, page } = await freshPage(browser);
        try {
          await signIn(page, baseURL!, account);
          for (const route of PORTAL_ROUTES) {
            await page.goto(`${baseURL}${route}`);
            await expect(page, `${state} ${route}`).toHaveURL(/\/area-profissional$/);
          }
          await expect(page.getByTestId("professional-state-card")).toHaveAttribute("data-professional-state", state);
          for (const api of PORTAL_APIS) {
            const response = await page.request.get(`${baseURL}${api}`);
            expect(response.status(), `${state} ${api}`).toBe(403);
            expect((await response.json()).code, `${state} ${api}`).toBe("PROFESSIONAL_VERIFICATION_REQUIRED");
          }
          // Seletor Pessoal | Profissional escondido fora de VERIFIED.
          await gotoHydrated(page, "/dashboard");
          await expect(switcher(page)).toHaveCount(0);
        } finally {
          await context.close();
        }
      }

      const verified = await createProfessionalAccount(admin, testInfo.project.name, "Pro Verificado F1 QA");
      created.push(verified.userId);
      const { context, page } = await freshPage(browser);
      try {
        await signIn(page, baseURL!, verified);
        await gotoHydrated(page, "/dashboard");
        await expect(switcher(page).first()).toBeVisible();
        for (const route of PORTAL_ROUTES) {
          await page.goto(`${baseURL}${route}`);
          await expect(page, route).toHaveURL(new RegExp(`${route}$`));
        }
        const availability = await page.request.get(`${baseURL}/api/scheduling/availability`);
        expect(availability.status()).toBe(200);
      } finally {
        await context.close();
      }
    } finally {
      await cleanupAccounts(admin, created);
    }
  });

  test("/perfil: um CTA por estado em Acesso e sessao", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const cases: Array<[FixtureVerification | "none", string]> = [
        ["none", "Entrar como profissional"],
        ["pending", "Acompanhar verificação profissional"],
        ["needs_correction", "Corrigir cadastro profissional"],
        ["rejected", "Revisar situação profissional"],
        ["suspended", "Regularizar acesso profissional"],
        ["expired", "Regularizar acesso profissional"],
        ["verified", "Ir para área profissional"],
      ];
      for (const [fixture, label] of cases) {
        const account =
          fixture === "none"
            ? await createPersonalAccount(admin, testInfo.project.name, "CTA Sem Perfil QA")
            : await createProfessionalAccount(admin, testInfo.project.name, `CTA ${fixture} QA`, fixture);
        created.push(account.userId);
        const { context, page } = await freshPage(browser);
        try {
          await signIn(page, baseURL!, account);
          await gotoHydrated(page, "/perfil");
          const cta = page.getByTestId("professional-access-cta");
          await expect(cta.getByRole("link", { name: label }), fixture).toBeVisible();
        } finally {
          await context.close();
        }
      }
    } finally {
      await cleanupAccounts(admin, created);
    }
  });

  test("conta nova pela entrada profissional: UMA conta Elyra, depois o cadastro (nunca o portal)", async ({ browser }, testInfo) => {
    const admin = qaAdmin();
    // Padrao sintetico do cleanup QA (tests/qa-cleanup.ts): so ele pode ser apagado.
    const hex = [...crypto.getRandomValues(new Uint8Array(7))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const email = `playwright-${testInfo.project.name}-${hex}@elyra.invalid`;
    const { context, page } = await freshPage(browser);
    let userId: string | null = null;
    try {
      await gotoHydrated(page, "/entrar?context=professional");
      await page.getByRole("link", { name: "Criar conta" }).click();
      await expect(page).toHaveURL(/\/cadastro\?context=professional$/);
      await expect(page.getByRole("heading", { name: "Criar conta para atuar como profissional" })).toBeVisible();
      await page.getByLabel("Nome").fill("Nova Profissional QA");
      await page.getByLabel("E-mail").fill(email);
      await page.getByLabel("Senha", { exact: true }).fill("Senha-Forte-F1-2026!");
      await page.getByRole("checkbox").check();
      await page.getByRole("button", { name: "Criar conta", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Conta criada");
      // Confirmacao por e-mail ligada no local: o link volta ao destino profissional.
      await page.goto(await confirmationLink(email));
      await page.waitForURL("**/area-profissional/cadastro", { timeout: 30_000 });
      const users = await admin.auth.admin.listUsers({ perPage: 1000 });
      const matches = users.data.users.filter((user) => user.email === email);
      expect(matches).toHaveLength(1);
      userId = matches[0]!.id;
      // Nada profissional nasce do cadastro da conta: so o rascunho, quando a pessoa comecar.
      const profile = await admin.from("professional_profiles").select("user_id").eq("user_id", userId);
      expect(profile.data).toEqual([]);
    } finally {
      await context.close();
      if (userId) await cleanupAccounts(admin, [userId]);
    }
  });

  test("cadastro retomavel ate o envio; pre-checagem mantem na fila e nunca aprova", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const account = await createPersonalAccount(admin, testInfo.project.name, "Onboarding F2 QA");
      created.push(account.userId);
      const { context, page } = await freshPage(browser);
      try {
        await signIn(page, baseURL!, account, "?context=professional");
        await expect(page).toHaveURL(/\/area-profissional\/cadastro$/);
        await page.getByRole("button", { name: "Começar" }).click();
        await expect(page).toHaveURL(/etapa=identidade$/);
        await expect(page.getByTestId("onboarding-account-name")).toHaveText("Onboarding F2 QA");
        await page.getByTestId("onboarding-identity-confirm").check();
        await page.getByRole("button", { name: "Salvar e continuar" }).click();
        await expect(page).toHaveURL(/etapa=registro$/);
        await page.getByLabel("Região do CRP").fill("06");
        await page.getByLabel("Número do registro").fill(`${Date.now()}`.slice(-6));
        await page.getByLabel("Área de atuação").fill("Psicologia clínica");
        await page.getByRole("button", { name: "Salvar e continuar" }).click();
        await expect(page).toHaveURL(/etapa=formacao$/);

        // Retomavel: sair e voltar cai na etapa salva, com o que foi digitado.
        await gotoHydrated(page, "/dashboard");
        await gotoHydrated(page, "/area-profissional/cadastro");
        await expect(page.getByTestId("onboarding-step")).toHaveAttribute("data-step", "formacao");
        await gotoHydrated(page, "/perfil");
        await expect(page.getByTestId("professional-access-cta").getByRole("link")).toHaveText(
          "Continuar cadastro profissional",
        );

        // Formacao declarada
        await gotoHydrated(page, "/area-profissional/cadastro?etapa=formacao");
        const form = page.getByTestId("credential-form-education");
        await form.getByLabel("Curso").fill("Psicologia");
        await form.getByLabel("Instituição").fill("Universidade QA");
        await form.getByLabel("Ano de início (opcional)").fill("2010");
        await form.getByLabel("Ano de conclusão (vazio = atual)").fill("2015");
        await form.getByRole("button", { name: "Salvar item" }).click();
        await expect(page.getByTestId("credentials-education")).toContainText("Declarado pelo profissional");

        // Revisao e envio
        await gotoHydrated(page, "/area-profissional/cadastro?etapa=revisao");
        await expect(page.getByTestId("onboarding-review")).toContainText("Confirmada");
        await page.getByTestId("onboarding-submit").click();
        await expect(page).toHaveURL(/\/area-profissional$/, { timeout: 30_000 });
        await expect(page.getByTestId("professional-state-card")).toHaveAttribute(
          "data-professional-state",
          "UNDER_AUTOMATED_REVIEW",
        );
        await expect(page.getByTestId("verification-history")).toContainText("conferência humana em andamento");

        // Portal continua fechado; nenhuma aprovacao automatica aconteceu.
        await page.goto(`${baseURL}/pro/dashboard`);
        await expect(page).toHaveURL(/\/area-profissional$/);
        const profile = await admin
          .from("professional_profiles")
          .select("verification_status")
          .eq("user_id", account.userId)
          .single();
        expect(profile.data?.verification_status).toBe("pending");

        // Aviso no sino, com copy que nao revela o estado.
        await gotoHydrated(page, "/notificacoes");
        await expect(page.getByText("Atualização do cadastro profissional").first()).toBeVisible();

        // A11y da area e do cadastro.
        for (const path of ["/area-profissional", "/area-profissional/cadastro?etapa=registro"]) {
          await gotoHydrated(page, path);
          const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
          expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`), path).toEqual([]);
        }
      } finally {
        await context.close();
      }
    } finally {
      await cleanupAccounts(admin, created);
    }
  });
});
