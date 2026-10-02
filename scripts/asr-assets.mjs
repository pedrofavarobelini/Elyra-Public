#!/usr/bin/env node
/**
 * Vendoriza os ativos do reconhecimento de fala local para `public/`.
 *
 * ## Por que existe
 *
 * Mesma razao de `vision-assets.mjs`, e com uma consequencia a mais.
 *
 * O caminho padrao do `@huggingface/transformers` busca o modelo no Hub da
 * Hugging Face **em tempo de sessao**. Aqui isso nao e so um host de terceiro em
 * `connect-src`: seria um terceiro sabendo quando cada pessoa liga o microfone.
 * A CSP deste repositorio ja recusaria a chamada - `connect-src` e `'self'` mais
 * o Supabase -, entao a alternativa nao e "menos privado", e "nao funciona".
 *
 * Os arquivos sao servidos por `'self'`, e o runtime e configurado com
 * `allowRemoteModels = false`: se algum caminho tentar buscar remoto, ele falha
 * em vez de vazar.
 *
 * ## Por que digest fixado
 *
 * `MODEL_CHANGE = BEHAVIOR_CHANGE`. O arquivo do modelo determina o texto
 * produzido; troca-lo em silencio mudaria toda transcricao futura sem uma linha
 * de codigo mudar, e nenhum teste apontaria.
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");


export const ASR_MODEL_ID = "onnx-community/whisper-small";

/**
 * Revisao **fixada no commit**, e nao em `main`.
 *
 * `main` e um ponteiro movel: o mesmo comando, rodado em dois dias diferentes,
 * podia trazer arquivos diferentes. Os digests por arquivo ja recusariam a
 * troca — mas recusariam com "digest divergente", que parece corrupcao de
 * download e nao "o repositorio mudou". Fixar o commit faz a identidade do
 * modelo ser uma coisa so, legivel, e faz a mensagem de erro dizer a verdade.
 */
export const ASR_MODEL_REVISION = "36050c46d777d46dc4b5f43f6d90574fc38f8732";

/**
 * Comparador de QA — **nao** e o modelo padrao.
 *
 * Foi o padrao ate 2026-09-10, quando perdeu o A/B fisico. Continua aqui, e
 * provisionavel sob demanda, porque a proxima decisao de modelo vai precisar de
 * uma linha de base contra a qual medir — e reconstruir a linha de base depois
 * custa mais do que mante-la.
 *
 * Provisionado so com `--comparator`. Um `npm run asr:assets` limpo baixa o
 * modelo do produto, e nao os dois: quem so quer rodar a Elyra nao deve pagar
 * 79,7 MB por um instrumento de laboratorio.
 */
export const ASR_QA_COMPARATOR_MODEL_ID = "onnx-community/whisper-base";
export const ASR_QA_COMPARATOR_REVISION = "1846881b6b3a3024392c1eea3ad983695bc23925";

/**
 * Arquivos do `base`, o comparador de QA. Digest fixado no commit `1846881b6b3a`.
 *
 * O layout de diretorio e o que o `transformers.js` espera em
 * `localModelPath`: `<localModelPath>/<org>/<repo>/...`.
 */
const BASE_MODEL_FILES = [
  {
    file: "onnx/encoder_model_quantized.onnx",
    sha256: "5862993336bf33acd23736071aae2b32261d3b1b2f37780194460d4ef974dd46",
    bytes: 23201314,
  },
  {
    file: "onnx/decoder_model_merged_quantized.onnx",
    sha256: "fa3ef9902734ce5ae6f9ef2bdb2ba9a6c4b5785b09f4f420ce036573dc9d090b",
    bytes: 53693315,
  },
  { file: "config.json", sha256: "f4d0608f7d918166da7edb3e188de5ef1bfe70d9802e785d271fd88111e9cf4b", bytes: 2243 },
  { file: "generation_config.json", sha256: "61070cf8de25b1e9256e8e102ded49d8d24a8369ed36ef84fdf21549e68125a0", bytes: 3832 },
  { file: "preprocessor_config.json", sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d", bytes: 339 },
  { file: "tokenizer.json", sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566", bytes: 2480466 },
  { file: "tokenizer_config.json", sha256: "2e036e4dbacfdeb7242c7d4ec4149f4a16e86026048f94d1637e3a8ee9c6a573", bytes: 282682 },
];

/**
 * Arquivos do `small`, o modelo do produto. Digest fixado no commit `36050c46d777`.
 *
 * Mesmo layout e mesmos nomes do `base` — e por isso o `dtype: q8` do
 * `transformers.js` resolve os dois sem mudar uma linha de runtime. `tokenizer`
 * e `preprocessor_config` tem digest **identico** nos dois: e o mesmo
 * tokenizador Whisper, o que e exatamente o que a comparacao precisa (parametros
 * iguais, modelo diferente).
 */
const SMALL_MODEL_FILES = [
  {
    file: "onnx/encoder_model_quantized.onnx",
    sha256: "a43a83f3c5361cd591cfa7c36f14b43cf7cb22f47a415cc14a8d557be800fa92",
    bytes: 92326160,
  },
  {
    file: "onnx/decoder_model_merged_quantized.onnx",
    sha256: "ec07c3cbb64172c39791e26ee870a65ac22b458c36722bfe2776b3dbf741e0c9",
    bytes: 156750845,
  },
  { file: "config.json", sha256: "457854d452f17661e197d74aee12b8e74fb75ba30ebfaa7426d0d61ea1e08a18", bytes: 2227 },
  { file: "generation_config.json", sha256: "f538b28220c6a6d6f1af1458d4141cacb4ef4963df3de98a19490440c412ddf0", bytes: 3893 },
  { file: "preprocessor_config.json", sha256: "a6a76d28c93edb273669eb9e0b0636a2bddbb1272c3261e47b7ca6dfdbac1b8d", bytes: 339 },
  { file: "tokenizer.json", sha256: "27fc476bfe7f17299480be2273fc0608e4d5a99aba2ab5dec5374b4482d1a566", bytes: 2480466 },
  { file: "tokenizer_config.json", sha256: "2a4c4281cf9f51ac6ccc406fdc711a087afe6530f671fa7b80953edc498275ce", bytes: 282683 },
];

/** Total em bytes de um conjunto — a tela precisa dizer o tamanho ANTES do download. */
function totalBytes(files) {
  return files.reduce((sum, item) => sum + item.bytes, 0);
}

/**
 * Os dois conjuntos, com identidade completa.
 *
 * `default: true` marca o modelo que as sessoes normais usam. Ele e um so, e o
 * teste reprova se algum dia for mais de um — "qual modelo transcreveu isto"
 * precisa ter resposta unica.
 */
export const ASR_MODEL_SETS = [
  {
    id: ASR_MODEL_ID,
    revision: ASR_MODEL_REVISION,
    files: SMALL_MODEL_FILES,
    bytes: totalBytes(SMALL_MODEL_FILES),
    default: true,
  },
  {
    id: ASR_QA_COMPARATOR_MODEL_ID,
    revision: ASR_QA_COMPARATOR_REVISION,
    files: BASE_MODEL_FILES,
    bytes: totalBytes(BASE_MODEL_FILES),
    default: false,
  },
];

/**
 * Runtime, copiado do pacote npm ja fixado no lockfile.
 *
 * `transformers.web.min.js` e o bundle de navegador; o `.wasm` e o kernel do
 * ONNX Runtime com SIMD e threads. Nenhum dos dois vem de CDN.
 */
export const RUNTIME_FILES = [
  /*
    Somente os kernels WASM. O JavaScript do `transformers.js` vem do bundler do
    Next por `import()` dinamico - vendoriza-lo como arquivo solto nao funciona:
    o `dist` traz `import "onnxruntime-web/webgpu"`, um especificador nu que o
    navegador nao resolve. Descoberto ao montar o banco de medicao.

    O pacote travado distribui dois builds: o WASM puro e o build JSEP usado
    pela integracao WebGPU/WebNN. A escolha entre eles e definida pelo bundle do
    ONNX Runtime; por isso os dois pares realmente publicados sao
    provisionados. O manifesto nao antecipa variantes de outras versoes do
    pacote: `asyncify` e `jspi` nao existem no onnxruntime-web travado.
  */
  ...[
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.wasm",
    "ort-wasm-simd-threaded.jsep.mjs",
    "ort-wasm-simd-threaded.jsep.wasm",
  ].map((file) => ({
    from: `node_modules/onnxruntime-web/dist/${file}`,
    to: `runtime/${file}`,
  })),
];

/**
 * VAD, provisionado junto: ele e pre-requisito do ASR, e nao um extra.
 *
 * Sem VAD o motor local **nao reconhece** - a trava recusa em vez de mandar o
 * audio direto ao Whisper. Provisionar os dois no mesmo passo evita um ambiente
 * onde o ASR existe e a camada que o protege nao.
 */
export const VAD_FILE = {
  file: "silero_vad.onnx",
  url: "https://raw.githubusercontent.com/snakers4/silero-vad/master/src/silero_vad/data/silero_vad.onnx",
  sha256: "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3",
  bytes: 2327524,
};

const OUT = resolve(ROOT, "public/asr");

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function vendorRuntime() {
  for (const item of RUNTIME_FILES) {
    const from = resolve(ROOT, item.from);
    if (!existsSync(from)) {
      throw new Error(
        `${item.from} nao existe. Rode \`npm ci\` antes de \`asr:assets\`.`,
      );
    }
    const to = resolve(OUT, item.to);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to);
    console.log(`runtime  ok  ${item.to}`);
  }
}

async function vendorModel(set, { verifyOnly }) {
  let problems = 0;
  const digests = {};
  const hfBase = `https://huggingface.co/${set.id}/resolve/${set.revision}`;

  for (const model of set.files) {
    const target = resolve(OUT, "models", ...set.id.split("/"), model.file);

    if (existsSync(target)) {
      const existing = await readFile(target);
      const actual = digest(existing);
      digests[model.file] = actual;
      if (!model.sha256 || actual === model.sha256) {
        console.log(`model    ok  ${model.file}`);
        continue;
      }
      console.log(`model    !!  ${model.file} digest divergente`);
      problems += 1;
      if (verifyOnly) continue;
    } else if (verifyOnly) {
      console.log(`model    --  ${model.file} ausente`);
      problems += 1;
      continue;
    }

    if (verifyOnly) continue;

    const response = await fetch(`${hfBase}/${model.file}`);
    if (!response.ok) {
      throw new Error(`Falha ao baixar ${model.file}: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const actual = digest(buffer);

    if (model.sha256 && actual !== model.sha256) {
      // Modelo diferente do fixado muda o texto de toda transcricao futura.
      throw new Error(
        `Digest divergente para ${model.file}:\n  esperado ${model.sha256}\n  obtido   ${actual}`,
      );
    }

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
    digests[model.file] = actual;
    console.log(`model    ok  ${model.file} (${buffer.byteLength} bytes)`);
  }

  return { problems, digests };
}

async function main() {
  const verifyOnly = process.argv.includes("--verify");
  const printDigests = process.argv.includes("--print-digests");
  /*
    O comparador de QA nao vem por padrao.

    Sao 79,7 MB que so servem para a tela de comparacao. Baixa-los em todo
    `npm run asr:assets` faria todo ambiente pagar por um instrumento de
    laboratorio que quase nenhum ambiente vai abrir.

    `--ab-candidate` continua aceito porque o nome antigo pode estar em algum
    script ou anotacao de rodada anterior, e falhar em silencio por causa de um
    flag renomeado seria pior do que aceitar os dois.
  */
  const includeComparator =
    process.argv.includes("--comparator") ||
    process.argv.includes("--ab-candidate") ||
    process.argv.includes("--all");
  const sets = ASR_MODEL_SETS.filter((set) => set.default || includeComparator);

  if (!verifyOnly) await vendorRuntime();
  else {
    for (const item of RUNTIME_FILES) {
      if (!existsSync(resolve(OUT, item.to))) {
        console.log(`runtime  --  ${item.to} ausente`);
      }
    }
  }

  let problems = 0;
  const digests = {};
  for (const set of sets) {
    console.log(`
-- ${set.id} @ ${set.revision.slice(0, 12)} (${(set.bytes / 1e6).toFixed(1)} MB) --`);
    const result = await vendorModel(set, { verifyOnly });
    problems += result.problems;
    for (const [file, value] of Object.entries(result.digests)) {
      digests[`${set.id}/${file}`] = value;
    }
  }

  // VAD
  const vadTarget = resolve(OUT, "vad", VAD_FILE.file);
  let vadProblem = 0;
  if (existsSync(vadTarget)) {
    const actual = digest(await readFile(vadTarget));
    if (actual === VAD_FILE.sha256) console.log(`vad      ok  ${VAD_FILE.file}`);
    else {
      console.log(`vad      !!  ${VAD_FILE.file} digest divergente`);
      vadProblem = 1;
    }
  } else if (verifyOnly) {
    console.log(`vad      --  ${VAD_FILE.file} ausente`);
    vadProblem = 1;
  } else {
    const response = await fetch(VAD_FILE.url);
    if (!response.ok) throw new Error(`Falha ao baixar VAD: HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const actual = digest(buffer);
    if (actual !== VAD_FILE.sha256) {
      throw new Error(`Digest divergente para o VAD:
  esperado ${VAD_FILE.sha256}
  obtido   ${actual}`);
    }
    await mkdir(dirname(vadTarget), { recursive: true });
    await writeFile(vadTarget, buffer);
    console.log(`vad      ok  ${VAD_FILE.file} (${buffer.byteLength} bytes)`);
  }

  if (printDigests) {
    console.log("\n--- digests observados ---");
    for (const [file, value] of Object.entries(digests)) {
      console.log(`${value}  ${file}`);
    }
  }

  const missingRuntime = RUNTIME_FILES.filter(
    (item) => !existsSync(resolve(OUT, item.to)),
  ).length;

  console.log(
    problems === 0 && missingRuntime === 0 && vadProblem === 0
      ? "ASR_ASSETS=PRESENT"
      : `ASR_ASSETS=INCOMPLETE problems=${problems + missingRuntime + vadProblem}`,
  );
  console.log(`ASR_DEFAULT_MODEL=${ASR_MODEL_ID}`);
  console.log(
    `ASR_QA_COMPARATOR_ASSETS=${
      includeComparator ? (problems === 0 ? "PRESENT" : "INCOMPLETE") : "NOT_REQUESTED"
    }`,
  );
}

/*
  So roda quando **executado**, e nao quando importado.

  As identidades de modelo, revisoes e digests deste arquivo precisam ser
  conferidas por teste — e um modulo que provisiona 250 MB ao ser importado nao
  pode ser importado por teste nenhum.
*/
const executedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (executedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
