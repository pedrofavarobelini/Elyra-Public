/**
 * Benchmark do ASR local, em Chromium de verdade.
 *
 * Responde a pergunta que a pesquisa nao responde: **este modelo, neste
 * aparelho, acompanha uma sessao real?** O numero que importa e o
 * `REALTIME_FACTOR` - tempo de processamento dividido pela duracao do audio.
 *
 * Tambem registra todas as requisicoes de rede feitas durante a inferencia. Um
 * ASR local que fizesse uma unica chamada externa nao seria local, e essa e a
 * propriedade que este script confere alem de medir.
 *
 * ## Auto-contido
 *
 * A pagina de medicao e o bundle sao **gerados aqui** e apagados no fim. A
 * primeira versao deixava os dois versionados em `public/`, o que criava
 * superficie de producao para um instrumento de diagnostico - e o bundle
 * envelhecia em silencio quando a versao do pacote mudava.
 *
 * Nao faz parte do gate. E instrumento de decisao, e a evidencia vive no dossie.
 */

import { chromium } from "@playwright/test";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const OUT = resolve(process.cwd(), "public/asr/bench");
const ROOT = resolve(process.cwd(), "public");

/**
 * Servidor estatico proprio, e nao o `next start`.
 *
 * O Next fotografa o conteudo de `public/` na subida: arquivos criados depois
 * voltam 404 ate o servidor reiniciar, e o banco de medicao **gera** os proprios
 * arquivos. Um servidor de arquivos de sete linhas remove essa dependencia
 * inteira - e a medicao passa a nao depender de nada estar de pe.
 */
function serveStatic() {
  const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".onnx": "application/octet-stream",
    ".task": "application/octet-stream",
  };
  const server = createServer((request, response) => {
    const path = normalize(decodeURIComponent((request.url ?? "/").split("?")[0]));
    // `normalize` ja resolve `..`; a checagem de prefixo abaixo e o que impede
    // sair da raiz, e ela basta.
    const file = join(ROOT, path);
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(response);
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () =>
      resolveServer({ server, port: server.address().port }),
    );
  });
}

const EXTERNAL_ASR_HOSTS = [
  "huggingface.co",
  "hf.co",
  "cdn-lfs",
  "googleapis.com",
  "openai.com",
  "azure.com",
  "deepgram.com",
  "assemblyai.com",
];

const PAGE = `<!doctype html>
<meta charset="utf-8" /><title>ASR bench</title>
<body><pre id="out">iniciando</pre>
<script type="module" src="/asr/bench/bench.js"></script></body>`;

const SCRIPT = `
const out = document.getElementById("out");
const log = (m) => { out.textContent += "\\n" + m; };

async function loadOrt() {
  const ort = await import("/asr/bench/ort.mjs");
  ort.env.wasm.wasmPaths = "/asr/runtime/";
  ort.env.wasm.numThreads = 1;
  return ort;
}

window.__benchVad = async (seconds) => {
  const ort = await loadOrt();
  const t0 = performance.now();
  const buffer = await (await fetch("/asr/vad/silero_vad.onnx")).arrayBuffer();
  const session = await ort.InferenceSession.create(buffer);
  const loadMs = performance.now() - t0;

  const SR = 16000, WIN = 512, CONTEXT = 64;
  const audio = new Float32Array(SR * seconds);
  for (let i = 0; i < audio.length; i += 1) audio[i] = (Math.sin(i / 40) * 0.2);

  let state = new Float32Array(2 * 128);
  let context = new Float32Array(CONTEXT);
  const t1 = performance.now();
  let windows = 0;
  for (let o = 0; o + WIN <= audio.length; o += WIN) {
    const modelInput = new Float32Array(CONTEXT + WIN);
    modelInput.set(context, 0);
    modelInput.set(audio.subarray(o, o + WIN), CONTEXT);
    const r = await session.run({
      input: new ort.Tensor("float32", modelInput, [1, modelInput.length]),
      state: new ort.Tensor("float32", state, [2, 1, 128]),
      sr: new ort.Tensor("int64", BigInt64Array.from([BigInt(SR)]), []),
    });
    state = Float32Array.from(r.stateN.data);
    context = modelInput.slice(-CONTEXT);
    windows += 1;
  }
  const processMs = performance.now() - t1;
  log("vad ok");
  return { loadMs: Math.round(loadMs), processMs: Math.round(processMs), windows,
           audioMs: seconds * 1000, rtf: +(processMs / (seconds * 1000)).toFixed(4) };
};

window.__benchAsr = async (seconds) => {
  const { env, pipeline } = await import("/asr/bench/transformers.mjs");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = "/asr/models/";
  env.backends.onnx.wasm.wasmPaths = "/asr/runtime/";
  env.backends.onnx.wasm.numThreads = 1;

  const t0 = performance.now();
  const asr = await pipeline("automatic-speech-recognition", "onnx-community/whisper-base", {
    dtype: { encoder_model: "q8", decoder_model_merged: "q8" }, device: "wasm",
  });
  const loadMs = performance.now() - t0;

  const SR = 16000;
  const audio = new Float32Array(SR * seconds);
  for (let i = 0; i < audio.length; i += 1) audio[i] = 0.2 * Math.sin((2 * Math.PI * 200 * i) / SR);

  const t1 = performance.now();
  const r = await asr(audio, { language: "portuguese", task: "transcribe", chunk_length_s: 30, return_timestamps: false });
  const processMs = performance.now() - t1;
  log("asr ok");
  return { loadMs: Math.round(loadMs), processMs: Math.round(processMs),
           audioMs: seconds * 1000, rtf: +(processMs / (seconds * 1000)).toFixed(4),
           text: (r?.text ?? "").trim().slice(0, 80) };
};

window.__ready = true;
log("pronto");
`;

async function build() {
  const esbuild = await import("esbuild");
  await mkdir(OUT, { recursive: true });
  await writeFile(resolve(OUT, "index.html"), PAGE);
  await writeFile(resolve(OUT, "bench.js"), SCRIPT);

  for (const [contents, outfile] of [
    ['export * from "onnxruntime-web";', "ort.mjs"],
    ['export { env, pipeline } from "@huggingface/transformers";', "transformers.mjs"],
  ]) {
    await esbuild.build({
      stdin: { contents, resolveDir: process.cwd(), sourcefile: "b.mjs", loader: "js" },
      bundle: true,
      format: "esm",
      platform: "browser",
      outfile: resolve(OUT, outfile),
      external: ["onnxruntime-node", "sharp"],
      logLevel: "error",
    });
  }
}

async function main() {
  if (!existsSync(resolve(process.cwd(), "public/asr/vad/silero_vad.onnx"))) {
    console.error("ASR_BENCH=BLOCKED reason=assets_missing");
    console.error("Rode `npm run asr:assets` antes.");
    process.exit(1);
  }

  await build();
  const { server, port } = await serveStatic();
  const base = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch();
  const page = await browser.newPage();
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));
  page.on("console", (message) => {
    if (message.type() === "error") console.error("  console:", message.text().slice(0, 160));
  });

  await page.goto(`${base}/asr/bench/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, { timeout: 30_000 });

  try {
    const vad = await page.evaluate((s) => window.__benchVad(s), 30);
    console.log(
      `VAD    load=${String(vad.loadMs).padStart(6)}ms  proc=${String(vad.processMs).padStart(6)}ms` +
        `  janelas=${vad.windows}  RTF=${vad.rtf}`,
    );

    const asr = await page.evaluate((s) => window.__benchAsr(s), 30);
    console.log(
      `ASR    load=${String(asr.loadMs).padStart(6)}ms  proc=${String(asr.processMs).padStart(6)}ms` +
        `  RTF=${asr.rtf}  texto=${JSON.stringify(asr.text)}`,
    );

    const combined = +(vad.rtf + asr.rtf).toFixed(4);
    console.log(`PIPELINE_RTF_30S=${combined}`);
  } catch (error) {
    console.error("medicao falhou:", error?.message ?? error);
  }

  const external = requests.filter((url) =>
    EXTERNAL_ASR_HOSTS.some((host) => url.includes(host)),
  );
  console.log(`REQUESTS_TOTAL=${requests.length}`);
  console.log(`EXTERNAL_ASR_REQUESTS=${external.length}`);
  for (const url of external) console.log(`  !! ${url}`);
  console.log(external.length === 0 ? "ASR_NETWORK=LOCAL_ONLY" : "ASR_NETWORK=LEAKED");

  await browser.close();
  server.close();
  // O instrumento nao deixa superficie em producao.
  await rm(OUT, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
