import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { gotoHydrated } from "./hydrated";
import {
  cleanupAccounts,
  createPersonalAccount,
  createProfessionalAccount,
  qaAdmin,
  signIn,
  signOut,
  totp,
  type QaAccount,
} from "./professional-fixtures";



const MAILPIT = "http://127.0.0.1:54384";

function sharedPatientId(project: string) {
  const identities = JSON.parse(
    readFileSync(resolve(process.cwd(), "test-results", ".auth", "identity.json"), "utf8"),
  ) as Array<{ project: string; userId: string }>;
  return identities.find((identity) => identity.project === `${project}-patient`)!.userId;
}

const switcher = (page: Page) => page.locator("[data-elyra-sidebar] [data-testid='context-switcher']");

test.describe("Stage 29 / AUTH-CONTEXT - entrada e troca de area", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Fluxos de Auth independem do viewport; o visual roda nos tres projetos abaixo.");
    test.setTimeout(180_000);
  });

  test("senha: pessoal e profissional com a mesma conta, troca sem novo login e ultimo contexto", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const personal = await createPersonalAccount(admin, testInfo.project.name, "Pessoa Sem Registro QA");
      created.push(personal.userId);
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Pro Contexto QA");
      created.push(pro.userId);
      const page = await context.newPage();

      // Conta so pessoal: entrada comum vai ao Dashboard e nao ha seletor.
      await signIn(page, baseURL!, personal);
      await expect(page).toHaveURL(/\/dashboard$/);
      await gotoHydrated(page, "/dashboard");
      await expect(switcher(page)).toHaveCount(0);
      await signOut(page, baseURL!);

      // Conta so pessoal pela entrada profissional: vai ao cadastro profissional (F1).
      await gotoHydrated(page, "/entrar?context=professional");
      await expect(page.getByRole("heading", { name: "Entrar como profissional" })).toBeVisible();
      await expect(page.getByTestId("auth-context-note")).toContainText("Mesma conta Elyra");
      await signIn(page, baseURL!, personal, "?context=professional");
      await expect(page).toHaveURL(/\/area-profissional\/cadastro$/);
      await signOut(page, baseURL!);

      // Profissional verificado, entrada comum sem preferencia: area pessoal.
      await signIn(page, baseURL!, pro);
      await expect(page).toHaveURL(/\/dashboard$/);
      const sessionBefore = (await context.cookies()).filter((c) => c.name.includes("auth-token")).map((c) => c.value).join("|");
      await expect(switcher(page)).toBeVisible();
      await expect(switcher(page).locator("[aria-current='true']")).toHaveText("Pessoal");

      // Troca de area: mesma sessao, sem login.
      await switcher(page).getByRole("button", { name: "Ir para a área profissional" }).click();
      await expect(page).toHaveURL(/\/pro\/dashboard$/);
      await expect(switcher(page).locator("[aria-current='true']")).toHaveText("Profissional");
      const sessionAfter = (await context.cookies()).filter((c) => c.name.includes("auth-token")).map((c) => c.value).join("|");
      expect(sessionAfter).toBe(sessionBefore);
      await switcher(page).getByRole("button", { name: "Ir para a área pessoal" }).click();
      await expect(page).toHaveURL(/\/dashboard$/);

      // Ultimo contexto profissional: a proxima entrada comum volta ao portal.
      await gotoHydrated(page, "/dashboard");
      await switcher(page).getByRole("button", { name: "Ir para a área profissional" }).click();
      await expect(page).toHaveURL(/\/pro\/dashboard$/);
      const preference = (await context.cookies()).find((c) => c.name === "elyra_context");
      expect(preference?.httpOnly).toBe(true);
      expect(preference?.value).toBe(`${pro.userId}.professional`);
      await signOut(page, baseURL!);
      await signIn(page, baseURL!, pro);
      await expect(page).toHaveURL(/\/pro\/dashboard$/);
      await signOut(page, baseURL!);

      // "Entrar na area pessoal" e explicito e ganha do ultimo contexto.
      await gotoHydrated(page, "/entrar?context=professional");
      await page.getByTestId("auth-context-switch").click();
      await expect(page).toHaveURL(/\/entrar\?context=personal$/);
      await signIn(page, baseURL!, pro, "?context=personal");
      await expect(page).toHaveURL(/\/dashboard$/);

      // Logout encerra a sessao inteira, de qualquer area.
      await gotoHydrated(page, "/pro/dashboard");
      await signOut(page, baseURL!);
      await page.goto(`${baseURL}/pro/dashboard`);
      await expect(page).toHaveURL(/\/entrar\?context=professional&next=%2Fpro%2Fdashboard$/);
      await page.goto(`${baseURL}/dashboard`);
      await expect(page).toHaveURL(/\/entrar$/);
    } finally {
      await context.close();
      await cleanupAccounts(admin, created);
    }
  });

  test("cada estado de verificacao tem destino proprio, e nenhum abre dado de terceiro", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    const patient = sharedPatientId(testInfo.project.name);
    try {
      for (const [status, expected] of [
        // F1: so VERIFIED entra no portal; os demais vao a Area profissional.
        ["verified", /\/pro\/dashboard$/],
        ["pending", /\/area-profissional$/],
        ["rejected", /\/area-profissional$/],
        ["suspended", /\/area-profissional$/],
        ["expired", /\/area-profissional$/],
        ["needs_correction", /\/area-profissional\/cadastro\?etapa=revisao$/],
      ] as const) {
        const account = await createProfessionalAccount(admin, testInfo.project.name, `Pro ${status} QA`, status);
        created.push(account.userId);
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
        try {
          const page = await context.newPage();
          await signIn(page, baseURL!, account, "?context=professional");
          await expect(page, status).toHaveURL(expected);
          // Contexto profissional nao e autorizacao: sem vinculo e grant, a API nega.
          const response = await page.request.get(`${baseURL}/api/professional/patients/${patient}`);
          expect(response.status(), status).toBe(403);
          expect(await response.text(), status).not.toContain("mood");
        } finally {
          await context.close();
        }
      }
    } finally {
      await cleanupAccounts(admin, created);
    }
  });

  test("deep link, open redirect e manipulacao do cliente", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Pro Redirect QA");
      created.push(pro.userId);
      const personal = await createPersonalAccount(admin, testInfo.project.name, "Pessoa Cookie QA");
      created.push(personal.userId);
      const origin = new URL(baseURL!).origin;

      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      try {
        // Deep link profissional sem sessao: entrada profissional com destino.
        await page.goto(`${baseURL}/pro/vinculos`);
        await expect(page).toHaveURL(/\/entrar\?context=professional&next=%2Fpro%2Fvinculos$/);
        await expect(page.getByRole("heading", { name: "Entrar como profissional" })).toBeVisible();
        await signIn(page, baseURL!, pro, "?context=professional&next=%2Fpro%2Fvinculos");
        await expect(page).toHaveURL(/\/pro\/vinculos$/);
        await signOut(page, baseURL!);

        // Destino externo nao sobrevive: o formulario nem o carrega.
        for (const next of ["https://evil.example/x", "//evil.example", "/\\evil.example", "javascript:alert(1)"]) {
          await gotoHydrated(page, `/entrar?context=professional&next=${encodeURIComponent(next)}`);
          await expect(page.locator("input[name='next']")).toHaveCount(0);
        }
        await signIn(page, baseURL!, pro, `?context=professional&next=${encodeURIComponent("https://evil.example/x")}`);
        expect(new URL(page.url()).origin).toBe(origin);
        await expect(page).toHaveURL(/\/pro\/dashboard$/);
        await signOut(page, baseURL!);

        // Contexto fora da allowlist = sem intencao.
        await gotoHydrated(page, "/entrar?context=admin");
        await expect(page.getByRole("heading", { name: "Entrar na Elyra" })).toBeVisible();
        await expect(page.locator("input[name='context']")).toHaveCount(0);

        // Campo adulterado no formulario: o servidor revalida.
        await gotoHydrated(page, "/entrar");
        await page.evaluate(() => {
          const form = document.querySelector("form")!;
          for (const [name, value] of [["context", "superuser"], ["next", "https://evil.example"]] as const) {
            const input = document.createElement("input");
            input.type = "hidden";
            input.name = name;
            input.value = value;
            form.appendChild(input);
          }
        });
        await page.getByLabel("E-mail").fill(personal.email);
        await page.getByLabel("Senha", { exact: true }).fill(personal.password);
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await expect(page).toHaveURL(/\/dashboard$/);
        expect(new URL(page.url()).origin).toBe(origin);
        await signOut(page, baseURL!);

        // Preferencia forjada: "professional" numa conta sem perfil nao leva ao portal,
        // e a preferencia de outra conta nao vale para esta.
        for (const value of [`${personal.userId}.professional`, `${pro.userId}.professional`, "professional", "x.y"]) {
          await context.addCookies([{ name: "elyra_context", value, url: baseURL! }]);
          await signIn(page, baseURL!, personal);
          await expect(page, value).toHaveURL(/\/dashboard$/);
          await signOut(page, baseURL!);
        }
      } finally {
        await context.close();
      }
    } finally {
      await cleanupAccounts(admin, created);
    }
  });

  test("MFA: a intencao profissional sobrevive ao segundo fator", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Pro MFA QA");
      created.push(pro.userId);
      const page = await context.newPage();
      await signIn(page, baseURL!, pro);
      await gotoHydrated(page, "/seguranca");
      const mfaCard = page
        .getByRole("heading", { name: "Verificação em duas etapas" })
        .locator("xpath=ancestor::*[contains(@class,'rounded-card')][1]");
      await mfaCard.getByRole("button", { name: "Ativar verificação em duas etapas" }).click();
      const secretNode = mfaCard.locator("p.font-mono");
      await expect(secretNode).toBeVisible({ timeout: 30_000 });
      const secret = ((await secretNode.textContent()) ?? "").trim();
      await mfaCard.getByLabel("Código gerado pelo aplicativo").fill(totp(secret));
      await mfaCard.getByRole("button", { name: "Confirmar e ativar" }).click();
      await expect(mfaCard).toContainText("Ativa", { timeout: 30_000 });
      await signOut(page, baseURL!);

      await signIn(page, baseURL!, pro, "?context=professional");
      await expect(page).toHaveURL(/\/entrar\/verificacao\?next=%2Fpro%2Fdashboard$/);
      // Trocar de area nao pula o segundo fator: o portal continua exigindo AAL2.
      await page.goto(`${baseURL}/pro/dashboard`);
      await expect(page).toHaveURL(/\/entrar\/verificacao\?next=%2Fpro%2Fdashboard$/);
      await page.getByLabel("Código do aplicativo").fill(totp(secret));
      await page.getByRole("button", { name: "Confirmar e entrar" }).click();
      await expect(page).toHaveURL(/\/pro\/dashboard$/);
    } finally {
      await context.close();
      await cleanupAccounts(admin, created);
    }
  });

  test("passkey: a mesma chave da conta entra direto na area profissional", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Pro Passkey QA");
      created.push(pro.userId);
      await signIn(page, baseURL!, pro);
      await gotoHydrated(page, "/seguranca");
      await page.getByRole("button", { name: "Cadastrar nova chave" }).click();
      const confirmation = page.getByRole("dialog", { name: "Confirmar conta da chave" });
      await confirmation.getByRole("button", { name: "Cadastrar para esta conta" }).click();
      await expect(page.getByRole("status")).toContainText("Chave de acesso cadastrada");
      await signOut(page, baseURL!);

      await gotoHydrated(page, "/entrar?context=professional");
      await page.getByRole("button", { name: "Entrar com chave de acesso" }).click();
      await expect(page).toHaveURL(/\/pro\/dashboard$/);
      await expect(switcher(page).locator("[aria-current='true']")).toHaveText("Profissional");
    } finally {
      await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => {});
      await context.close();
      await cleanupAccounts(admin, created);
    }
  });

  test("App Lock: um PIN so; desbloquear devolve a mesma tela profissional", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Pro Lock QA");
      created.push(pro.userId);
      const page = await context.newPage();
      await signIn(page, baseURL!, pro, "?context=professional");
      await expect(page).toHaveURL(/\/pro\/dashboard$/);
      await gotoHydrated(page, "/seguranca");
      await page.getByRole("button", { name: "Ativar App Lock" }).click();
      const create = page.getByRole("dialog", { name: "Criar PIN da Elyra" });
      await create.getByLabel("Novo PIN").fill("582047");
      await create.getByLabel("Confirmar PIN").fill("582047");
      await create.getByRole("button", { name: "Ativar", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("App Lock ativado");
      await page.getByRole("button", { name: "Bloquear agora" }).click();
      await expect(page.getByRole("heading", { name: "Elyra bloqueada" })).toBeVisible();

      await page.goto(`${baseURL}/pro/vinculos`);
      await expect(page).toHaveURL(/\/bloqueio\?next=%2Fpro%2Fvinculos$/);
      await page.getByLabel("PIN da Elyra").fill("582047");
      await page.getByRole("button", { name: "Desbloquear", exact: true }).click();
      await expect(page).toHaveURL(/\/pro\/vinculos$/);
    } finally {
      await context.close();
      await cleanupAccounts(admin, created);
    }
  });

  test("recovery continua unico: redefine a senha e a entrada profissional segue valendo", async ({ browser, baseURL }, testInfo) => {
    const admin = qaAdmin();
    const created: string[] = [];
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Pro Recovery QA");
      created.push(pro.userId);
      const page = await context.newPage();
      await gotoHydrated(page, "/recuperar-senha");
      await page.getByLabel("E-mail").fill(pro.email);
      await page.getByRole("button", { name: "Enviar link de recuperação" }).click();
      await expect(page.getByRole("status")).toContainText("Se houver uma conta");

      let link: string | null = null;
      for (let attempt = 0; attempt < 15 && !link; attempt += 1) {
        await new Promise((r) => setTimeout(r, 800));
        const box = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${pro.email}`)}`)).json();
        const message = (box.messages ?? [])[0];
        if (!message) continue;
        const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
        const match = `${full.Text ?? ""} ${full.HTML ?? ""}`.match(/https?:\/\/[^"'\s<>]*\/auth\/v1\/verify\?[^"'\s<>]+/);
        if (match) link = match[0].replace(/&amp;/g, "&");
      }
      expect(link, "link de recovery no capturador local").toBeTruthy();
      expect(new URL(link!).origin).toBe("http://127.0.0.1:54381");
      await page.goto(link!);
      await expect(page).toHaveURL(/\/redefinir-senha$/);
      const newPassword = `Qa${crypto.randomUUID().replaceAll("-", "")}7`;
      await page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
      await page.getByLabel("Repita a nova senha").fill(newPassword);
      await page.getByRole("button", { name: "Salvar nova senha" }).click();
      await expect(page.getByRole("status")).toContainText("Senha redefinida");

      const renewed: QaAccount = { ...pro, password: newPassword };
      await signIn(page, baseURL!, renewed, "?context=professional");
      await expect(page).toHaveURL(/\/pro\/dashboard$/);
    } finally {
      await context.close();
      await cleanupAccounts(admin, created);
    }
  });

  test("Google: a intencao profissional so viaja no retorno para o nosso callback", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const page = await context.newPage();
      let authorize: URL | null = null;
      // O provedor real nao existe no QA local; interceptar prova o contrato da URL.
      await page.route("**/auth/v1/authorize**", async (route) => {
        authorize = new URL(route.request().url());
        await route.fulfill({ status: 200, contentType: "text/html", body: "<title>google</title>" });
      });
      await gotoHydrated(page, "/entrar?context=professional");
      await page.getByRole("button", { name: "Continuar com o Google" }).click();
      await expect.poll(() => authorize?.toString() ?? "").toContain("provider=google");
      const back = new URL(authorize!.searchParams.get("redirect_to")!);
      expect(back.origin).toBe(new URL(baseURL!).origin);
      expect(back.pathname).toBe("/auth/callback");
      expect(back.searchParams.get("context")).toBe("professional");

      authorize = null;
      await gotoHydrated(page, "/entrar");
      await page.getByRole("button", { name: "Continuar com o Google" }).click();
      await expect.poll(() => authorize?.toString() ?? "").toContain("provider=google");
      expect(new URL(authorize!.searchParams.get("redirect_to")!).searchParams.has("context")).toBe(false);
    } finally {
      await context.close();
    }
  });
});

test.describe("Stage 29 / AUTH-CONTEXT - visual", () => {
  test("login pessoal e profissional; seletor de area no shell", async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(120_000);
    const shots = process.env.ELYRA_SHOTS_DIR ?? "test-results/stage29-shots";
    const admin = qaAdmin();
    const created: string[] = [];
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: testInfo.project.use.viewport ?? undefined,
      isMobile: testInfo.project.use.isMobile,
      hasTouch: testInfo.project.use.hasTouch,
      userAgent: testInfo.project.use.userAgent,
      deviceScaleFactor: testInfo.project.use.deviceScaleFactor,
    });
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Pro Visual QA");
      created.push(pro.userId);
      const page = await context.newPage();
      for (const [query, slug, heading] of [
        ["", "entrar", "Entrar na Elyra"],
        ["?context=professional", "entrar-profissional", "Entrar como profissional"],
      ] as const) {
        await gotoHydrated(page, `/entrar${query}`);
        await expect(page.getByRole("heading", { name: heading })).toBeVisible();
        await page.screenshot({ path: `${shots}/auth-${testInfo.project.name}/${slug}.png`, fullPage: true });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, slug).toBeLessThanOrEqual(0);
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`), slug).toEqual([]);
      }

      await signIn(page, baseURL!, pro, "?context=professional");
      await expect(page).toHaveURL(/\/pro\/dashboard$/);
      if (testInfo.project.name === "mobile" || testInfo.project.name === "tablet") {
        await page.getByRole("button", { name: "Abrir menu de navegação" }).click();
        const drawerSwitcher = page.getByRole("dialog").getByTestId("context-switcher");
        await expect(drawerSwitcher).toBeVisible();
        await page.screenshot({ path: `${shots}/auth-${testInfo.project.name}/drawer-profissional.png` });
        await drawerSwitcher.getByRole("button", { name: "Ir para a área pessoal" }).click();
        await expect(page).toHaveURL(/\/dashboard$/);
      } else {
        await expect(switcher(page)).toBeVisible();
        await page.screenshot({ path: `${shots}/auth-${testInfo.project.name}/shell-profissional.png` });
        const axe = await new AxeBuilder({ page }).include("[data-elyra-sidebar]").analyze();
        expect(axe.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      }
    } finally {
      await context.close();
      await cleanupAccounts(admin, created);
    }
  });
});
