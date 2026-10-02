

import { createClient } from "@supabase/supabase-js";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolveEvidenceStage } from "../tests/evidence-stage.ts";
import { isPlaywrightQaEmail } from "../tests/qa-cleanup.ts";

try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const ROOT = process.cwd();
const E2E_PORT = 3100;
const playwrightCli = resolve(ROOT, "node_modules", "@playwright", "test", "cli.js");
const preflightScript = resolve(ROOT, "scripts", "qa-preflight.ts");
const latestDir = resolve(ROOT, "test-results", "_latest");
const projects = ["desktop", "tablet", "mobile"];

function runNode(args, env) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
}

/** A porta liberada e a prova observavel de que o servidor do viewport morreu. */
function portListeners() {
  try {
    const raw = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${E2E_PORT} -State Listen -ErrorAction SilentlyContinue` +
          " | Select-Object OwningProcess | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.length : 1;
  } catch {
    return 0;
  }
}

/** Identidades sinteticas ainda vivas: o teardown so passa quando isto e zero. */
async function qaIdentitiesRemaining() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let total = 0;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    total += data.users.filter((user) => isPlaywrightQaEmail(user.email ?? "")).length;
    if (data.users.length < 1000) break;
  }
  return total;
}

function readJson(path) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/**
 * Conta os desfechos percorrendo a arvore de suites do relatorio JSON.
 *
 * O campo `stats` do reporter conta specs, e um spec com varios `test` por
 * projeto nao e a mesma unidade que o `Total: N tests` do runner. Percorrer os
 * resultados devolve exatamente a unidade que o gate cita.
 */
function tally(report) {
  const counts = { discovered: 0, passed: 0, failed: 0, skipped: 0, retries: 0 };
  const walk = (suite) => {
    for (const child of suite.suites ?? []) walk(child);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        counts.discovered += 1;
        counts.retries += Math.max(0, (test.results?.length ?? 1) - 1);
        const status = test.status ?? "unknown";
        if (status === "expected") counts.passed += 1;
        else if (status === "skipped") counts.skipped += 1;
        else counts.failed += 1;
      }
    }
  };
  for (const suite of report.suites ?? []) walk(suite);
  return counts;
}

// Flags da linha de comando chegam ao preflight - hoje `--accept-power-risk`,
// que precisa ser declarada por quem executa e nao pode ser embutida aqui.
const preflight = runNode([preflightScript, ...process.argv.slice(2)]);
if (preflight.error) throw preflight.error;
if (preflight.status !== 0) {
  console.error(`QA_E2E=BLOCKED preflight_exit=${preflight.status ?? "unknown"}`);
  process.exit(preflight.status ?? 1);
}

const stage = resolveEvidenceStage();
const evidenceDir = resolve(ROOT, "test-results", stage);
mkdirSync(evidenceDir, { recursive: true });

const viewports = [];
const failedProjects = [];

for (const project of projects) {
  console.log(`QA_E2E_PROJECT_BEGIN project=${project} server=fresh workers=1 retries=0`);
  const startedAt = Date.now();
  const reportPath = resolve(latestDir, `report-${project}.json`);
  rmSync(reportPath, { force: true });
  const result = runNode([playwrightCli, "test", `--project=${project}`], {
    ELYRA_E2E_SLOT: project,
  });
  if (result.error) throw result.error;
  const exitCode = result.status ?? 1;
  const wallMs = Date.now() - startedAt;

  /*
   * Relatorio ausente nunca vira relatorio antigo.
   *
   * Quando o processo do Playwright morre antes de escrever (OOM, DLL init
   * falhando, kill externo), este caminho ainda continha o arquivo da execucao
   * anterior. O agregador lia esse arquivo e atribuia os numeros dele ao
   * viewport que acabou de falhar: em 23/09 um run encerrado por falta de
   * memoria produziu `passed=597 failed=0` com `wall_ms=10` em dois viewports
   * cujo processo nem chegou a iniciar (exit 0xC0000142). O veredito saiu
   * `FAIL` pelos exit codes, mas os numeros mentiam sobre a propria origem.
   *
   * O arquivo e removido antes de cada viewport, entao "sem relatorio" fica
   * distinguivel de "relatorio zerado" e nao existe dado de outra execucao para
   * herdar.
   */
  const report = readJson(reportPath);
  const reportMissing = report === null;
  const transport = readJson(
    resolve(evidenceDir, `transport-navigation-recovery-${project}.json`),
  );
  const counts = report
    ? tally(report)
    : { discovered: 0, passed: 0, failed: 0, skipped: 0, retries: 0 };

  const listeners = portListeners();
  const identities = await qaIdentitiesRemaining();

  viewports.push({
    project,
    exit_code: exitCode,
    report_written: !reportMissing,
    ...counts,
    duration_ms: report?.stats?.duration ? Math.round(report.stats.duration) : wallMs,
    wall_ms: wallMs,
    transport_navigation_recoveries: transport?.count ?? null,
    /* Servidor proprio por viewport: se a porta continua ocupada, ele nao morreu. */
    server_exit: listeners === 0 ? "released" : `port_still_held_by_${listeners}`,
    cleanup_qa_identities_remaining: identities,
  });

  console.log(
    `QA_E2E_PROJECT_END project=${project} exit=${exitCode} ` +
      `tests=${counts.passed}/${counts.discovered} failed=${counts.failed} ` +
      `${reportMissing ? "report=MISSING " : ""}` +
      `retries=${counts.retries} transport_recoveries=${transport?.count ?? "n/a"} ` +
      `server=${listeners === 0 ? "released" : "HELD"} qa_identities=${identities}`,
  );
  if (exitCode !== 0 || reportMissing) failedProjects.push(project);
}

const total = viewports.reduce(
  (acc, viewport) => ({
    discovered: acc.discovered + viewport.discovered,
    passed: acc.passed + viewport.passed,
    failed: acc.failed + viewport.failed,
    skipped: acc.skipped + viewport.skipped,
    retries: acc.retries + viewport.retries,
    duration_ms: acc.duration_ms + viewport.duration_ms,
    transport_navigation_recoveries:
      acc.transport_navigation_recoveries +
      (viewport.transport_navigation_recoveries ?? 0),
  }),
  {
    discovered: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    retries: 0,
    duration_ms: 0,
    transport_navigation_recoveries: 0,
  },
);

const residue = viewports.at(-1)?.cleanup_qa_identities_remaining ?? null;
const verdict =
  failedProjects.length === 0 &&
  total.failed === 0 &&
  total.retries === 0 &&
  residue === 0
    ? "PASS"
    : "FAIL";

writeFileSync(
  resolve(evidenceDir, "e2e-regression.json"),
  JSON.stringify(
    {
      schema_version: "elyra-e2e-regression/v1",
      generated_at: new Date().toISOString(),
      architecture: "one-next-server-per-viewport",
      workers_per_process: 1,
      configured_retries: 0,
      verdict,
      total,
      viewports,
      failed_projects: failedProjects,
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.log("");
for (const viewport of viewports) {
  console.log(
    `  ${viewport.project.padEnd(8)} ${viewport.passed}/${viewport.discovered} ` +
      `failed=${viewport.failed} skipped=${viewport.skipped} ` +
      `retries=${viewport.retries} ${Math.round(viewport.duration_ms / 1000)}s ` +
      `transport=${viewport.transport_navigation_recoveries} ` +
      `server=${viewport.server_exit} qa_identities=${viewport.cleanup_qa_identities_remaining}`,
  );
}
console.log("");

if (verdict !== "PASS") {
  console.error(
    `QA_E2E=FAIL tests=${total.passed}/${total.discovered} failed=${total.failed} ` +
      `retries=${total.retries} qa_identities_remaining=${residue} ` +
      `projects_failed=${failedProjects.join(",") || "none"}`,
  );
  process.exit(1);
}

console.log(
  `QA_E2E=PASS tests=${total.passed}/${total.discovered} viewports=${projects.length} ` +
    `isolated_servers=${projects.length} retries=${total.retries} ` +
    `transport_recoveries=${total.transport_navigation_recoveries} residue=0`,
);
