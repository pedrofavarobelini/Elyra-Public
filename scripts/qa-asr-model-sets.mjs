#!/usr/bin/env node
/**
 * O provisionamento e o runtime concordam sobre qual modelo e qual?
 *
 * ## O defeito que este gate existe para impedir
 *
 * Ao trocar o modelo padrao de `base` para `small`, eu renomeei os **rotulos**
 * das duas listas de arquivos em vez de trocar a associacao entre papel e
 * conteudo. O resultado passou em `node --check`, passou no typecheck e teria
 * passado em qualquer teste de comportamento:
 *
 * ```
 * onnx-community/whisper-small  default=true   79,7 MB  encoder=5862993336bf
 * onnx-community/whisper-base   default=false  251,8 MB encoder=a43a83f3c536
 * ```
 *
 * Cada modelo com os arquivos do outro. O `--verify` so acusaria depois de
 * baixar 331 MB errados, e acusaria "digest divergente" — que parece corrupcao
 * de download e manda a investigacao para o lugar errado.
 *
 * Nada automatizado pegou. Um `console.log` casual pegou. Sorte nao e controle.
 *
 * ## Por que um gate em node, e nao um teste do Vitest
 *
 * `asr-assets.mjs` vive fora de `src/`, e o runner do Vitest recusa carrega-lo
 * — estatico ou dinamico. Aqui ele e carregado pelo mesmo node que o executa em
 * `npm run asr:assets`, entao o que este gate le e o provisionamento **real**, e
 * nao uma copia que poderia divergir.
 *
 * `MODEL_CHANGE = BEHAVIOR_CHANGE`: uma troca de default que embaralha digests
 * muda o comportamento **e** mente sobre qual modelo produziu o texto.
 */

import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ASR_MODEL_SETS, RUNTIME_FILES, VAD_FILE } from "./asr-assets.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
}

/**
 * As constantes do runtime, lidas da fonte.
 *
 * `browser-runtime.ts` e TypeScript e nao pode ser importado por node cru. Ler
 * e extrair por expressao regular e feio, e e melhor do que a alternativa:
 * redigitar aqui os valores que se quer conferir, o que provaria apenas que
 * este arquivo concorda consigo mesmo.
 */
const runtimeSource = await readFile(
  resolve(ROOT, "src/lib/speech/browser-runtime.ts"),
  "utf8",
);

/*
  A anotacao de tipo e opcional no padrao de proposito.

  A primeira versao exigia `export const NOME = "valor"`, e parou de ler no dia
  em que as constantes ganharam `: AsrModelId`. O gate falhou dizendo
  "padrao do runtime (null)" - alto e claro, que e o comportamento certo para um
  leitor que perdeu o alvo. Um `?? "desconhecido"` teria transformado isso em
  aprovacao silenciosa.
*/
function constant(name) {
  const match = runtimeSource.match(
    /*
      `String.raw`: dentro de um template literal comum, `\s` e `\w` sao
      colapsados pelo JavaScript antes de o RegExp ver, e o padrao vira
      `(?::s*w+)?` - que nao casa com nada e devolve `null` em silencio.
    */
    new RegExp(String.raw`export const ${name}(?::\s*\w+)? = "([^"]+)"`, "u"),
  );
  return match?.[1] ?? null;
}

const runtimeDefault = constant("ASR_MODEL_ID");
const runtimeComparator = constant("ASR_QA_COMPARATOR_MODEL_ID");

const bytesBlock = runtimeSource.match(
  /ASR_MODEL_BYTES: Readonly<Record<AsrModelId, number>> = \{([\s\S]*?)\};/u,
);
const runtimeBytes = {};
for (const line of (bytesBlock?.[1] ?? "").split("\n")) {
  const entry = line.match(/"([^"]+)":\s*([\d_]+)/u);
  if (entry) runtimeBytes[entry[1]] = Number(entry[2].replace(/_/gu, ""));
}

// --- 0. o leitor encontrou o que precisava ler ----------------------------
check(runtimeDefault !== null, "nao foi possivel ler ASR_MODEL_ID de browser-runtime.ts");
check(
  runtimeComparator !== null,
  "nao foi possivel ler ASR_QA_COMPARATOR_MODEL_ID de browser-runtime.ts",
);
check(
  Object.keys(runtimeBytes).length === 2,
  `ASR_MODEL_BYTES: esperadas 2 entradas, lidas ${Object.keys(runtimeBytes).length}`,
);

// --- 1. um unico padrao, e ele e o do runtime ------------------------------
const defaults = ASR_MODEL_SETS.filter((set) => set.default);
check(
  defaults.length === 1,
  `esperado exatamente 1 modelo padrao, encontrado ${defaults.length}`,
);
check(
  defaults[0]?.id === runtimeDefault,
  `padrao do provisionamento (${defaults[0]?.id}) != padrao do runtime (${runtimeDefault})`,
);

// --- 2. o comparador existe e nao e o padrao -------------------------------
const comparator = ASR_MODEL_SETS.find((set) => set.id === runtimeComparator);
check(comparator !== undefined, `comparador ${runtimeComparator} ausente no provisionamento`);
check(comparator?.default === false, "o comparador de QA nao pode ser o padrao");

// --- 3. os bytes batem: e aqui que a inversao aparece ----------------------
for (const set of ASR_MODEL_SETS) {
  check(
    runtimeBytes[set.id] === set.bytes,
    `${set.id}: runtime anuncia ${runtimeBytes[set.id]} bytes, provisionamento soma ${set.bytes}`,
  );
}

// --- 4. nenhum peso ONNX compartilhado entre modelos -----------------------
const onnxDigests = (set) =>
  set.files.filter((file) => file.file.endsWith(".onnx")).map((file) => file.sha256);
const [first, second] = ASR_MODEL_SETS;
const shared = onnxDigests(first).filter((sha) => onnxDigests(second).includes(sha));
check(shared.length === 0, `dois modelos compartilham peso ONNX: ${shared.join(", ")}`);

/*
  O tokenizador, ao contrario, deve ser o mesmo nos dois. A comparacao exige
  parametros iguais e modelo diferente; um tokenizador diferente de cada lado
  mediria duas coisas ao mesmo tempo.
*/
const tokenizer = (set) => set.files.find((file) => file.file === "tokenizer.json")?.sha256;
check(
  tokenizer(first) === tokenizer(second),
  "os dois modelos precisam compartilhar o mesmo tokenizador",
);

// --- 5. nenhuma revisao movel ---------------------------------------------
for (const set of ASR_MODEL_SETS) {
  check(
    /^[0-9a-f]{40}$/u.test(set.revision),
    `${set.id}: revisao "${set.revision}" nao e um commit fixado`,
  );
}

// --- 6. a estimativa de download segue o modelo padrao --------------------

const downloadDeclaration = runtimeSource.match(
  /export const ASR_DOWNLOAD_BYTES = ([^;]+);/u,
);
const downloadExpression = (downloadDeclaration?.[1] ?? "").trim();

check(
  downloadDeclaration !== null,
  "ASR_DOWNLOAD_BYTES nao encontrada em browser-runtime.ts",
);
check(
  downloadExpression.includes("ASR_MODEL_BYTES[ASR_MODEL_ID]"),
  `ASR_DOWNLOAD_BYTES nao deriva do modelo padrao: "${downloadExpression}"`,
);
check(
  downloadExpression.includes("VAD_MODEL_BYTES"),
  `ASR_DOWNLOAD_BYTES nao inclui o VAD: "${downloadExpression}"`,
);
check(
  !/\d/u.test(downloadExpression),
  `ASR_DOWNLOAD_BYTES contem numero literal: "${downloadExpression}"`,
);

/*
  E o tamanho do VAD e conferido contra o provisionamento, que e a fonte
  independente - ele vem junto do sha256 que o download verifica.
*/
const vadConstant = runtimeSource.match(/export const VAD_MODEL_BYTES = ([\d_]+);/u);
const vadBytes = Number((vadConstant?.[1] ?? "0").replace(/_/gu, ""));
check(
  vadBytes === VAD_FILE.bytes,
  `VAD_MODEL_BYTES=${vadBytes} != provisionamento ${VAD_FILE.bytes}`,
);

const defaultSet = ASR_MODEL_SETS.find((set) => set.default);
console.log(
  `ASR_DOWNLOAD_BYTES_EFETIVO=${(defaultSet?.bytes ?? 0) + VAD_FILE.bytes}` +
    ` (~${Math.round(((defaultSet?.bytes ?? 0) + VAD_FILE.bytes) / 1e6)} MB)`,
);

// --- 7. mesmo conjunto de arquivos dos dois lados --------------------------
const names = (set) => set.files.map((file) => file.file).sort().join(",");
check(names(first) === names(second), "os dois conjuntos declaram arquivos diferentes");
check(first.files.length === 7, `esperado 7 arquivos por conjunto, encontrado ${first.files.length}`);

// --- 8. manifesto WASM = pacote efetivamente instalado -------------------

const ortDist = resolve(ROOT, "node_modules/onnxruntime-web/dist");
const distributedRuntimeFiles = (await readdir(ortDist))
  .filter((file) => /^ort-wasm-simd-threaded(?:\.[^.]+)?\.(?:mjs|wasm)$/u.test(file))
  .sort();
const declaredRuntimeFiles = RUNTIME_FILES.map((item) => item.from.split("/").at(-1)).sort();

check(
  new Set(declaredRuntimeFiles).size === declaredRuntimeFiles.length,
  "RUNTIME_FILES contem entradas duplicadas",
);
check(
  declaredRuntimeFiles.join(",") === distributedRuntimeFiles.join(","),
  `RUNTIME_FILES (${declaredRuntimeFiles.join(",")}) != pacote instalado (${distributedRuntimeFiles.join(",")})`,
);

console.log(`ASR_RUNTIME_FILES=${distributedRuntimeFiles.join(",")}`);

for (const set of ASR_MODEL_SETS) {
  console.log(
    `${set.id.padEnd(32)} default=${String(set.default).padEnd(5)}` +
      ` rev=${set.revision.slice(0, 12)} bytes=${(set.bytes / 1e6).toFixed(1)}MB`,
  );
}
console.log(`ASR_DEFAULT_MODEL=${runtimeDefault}`);
console.log(`ASR_QA_COMPARATOR_MODEL=${runtimeComparator}`);

for (const failure of failures) console.log(`!! ${failure}`);
console.log(failures.length === 0 ? "ASR_MODEL_SETS=PASS" : "ASR_MODEL_SETS=FAIL");
if (failures.length > 0) process.exitCode = 1;
