/** Local-only mutation response probe. */

import { createClient } from "@supabase/supabase-js";
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

import { parseMutationTrace } from "../src/lib/observability/mutation-trace.ts";
import { resolveEvidenceStage } from "../tests/evidence-stage.ts";
import { cleanupQaUser } from "../tests/qa-cleanup.ts";

try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const ROOT = process.cwd();
const PORT = 3101;
const BASE_URL = "http://127.0.0.1:" + PORT;
const SEQUENTIAL_JOURNAL_OPS = 40;
const NAVIGATION_RACE_OPS = 10;

execFileSync(process.execPath, ["scripts/qa-db-guard.mjs"], { stdio: "inherit", windowsHide: true });
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("MUTATION_PROBE=BLOCKED reason=credenciais_qa_locais_ausentes");
  process.exit(1);
}
if (process.env.ELYRA_RUNTIME_ENV !== "qa") {
  console.error("MUTATION_PROBE=BLOCKED reason=ELYRA_RUNTIME_ENV_nao_e_qa");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const traces = [];
const serverLines = [];

function startServer() {
  const nextBin = resolve(ROOT, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(
    process.execPath,
    [nextBin, "start", "--port", String(PORT)],
    { cwd: ROOT, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  const consume = (chunk) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (!line) continue;
      const trace = parseMutationTrace(line);
      if (trace) traces.push(trace);
      else serverLines.push(line);
    }
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);
  return child;
}

async function waitForServer(deadlineMs = 120_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(BASE_URL + "/entrar", {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return;
    } catch {
      /* servidor ainda subindo */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("Servidor da sonda nao respondeu em 120 s.");
}

/**
 * Emite uma mutacao de dentro da pagina, pelo mesmo transporte do browser.
 *
 * `page.request` sairia pelo Node e nao veria o cancelamento que este script
 * investiga; a assinatura `status = -1` so existe na pilha de rede do browser.
 */
const BROWSER_MUTATION = async ({ path, method, body, traceId }) => {
  const started = performance.now();
  try {
    const response = await fetch(path, {
      method,
      headers: {
        "content-type": "application/json",
        "x-elyra-trace-id": traceId,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    return {
      status: response.status,
      ms: Math.round(performance.now() - started),
      ok: response.ok && Boolean(payload && payload.data),
      transport: null,
    };
  } catch (error) {
    // `status: -1` e a assinatura exata observada no run que deixou `L-046`
    // aberto: a request nao voltou com resposta nenhuma.
    return {
      status: -1,
      ms: Math.round(performance.now() - started),
      ok: false,
      transport: String(error && error.message ? error.message : error),
    };
  }
};

const results = [];

function record(entry) {
  results.push(entry);
  const flag = entry.responseSeen ? "" : "  <-- SEM RESPOSTA";
  console.log(
    entry.arm.padEnd(16) +
      " " +
      entry.op.padEnd(16) +
      " status=" +
      String(entry.status).padStart(3) +
      " " +
      String(entry.ms).padStart(5) +
      " ms trace=" +
      entry.traceId +
      flag,
  );
}

let traceSequence = 0;
function nextTraceId() {
  traceSequence += 1;
  return (
    "probe-" +
    String(traceSequence).padStart(4, "0") +
    "-" +
    crypto.randomUUID().slice(0, 8)
  );
}

async function hydrate(page, path) {
  await page.goto(path);
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });
}

async function main() {
  const server = startServer();
  let browser;
  let userId = "";
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  const email = "playwright-desktop-" + run + "@elyra.invalid";
  const password = "Qa" + crypto.randomUUID().replaceAll("-", "") + "9";

  try {
    await waitForServer();
    browser = await chromium.launch();
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();

    await hydrate(page, "/cadastro");
    await page.getByLabel("Nome").fill("Demo");
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Criar conta" }).click();
    await page.waitForURL("**/dashboard", { timeout: 30_000 });

    const { data: users, error: listError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) throw listError;
    userId = users.users.find((user) => user.email === email)?.id ?? "";
    if (!userId) throw new Error("Identidade da sonda nao encontrada.");

    // ------------------------------------------------------- braco A
    const journalIds = [];
    for (let step = 0; step < SEQUENTIAL_JOURNAL_OPS; step += 1) {
      const id = crypto.randomUUID();
      journalIds.push(id);
      const trace = nextTraceId();
      const outcome = await page.evaluate(BROWSER_MUTATION, {
        path: "/api/journal/entries",
        method: "POST",
        body: {
          id,
          title: "Sonda " + step,
          content: "Registro sintetico da sonda de resposta.",
          tagIds: [],
          status: "draft",
        },
        traceId: trace,
      });
      record({
        arm: "sequential",
        op: "journal.create",
        entityId: id,
        traceId: trace,
        status: outcome.status,
        ms: outcome.ms,
        responseSeen: outcome.status !== -1,
        accepted: outcome.ok,
        transport: outcome.transport,
      });

      // Reidrata a pagina periodicamente: a falha observada aparecia numa tela
      // com trafego de leitura, nao num cliente ocioso.
      if (step > 0 && step % 10 === 0) await hydrate(page, "/diario");
    }

    for (const id of journalIds.slice(0, 10)) {
      const trace = nextTraceId();
      const outcome = await page.evaluate(BROWSER_MUTATION, {
        path: "/api/journal/entries",
        method: "POST",
        body: {
          id,
          title: "Sonda reescrita",
          content: "Mesma identidade, segunda escrita - prova de idempotencia.",
          tagIds: [],
          status: "saved",
        },
        traceId: trace,
      });
      record({
        arm: "sequential",
        op: "journal.update",
        entityId: id,
        traceId: trace,
        status: outcome.status,
        ms: outcome.ms,
        responseSeen: outcome.status !== -1,
        accepted: outcome.ok,
        transport: outcome.transport,
      });
    }

    for (let step = 0; step < 10; step += 1) {
      const trace = nextTraceId();
      const outcome = await page.evaluate(BROWSER_MUTATION, {
        path: "/api/goals",
        method: "POST",
        body: {
          title: "Meta da sonda " + step,
          kind: "frequency",
          recurrence: "daily",
          target: 3,
          unit: null,
        },
        traceId: trace,
      });
      record({
        arm: "sequential",
        op: "goal.create",
        entityId: null,
        traceId: trace,
        status: outcome.status,
        ms: outcome.ms,
        responseSeen: outcome.status !== -1,
        accepted: outcome.ok,
        transport: outcome.transport,
      });
    }

    await page.evaluate(BROWSER_MUTATION, {
      path: "/api/cycle/profile",
      method: "PATCH",
      body: { enabled: true },
      traceId: nextTraceId(),
    });
    for (let step = 0; step < 10; step += 1) {
      const day = new Date(Date.UTC(2026, 0, step + 1)).toISOString().slice(0, 10);
      const trace = nextTraceId();
      const outcome = await page.evaluate(BROWSER_MUTATION, {
        path: "/api/cycle/records",
        method: "POST",
        body: { date: day, flow: "light", symptoms: [], note: null },
        traceId: trace,
      });
      record({
        arm: "sequential",
        op: "cycle.record",
        entityId: day,
        traceId: trace,
        status: outcome.status,
        ms: outcome.ms,
        responseSeen: outcome.status !== -1,
        accepted: outcome.ok,
        transport: outcome.transport,
      });
    }

    // ------------------------------------------------------- braco B
    /*
     * Mutacao em voo no momento da navegacao.
     *
     * `fetch` sem `await`, navegacao imediata. Nao ha nada de artificial nisso:
     * e exatamente o que um autosave com debounce faz quando o teste segue para
     * a proxima assercao antes de a request terminar.
     */
    for (let step = 0; step < NAVIGATION_RACE_OPS; step += 1) {
      const id = crypto.randomUUID();
      const trace = nextTraceId();
      await hydrate(page, "/diario");
      /*
       * O `fetch` e disparado e **abandonado dentro da propria pagina**.
       *
       * A primeira versao desta sonda usava um `evaluate` aguardado e navegava
       * em seguida: o contexto de execucao morria antes de a request sair, e o
       * servidor nao registrava marcador nenhum. Isso nao reproduzia nada -
       * so provava que uma navegacao imediata cancela o `evaluate`. Aqui o
       * `evaluate` retorna assim que a request e emitida, entao ela esta de
       * fato em voo quando a navegacao acontece.
       *
       * A janela de corrida e varrida, nao chutada: o handler leva ~285 ms
       * medidos entre `HANDLER_RECEIVED` e `RESPONSE_CREATED`, e o passo de
       * 25 ms cobre desde "antes de o servidor receber" ate "depois de o
       * commit terminar". Nao e espera de prontidao - e o parametro do
       * experimento.
       */
      await page.evaluate(
        ({ path, body, traceId }) => {
          void fetch(path, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-elyra-trace-id": traceId,
            },
            body: JSON.stringify(body),
          }).catch(() => undefined);
        },
        {
          path: "/api/journal/entries",
          body: {
            id,
            title: "Corrida " + step,
            content: "Mutacao disparada e abandonada por navegacao imediata.",
            tagIds: [],
            status: "draft",
          },
          traceId: trace,
        },
      );
      const raceDelayMs = step * 25;
      await new Promise((done) => setTimeout(done, raceDelayMs));
      await page.goto("/metas").catch(() => undefined);
      // Ninguem observa a resposta por construcao: quem navegou abandonou a
      // request. O veredito vem do banco e dos marcadores de fronteira.
      const outcome = { status: -1, ms: raceDelayMs, ok: false, transport: "navegacao" };
      record({
        arm: "navigation-race",
        op: "journal.create",
        entityId: id,
        traceId: trace,
        status: outcome.status,
        ms: outcome.ms,
        responseSeen: outcome.status !== -1,
        accepted: outcome.ok,
        transport: outcome.transport,
      });
    }

    // -------------------------------------------- confronto com o banco
    const { data: rows, error: rowsError } = await admin
      .from("journal_entries")
      .select("id")
      .eq("user_id", userId);
    if (rowsError) throw rowsError;
    const committed = new Set(rows.map((row) => row.id));

    const verdicts = results.map((entry) => {
      const identified = entry.op.startsWith("journal") && entry.entityId !== null;
      const inDb = identified ? committed.has(entry.entityId) : entry.accepted;
      if (entry.responseSeen && inDb) {
        return { ...entry, verdict: "COMMITTED_RESPONSE_RETURNED" };
      }
      if (!entry.responseSeen && inDb) {
        return { ...entry, verdict: "COMMITTED_RESPONSE_LOST" };
      }
      if (entry.responseSeen && !inDb) {
        return { ...entry, verdict: "RESPONSE_WITHOUT_COMMIT" };
      }
      return { ...entry, verdict: "NOT_COMMITTED_NO_RESPONSE" };
    });

    const byArm = {};
    for (const entry of verdicts) {
      byArm[entry.arm] ??= {};
      byArm[entry.arm][entry.verdict] = (byArm[entry.arm][entry.verdict] ?? 0) + 1;
    }

    const latencies = verdicts
      .filter((entry) => entry.arm === "sequential" && entry.ms >= 0)
      .map((entry) => entry.ms)
      .sort((a, b) => a - b);
    const percentile = (p) =>
      latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;

    const sequentialLost = verdicts.filter(
      (entry) =>
        entry.arm === "sequential" && entry.verdict === "COMMITTED_RESPONSE_LOST",
    );

    const stage = resolveEvidenceStage();
    const evidenceDir = resolve(ROOT, "test-results", stage);
    mkdirSync(evidenceDir, { recursive: true });
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    const report = {
      schema_version: "elyra-mutation-response-probe/v1",
      generated_at: new Date().toISOString(),
      runtime: {
        next: pkg.dependencies.next,
        react: pkg.dependencies.react,
        node: process.version,
        base_url: BASE_URL,
      },
      operations: verdicts.length,
      by_arm: byArm,
      sequential_latency_ms: {
        p50: percentile(0.5),
        p95: percentile(0.95),
        max: latencies.at(-1) ?? 0,
      },
      sequential_committed_response_lost: sequentialLost.length,
      trace_markers: traces.length,
      traces,
      results: verdicts,
    };
    writeFileSync(
      resolve(evidenceDir, "mutation-response-probe.json"),
      JSON.stringify(report, null, 2) + "\n",
      "utf8",
    );

    console.log("");
    for (const [arm, counts] of Object.entries(byArm)) {
      console.log("  " + arm + ": " + JSON.stringify(counts));
    }
    console.log(
      "  latencia sequencial p50=" +
        report.sequential_latency_ms.p50 +
        "ms p95=" +
        report.sequential_latency_ms.p95 +
        "ms max=" +
        report.sequential_latency_ms.max +
        "ms",
    );
    console.log("  marcadores de fronteira capturados: " + traces.length);
    console.log("");

    if (sequentialLost.length > 0) {
      console.error(
        "MUTATION_PROBE=FAIL sequential_committed_response_lost=" +
          sequentialLost.length,
      );
      process.exitCode = 1;
    } else {
      console.log(
        "MUTATION_PROBE=PASS operations=" +
          verdicts.length +
          " sequential_committed_response_lost=0",
      );
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (userId) {
      await cleanupQaUser(admin, userId);
      await cleanupQaUser(admin, userId);
    }
    server.kill();
    await new Promise((done) => setTimeout(done, 1_000));
  }
}

await main();
