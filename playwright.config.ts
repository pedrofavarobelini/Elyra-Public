import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
// WebAuthn exige um RP ID de dominio. `localhost` e a excecao segura para
// desenvolvimento local; um endereco IP literal como 127.0.0.1 e rejeitado
// pelo navegador antes de a resposta chegar ao Supabase.
const BASE_URL = `http://localhost:${PORT}`;


const RUN_SLOT = process.env.ELYRA_E2E_SLOT ? `-${process.env.ELYRA_E2E_SLOT}` : "";

export default defineConfig({
  testDir: "./tests",

  testMatch: "**/*.spec.ts",

  testIgnore: "**/homologation/**",
  globalSetup: "./tests/global-setup.ts",
  globalTeardown: "./tests/global-teardown.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Falha funcional nunca recebe segunda chance, nem localmente nem em CI.
  // A unica recuperacao permitida e a navegacao `net::ERR_ABORTED`, limitada e
  // auditada por `gotoHydrated`; ela nao repete teste nem assercao.
  retries: 0,
  /*
   * Isolamento fixo para o QA persistente.
   *
   * Cada invocacao usa um processo `next start` e a instancia Supabase local.
   * `npm run qa:e2e` executa os tres viewports em processos sequenciais para
   * limitar o tempo de vida do transporte do Next 16 sem compartilhar estado
   * de browser ou servidor entre viewports. Dentro de cada processo, um worker
   * preserva a ordem; `retries` continua em 0, entao falha real nunca e
   * mascarada por nova tentativa.
   */
  workers: 1,

  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: `test-results/_latest/report${RUN_SLOT}.json` }],
    ["./tests/reporters/transport-recovery-reporter.ts"],
  ],

  outputDir: RUN_SLOT ? `test-results/${RUN_SLOT.slice(1)}` : "test-results",
  use: {
    baseURL: BASE_URL,
    storageState: "test-results/.auth/user.json",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, storageState: "test-results/.auth/desktop.json" } },
    { name: "tablet", use: { ...devices["Desktop Chrome"], viewport: { width: 834, height: 1112 }, storageState: "test-results/.auth/tablet.json" } },
    { name: "mobile", use: { ...devices["Pixel 5"], storageState: "test-results/.auth/mobile.json" } },

    ...(process.env.ELYRA_BRAVE_PATH
      ? [
          {
            name: "brave" as const,
            use: {
              ...devices["Desktop Chrome"],
              viewport: { width: 1440, height: 900 },
              storageState: "test-results/.auth/desktop.json",
              launchOptions: { executablePath: process.env.ELYRA_BRAVE_PATH },
            },
          },
        ]
      : []),
  ],

  webServer: {
    command: `npx next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: process.env.ELYRA_E2E_REUSE_SERVER === "true",
    timeout: 120_000,


    env: {
      ...process.env,
      ELYRA_QA_GROUP_SIZE: process.env.ELYRA_QA_GROUP_SIZE ?? "3",
      ELYRA_RECOVERY_DELIVERY: process.env.ELYRA_RECOVERY_DELIVERY ?? "gotrue",
      // SUP-3 (ADR-0033): a regressao canonica prova a superficie publicada.
      // REVIEW permanece em suite unitaria e pode ser ligado manualmente.
      ELYRA_SUPPORT_CONTENT_PREVIEW: process.env.ELYRA_SUPPORT_CONTENT_PREVIEW ?? "off",
    } as Record<string, string>,
  },
});
