/**
 * Preflight da regressao canonica.
 *
 * Uma execucao integral custa entre 15 e 60 minutos. Terminar essa hora e
 * descobrir que o resultado nao vale - porque havia um servidor orfao servindo
 * um build antigo, ou residuo de um run abortado no banco - e pior do que nao
 * ter executado. Este script recusa comecar quando o ambiente comprovadamente
 * nao pode produzir evidencia confiavel.
 *
 * O escopo e deliberadamente estreito: **so fatores controlaveis e objetivos**.
 * Ele nunca encerra processo que nao consiga provar ser da Elyra, nunca pede
 * que o usuario feche aplicativo, e nunca transforma carga momentanea de CPU em
 * bloqueio. Prova de posse aqui significa uma coisa so: a linha de comando do
 * processo contem a raiz deste repositorio.
 *
 *   node scripts/qa-preflight.ts          audita e reporta
 *   node scripts/qa-preflight.ts --fix    remedia o que for comprovadamente QA
 *   node scripts/qa-preflight.ts --accept-power-risk
 *                                         rebaixa o bloqueio de energia a aviso
 *
 * Saida: `QA_PREFLIGHT=PASS` ou `QA_PREFLIGHT=BLOCKED reason=<...>`.
 */

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync, statfsSync } from "node:fs";
import { loadavg, cpus } from "node:os";
import { join, resolve } from "node:path";

import { cleanupQaUser, isPlaywrightQaEmail } from "../tests/qa-cleanup.ts";

const ROOT = process.cwd();
const FIX = process.argv.includes("--fix");

const ACCEPT_POWER_RISK = process.argv.includes("--accept-power-risk");
const E2E_PORT = 3100;


const MIN_FREE_BYTES = 2 * 1024 ** 3;

type Severity = "BLOCKED" | "FIXED" | "WARN" | "PASS";

interface Finding {
  check: string;
  severity: Severity;
  detail: string;
}

const findings: Finding[] = [];
const record = (check: string, severity: Severity, detail: string) => {
  findings.push({ check, severity, detail });
};

/**
 * O preflight nasceu para proteger uma estacao de trabalho Windows, e usa
 * PowerShell para enxergar processos, portas, disco, bateria e CPU.
 *
 * Ele passou a rodar tambem em runner Linux, onde a regressao integral cabe na
 * memoria. Nenhuma checagem foi desligada por causa disso: cada uma ganhou o
 * equivalente POSIX. Desligar seria transformar "nao consigo medir" em "esta
 * tudo bem", que e o oposto do que este script existe para fazer.
 */
const WINDOWS = process.platform === "win32";

function powershell(script: string): string {
  return execFileSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      // stderr descartado: contador indisponivel ou processo que sumiu entre
      // a consulta e a acao sao condicoes esperadas aqui, e o relatorio ja diz
      // o que elas significam. Ruido do PowerShell no meio da tabela so
      // dificultaria ler o veredito.
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
}

function powershellJson<T>(script: string): T[] {
  const raw = powershell(script + " | ConvertTo-Json -Depth 3 -Compress").trim();
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed : [parsed]) as T[];
}

interface WinProcess {
  ProcessId: number;
  CommandLine: string | null;
}

/**
 * Prova de posse.
 *
 * Um processo so e tratado como criado por este QA se a raiz do repositorio
 * aparecer na sua linha de comando. Chrome, Edge e WebView do usuario nunca
 * satisfazem essa condicao - e por isso nunca sao tocados, mesmo quando um
 * Chromium aparece na lista logo depois de uma execucao.
 */
function ownedByThisRepo(commandLine: string | null): boolean {
  if (!commandLine) return false;
  const haystack = commandLine.toLowerCase().replaceAll("/", "\\");
  return haystack.includes(ROOT.toLowerCase().replaceAll("/", "\\"));
}

function nodeProcesses(): WinProcess[] {
  if (WINDOWS) {
    return powershellJson<WinProcess>(
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"" +
        " | Select-Object ProcessId, CommandLine",
    );
  }
  try {
    // `ps -eo pid=,args=` sai sem cabecalho: cada linha e pid + linha de comando.
    const raw = execFileSync("ps", ["-eo", "pid=,args="], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return raw
      .split("\n")
      .map((linha) => linha.trim().match(/^(\d+)\s+(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => ({ ProcessId: Number(m[1]), CommandLine: m[2] ?? null }))
      .filter((p) => /node/.test(p.CommandLine ?? ""));
  } catch {
    return [];
  }
}

/**
 * Um Playwright ativo torna qualquer remediacao concorrente invalida.
 *
 * Sem este guarda, `qa:preflight --fix` poderia interpretar o servidor e as
 * identidades da execucao viva como residuos, encerrar o Next e remover os
 * usuarios debaixo do worker. A raiz na linha de comando prova ownership; o
 * executavel do runner/worker prova que nao e apenas um servidor orfao.
 */
function checkActivePlaywright(): number[] {
  const active = nodeProcesses()
    .filter(
      (process) =>
        ownedByThisRepo(process.CommandLine) &&
        /@playwright[\\/]test[\\/]cli\.js|playwright[\\/]lib[\\/]worker[\\/]workerProcessEntry\.js/i
          .test(process.CommandLine ?? ""),
    )
    .map((process) => process.ProcessId);

  if (active.length === 0) {
    record("playwright_run", "PASS", "nenhuma regressao ativa");
  } else {
    record(
      "playwright_run",
      "BLOCKED",
      "regressao Elyra ativa pid=" + active.join(",") +
        "; nenhum processo ou residuo sera tocado",
    );
  }
  return active;
}

// ---------------------------------------------------------------- 1. repo
function checkRepo() {
  const pkg = join(ROOT, "package.json");
  if (!existsSync(pkg)) return record("repo", "BLOCKED", "package_json_ausente");
  const name = (JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name;
  if (name !== "elyra") {
    return record("repo", "BLOCKED", "package_name_inesperado=" + name);
  }
  record("repo", "PASS", ROOT);
}

// ------------------------------------------------- 2. guarda do banco QA
function checkDbGuard() {
  try {
    const out = execFileSync("node", ["scripts/qa-db-guard.mjs"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    record("db_guard", "PASS", out.trim());
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : "erro";
    record("db_guard", "BLOCKED", "qa_db_guard_falhou: " + detail);
  }
}

// ------------------------------------------------------- 3. Supabase vivo
async function checkSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return record("supabase", "BLOCKED", "NEXT_PUBLIC_SUPABASE_URL ausente");
  try {
    const response = await fetch(new URL("/auth/v1/health", url), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return record("supabase", "BLOCKED", "auth_health_http_" + response.status);
    }
    record("supabase", "PASS", "auth ok em " + url);
  } catch {
    record("supabase", "BLOCKED", "supabase_local_inacessivel");
  }
}

// ---------------------------------------- 4. porta do Playwright liberada
function checkPort(activePlaywright: number[]) {
  let owners: number[] = [];
  try {
    owners = WINDOWS
      ? powershellJson<{ OwningProcess: number }>(
          "Get-NetTCPConnection -LocalPort " + E2E_PORT + " -State Listen" +
            " -ErrorAction SilentlyContinue | Select-Object OwningProcess",
        ).map((row) => row.OwningProcess)
      : execFileSync(
          "lsof",
          ["-ti", "tcp:" + E2E_PORT, "-sTCP:LISTEN"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        )
          .split("\n")
          .map((linha) => Number(linha.trim()))
          .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    // `lsof` sai com codigo 1 quando nada escuta na porta - o caso comum.
    owners = [];
  }
  const unique = [...new Set(owners)].filter(Boolean);
  if (unique.length === 0) return record("porta", "PASS", E2E_PORT + " livre");

  if (activePlaywright.length > 0) {
    return record(
      "porta",
      "BLOCKED",
      "porta " + E2E_PORT + " pertence a regressao ativa; nao sera encerrada",
    );
  }

  const table = new Map(nodeProcesses().map((p) => [p.ProcessId, p.CommandLine]));
  for (const pid of unique) {
    const cmd = table.get(pid) ?? null;
    if (!ownedByThisRepo(cmd)) {
      record(
        "porta",
        "BLOCKED",
        "porta " + E2E_PORT + " ocupada por pid=" + pid +
          " sem prova de posse; nao sera encerrado. Linha: " +
          (cmd ?? "<indisponivel>"),
      );
      continue;
    }
    if (!FIX) {
      record(
        "porta",
        "BLOCKED",
        "servidor da Elyra ocupando " + E2E_PORT + " (pid=" + pid + "); use --fix",
      );
      continue;
    }
    powershell("Stop-Process -Id " + pid + " -Force");
    record("porta", "FIXED", "servidor da Elyra encerrado (pid=" + pid + ")");
  }
}

// --------------------------------------------- 5. servidores Next orfaos
function checkOrphanServers(activePlaywright: number[]) {
  const orphans = nodeProcesses().filter(
    (p) =>
      ownedByThisRepo(p.CommandLine) &&
      /next["\s]+(start|dev)/i.test(p.CommandLine ?? ""),
  );
  if (orphans.length === 0) return record("servidor_orfao", "PASS", "nenhum");

  if (activePlaywright.length > 0) {
    return record(
      "servidor_orfao",
      "BLOCKED",
      "Next pertence a regressao ativa; nao sera encerrado",
    );
  }

  for (const orphan of orphans) {
    if (!FIX) {
      record(
        "servidor_orfao",
        "BLOCKED",
        "next server da Elyra vivo (pid=" + orphan.ProcessId + "); use --fix",
      );
      continue;
    }
    powershell("Stop-Process -Id " + orphan.ProcessId + " -Force");
    record("servidor_orfao", "FIXED", "encerrado pid=" + orphan.ProcessId);
  }
}

// ------------------------------------------------------- 6. build atual
function newestSourceMtime(): { path: string; mtime: number } {
  let newest = { path: "", mtime: 0 };
  const roots = ["src", "next.config.ts", "package.json", "tsconfig.json"];
  const visit = (target: string) => {
    if (!existsSync(target)) return;
    const stat = statSync(target);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(target)) visit(join(target, entry));
      return;
    }
    if (stat.mtimeMs > newest.mtime) newest = { path: target, mtime: stat.mtimeMs };
  };
  for (const target of roots) visit(resolve(ROOT, target));
  return newest;
}

function checkBuild() {
  const buildId = resolve(ROOT, ".next", "BUILD_ID");
  if (!existsSync(buildId)) {
    return record("build", "BLOCKED", "`.next` ausente - rode `npm run build`");
  }
  const built = statSync(buildId).mtimeMs;
  const newest = newestSourceMtime();
  if (newest.mtime > built) {
    return record(
      "build",
      "BLOCKED",
      "build anterior ao fonte mais recente (" + newest.path +
        ") - rode `npm run build`",
    );
  }
  record("build", "PASS", "BUILD_ID de " + new Date(built).toISOString());
}

// ---------------------------------------------------- 7. residuo em disco
function checkOutputResidue(activePlaywright: number[]) {
  const dir = resolve(ROOT, "test-results");
  if (!existsSync(dir) || readdirSync(dir).length === 0) {
    return record("test_results", "PASS", "vazio");
  }
  if (activePlaywright.length > 0) {
    return record(
      "test_results",
      "BLOCKED",
      "artefatos pertencem a regressao ativa; nao serao removidos",
    );
  }
  if (!FIX) {
    return record(
      "test_results",
      "BLOCKED",
      "`test-results` de execucao anterior; use --fix",
    );
  }
  rmSync(dir, { recursive: true, force: true });
  record("test_results", "FIXED", "`test-results` removido");
}

// ------------------------------------------- 8. residuo de identidade QA
async function checkQaUsers(activePlaywright: number[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return record("usuarios_qa", "BLOCKED", "credenciais QA locais ausentes");
  }
  if (activePlaywright.length > 0) {
    return record(
      "usuarios_qa",
      "BLOCKED",
      "identidades pertencem a regressao ativa; cleanup nao executado",
    );
  }
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const residues: string[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      return record("usuarios_qa", "BLOCKED", "listUsers falhou: " + error.message);
    }
    residues.push(
      ...data.users.filter((u) => isPlaywrightQaEmail(u.email ?? "")).map((u) => u.id),
    );
    if (data.users.length < 1000) break;
  }

  const unique = new Set(residues);
  if (unique.size === 0) return record("usuarios_qa", "PASS", "zero residuo");
  if (!FIX) {
    return record(
      "usuarios_qa",
      "BLOCKED",
      unique.size + " identidade(s) QA de run abortado; use --fix",
    );
  }
  for (const userId of unique) {
    // A segunda passagem prova idempotencia, como no teardown.
    await cleanupQaUser(admin as never, userId);
    await cleanupQaUser(admin as never, userId);
  }
  record("usuarios_qa", "FIXED", unique.size + " identidade(s) removida(s)");
}

// ------------------------------------------------------------ 9. disco
function checkDisk() {
  try {
    let free: number;
    if (WINDOWS) {
      const [volume] = powershellJson<{ Free: number }>(
        "Get-PSDrive -Name " + ROOT[0] + " | Select-Object Free",
      );
      free = Number(volume?.Free ?? 0);
    } else {
      const fs = statfsSync(ROOT);
      free = Number(fs.bavail) * Number(fs.bsize);
    }
    const gb = (free / 1024 ** 3).toFixed(1);
    if (free < MIN_FREE_BYTES) {
      return record("disco", "BLOCKED", gb + " GB livres, minimo 2.0 GB");
    }
    record("disco", "PASS", gb + " GB livres");
  } catch {
    record("disco", "WARN", "espaco livre nao pode ser medido");
  }
}

// ------------------------------------------------------- 10. energia

function checkPower() {
  let battery;
  if (!WINDOWS) {
    // Runner de CI nao tem bateria, e a checagem existe para o notebook.
    return record("energia", "PASS", "sem bateria (ambiente efemero)");
  }
  try {
    [battery] = powershellJson<{
      BatteryStatus: number;
      EstimatedChargeRemaining: number;
    }>(
      "Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue" +
        " | Select-Object BatteryStatus, EstimatedChargeRemaining",
    );
  } catch {
    return record("energia", "WARN", "estado de energia nao pode ser lido");
  }

  // Sem bateria: desktop ligado na rede eletrica, que e o caso ideal.
  if (!battery) return record("energia", "PASS", "sem bateria (rede eletrica)");

  const charge = Number(battery.EstimatedChargeRemaining);
  // `BatteryStatus` 1 e o unico valor que significa "descarregando"; 2 e "na
  // tomada" e os demais sao estados de carga, todos com energia externa.
  const onBattery = Number(battery.BatteryStatus) === 1;

  if (onBattery) {
    if (ACCEPT_POWER_RISK) {
      return record(
        "energia",
        "WARN",
        `na bateria (${charge}%) - risco ACEITO explicitamente via ` +
          "--accept-power-risk. Se a maquina suspender, o run e " +
          "INVALID_ENVIRONMENT_INTERRUPTION e nao vale como evidencia",
      );
    }
    return record(
      "energia",
      "BLOCKED",
      `na bateria (${charge}%) - ligue na tomada. Uma regressao integral ja foi ` +
        "perdida por hibernacao de bateria critica no meio da execucao",
    );
  }
  if (charge < 20) {
    return record(
      "energia",
      "WARN",
      `na tomada, mas com ${charge}% - uma queda de energia hibernaria a maquina`,
    );
  }
  record("energia", "PASS", `na tomada (${charge}%)`);
}

// ------------------------------------------- 11. modo do servidor de teste
function checkWebServerMode() {
  if (process.env.ELYRA_E2E_REUSE_SERVER === "true") {
    return record(
      "webserver",
      "BLOCKED",
      "ELYRA_E2E_REUSE_SERVER=true e modo de depuracao; a regressao canonica " +
        "exige servidor proprio",
    );
  }
  record("webserver", "PASS", "servidor proprio por execucao");
}

// ------------------------------------------ 12. carga (nunca bloqueia)

function checkLoad() {
  try {
    // `Get-Counter` usa nomes de contador traduzidos e falha nesta maquina,
    // que roda Windows em pt-BR. `Win32_Processor.LoadPercentage` e
    // independente de idioma.
    const samples = WINDOWS
      ? powershellJson<{ LoadPercentage: number | null }>(
          "1..3 | ForEach-Object {" +
            " Get-CimInstance Win32_Processor | Select-Object LoadPercentage;" +
            " Start-Sleep -Milliseconds 700 }",
        )
          .map((row) => Number(row.LoadPercentage))
          .filter((value) => Number.isFinite(value))
      // `loadavg` e fila media de execucao, nao percentual: dividir pelo numero
      // de nucleos converte para uma escala comparavel a do Windows.
      : [Math.round(((loadavg()[0] ?? 0) / Math.max(cpus().length, 1)) * 100)].filter(
          (value) => Number.isFinite(value),
        );
    if (samples.length === 0) return record("carga", "WARN", "cpu nao amostrada");
    const avg = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
    record("carga", "WARN", "cpu amostrada " + samples.join("/") + "% (media " + avg + "%)");
  } catch {
    record("carga", "WARN", "cpu nao amostrada");
  }
}

// ------------------------------------------------------------------ main
async function main() {
  try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

  checkRepo();
  const activePlaywright = checkActivePlaywright();
  checkDbGuard();
  await checkSupabase();
  checkPort(activePlaywright);
  checkOrphanServers(activePlaywright);
  checkBuild();
  checkOutputResidue(activePlaywright);
  await checkQaUsers(activePlaywright);
  checkDisk();
  checkPower();
  checkWebServerMode();
  checkLoad();

  const width = Math.max(...findings.map((f) => f.check.length));
  for (const finding of findings) {
    console.log(
      finding.severity.padEnd(8) + " " + finding.check.padEnd(width) + "  " + finding.detail,
    );
  }

  const blockers = findings.filter((f) => f.severity === "BLOCKED");
  if (blockers.length > 0) {
    console.error(
      "\nQA_PREFLIGHT=BLOCKED reason=" + blockers.map((b) => b.check).join(","),
    );
    process.exit(1);
  }
  const fixed = findings.filter((f) => f.severity === "FIXED").length;
  const exception = ACCEPT_POWER_RISK ? " excecao=energia" : "";
  console.log("\nQA_PREFLIGHT=PASS remediado=" + fixed + exception);
}

await main();
