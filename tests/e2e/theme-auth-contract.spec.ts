import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";

/**
 * Contrato de tema publico x conta (gate de freeze, 24/09/2026).
 *
 * Finding humano: `/entrar` abriu escuro sem contexto que justificasse. Causa: o
 * provider aplicava, sem conta no escopo, a chave de aparelho
 * `elyra.accessibility.v1` — legado de antes do isolamento por conta.
 *
 *   PUBLIC_AUTH_THEME   = SYSTEM_DEVICE_PREFERENCE
 *   AUTHENTICATED_THEME = USER_PREFERENCE_OR_SYSTEM
 *   LOGOUT_THEME        = SYSTEM_DEVICE_PREFERENCE
 *
 * A prova e o fundo pintado (cor computada), nao o atributo. Contas sinteticas
 * `@elyra.invalid`, criadas e apagadas aqui; nada usa a conta QA canonica.
 */

const LEGACY_KEY = "elyra.accessibility.v1";
type Scheme = "light" | "dark";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

let admin: SupabaseClient<Database>;
const created: { id: string; email: string }[] = [];
const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
const accountA = { email: `theme-a-${run}@elyra.invalid`, password, displayName: "Pessoa Tema A" };
const accountB = { email: `theme-b-${run}@elyra.invalid`, password, displayName: "Pessoa Tema B" };

test.beforeAll(async () => {
  process.loadEnvFile?.(".env.local");
  admin = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  for (const account of [accountA, accountB]) {
    created.push({ id: await createConfirmedQaUser(admin, account), email: account.email });
  }
});

test.afterAll(async () => {
  for (const { id, email } of created) {
    assertNotQaCanonicalAccount(email);
    await admin.auth.admin.deleteUser(id);
  }
});

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Contrato de tema independe do viewport.");
});

/** Tema efetivamente pintado: luminancia do fundo do body. */
function painted(page: Page): Promise<Scheme> {
  return page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.map(Number);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 128 ? "dark" : "light";
  });
}

async function freshPage(browser: Browser, device: Scheme, seed: Record<string, string> = {}) {
  const context = await browser.newContext({
    colorScheme: device,
    viewport: { width: 1440, height: 900 },
    storageState: { cookies: [], origins: [] },
  });
  /*
   * Grava o tema pintado no primeiro quadro (antes de qualquer JS da app) e toda
   * troca de `data-elyra-theme` durante a carga: flash = alguma troca.
   */
  await context.addInitScript((initial: Record<string, string>) => {
    if (!sessionStorage.getItem("__theme_seeded")) {
      sessionStorage.setItem("__theme_seeded", "1");
      for (const [key, value] of Object.entries(initial)) localStorage.setItem(key, value);
    }
    const log: string[] = [];
    (window as unknown as { __themeLog: string[] }).__themeLog = log;
    // `document` existe antes do `<html>`: observar por ele pega desde o parse.
    new MutationObserver(() => log.push(document.documentElement.dataset.elyraTheme ?? "")).observe(
      document,
      { subtree: true, attributes: true, attributeFilter: ["data-elyra-theme"] },
    );
    // Primeiro quadro em que o body existe (o init script roda antes do parse).
    const sample = () => {
      if (!document.body) return requestAnimationFrame(sample);
      const bg = getComputedStyle(document.body).backgroundColor;
      (window as unknown as { __firstPaintBg: string }).__firstPaintBg = bg;
      return 0;
    };
    requestAnimationFrame(sample);
  }, seed);
  const page = await context.newPage();
  return { context, page };
}

async function setAccountTheme(page: Page, label: "Claro" | "Escuro" | "Seguir dispositivo") {
  await gotoHydrated(page, "/configuracoes/personalizacao");
  await page.getByRole("button", { name: label, exact: true }).click();
  await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-pressed", "true");
}

async function logout(page: Page) {
  await gotoHydrated(page, "/perfil");
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/entrar$/);
  await page.waitForSelector("html[data-hydrated='true']");
}

const firstPaint = (page: Page) =>
  page.evaluate(() => {
    const [r, g, b] = (window as unknown as { __firstPaintBg: string }).__firstPaintBg.match(/\d+/g)!.map(Number);
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! < 128 ? "dark" : "light";
  });
const themeChanges = (page: Page) => page.evaluate(() => (window as unknown as { __themeLog: string[] }).__themeLog);

for (const device of ["light", "dark"] as const) {
  test(`Auth publico, aparelho ${device}: primeiro quadro e pos-hidratacao no tema do aparelho, mesmo com legado oposto`, async ({ browser }) => {
    const opposite = device === "light" ? "dark" : "light";
    // Chave de aparelho legada com o tema oposto: exatamente o estado do finding.
    const { context, page } = await freshPage(browser, device, {
      [LEGACY_KEY]: JSON.stringify({ theme: opposite }),
    });
    const response = await page.goto("/entrar");
    expect(/data-elyra-theme="([^"]+)"/.exec(await response!.text())?.[1]).toBe("system");
    await page.waitForSelector("html[data-hydrated='true']");
    await page.waitForTimeout(400);

    expect(await firstPaint(page), "AUTH_THEME_FIRST_PAINT").toBe(device);
    expect(await painted(page), "AUTH_THEME_AFTER_HYDRATION").toBe(device);
    expect(await themeChanges(page), "nenhuma troca de tema durante a carga (sem flash)").toEqual([]);
    await context.close();
  });
}

test("Auth publico acompanha a troca de tema do sistema com a pagina aberta", async ({ browser }) => {
  const { context, page } = await freshPage(browser, "light");
  await gotoHydrated(page, "/entrar");
  expect(await painted(page)).toBe("light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => painted(page)).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(() => painted(page)).toBe("light");
  await context.close();
});

test("conta: claro vence aparelho escuro, escuro vence aparelho claro, sistema segue o aparelho; logout volta ao aparelho", async ({ browser }) => {
  // A = claro, aparelho escuro.
  {
    const { context, page } = await freshPage(browser, "dark");
    await loginThroughUi(page, "", accountA);
    await setAccountTheme(page, "Claro");
    await gotoHydrated(page, "/dashboard");
    expect(await painted(page), "AUTHENTICATED_USER_LIGHT").toBe("light");
    await page.reload();
    await page.waitForSelector("html[data-hydrated='true']");
    await expect.poll(() => painted(page)).toBe("light");
    /*
     * Registro (nao assercao): pagina AUTENTICADA com tema da conta diferente do
     * aparelho. O HTML do servidor nao conhece o localStorage da conta, entao o
     * primeiro quadro e o do aparelho e a conta entra na hidratacao. Limitacao
     * conhecida e anterior a este gate; o contrato de primeiro quadro e do Auth.
     */
    test.info().annotations.push({
      type: "authenticated-reload-first-paint",
      description: JSON.stringify({ firstPaint: await firstPaint(page), changes: await themeChanges(page) }),
    });
    await logout(page);
    expect(await painted(page), "LOGOUT: conta clara, aparelho escuro").toBe("dark");
    await context.close();
  }
  // A = escuro, aparelho claro.
  {
    const { context, page } = await freshPage(browser, "light");
    await loginThroughUi(page, "", accountA);
    await setAccountTheme(page, "Escuro");
    await gotoHydrated(page, "/dashboard");
    expect(await painted(page), "AUTHENTICATED_USER_DARK").toBe("dark");
    await logout(page);
    expect(await painted(page), "LOGOUT: conta escura, aparelho claro").toBe("light");
    await context.close();
  }
  // A = sistema, nos dois aparelhos.
  for (const device of ["dark", "light"] as const) {
    const { context, page } = await freshPage(browser, device);
    await loginThroughUi(page, "", accountA);
    await setAccountTheme(page, "Seguir dispositivo");
    await gotoHydrated(page, "/dashboard");
    expect(await painted(page), `AUTHENTICATED_USER_SYSTEM (${device})`).toBe(device);
    await context.close();
  }
});

test("mesmo aparelho: A escuro -> logout -> B claro entra claro, e o Login entre os dois segue o aparelho", async ({ browser }) => {
  const { context, page } = await freshPage(browser, "light");
  await loginThroughUi(page, "", accountA);
  await setAccountTheme(page, "Escuro");
  expect(await painted(page)).toBe("dark");
  await logout(page);
  expect(await painted(page), "Login depois de A").toBe("light");

  await loginThroughUi(page, "", accountB);
  await setAccountTheme(page, "Claro");
  await gotoHydrated(page, "/dashboard");
  expect(await painted(page), "B claro").toBe("light");
  await logout(page);

  // Aparelho escuro agora: o Login segue o aparelho, e nao A nem B.
  await page.emulateMedia({ colorScheme: "dark" });
  await gotoHydrated(page, "/entrar");
  expect(await painted(page), "Login com as duas contas salvas no aparelho").toBe("dark");

  // A volta e reencontra o proprio escuro; nada de B.
  await page.emulateMedia({ colorScheme: "light" });
  await loginThroughUi(page, "", accountA);
  await expect.poll(() => painted(page)).toBe("dark");
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("elyra.accessibility")));
  expect(keys.every((key) => key.includes(":")), `sem chave de aparelho: ${keys.join(",")}`).toBe(true);
  await context.close();
});
