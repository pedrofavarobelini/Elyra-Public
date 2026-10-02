#!/usr/bin/env node


import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** O modulo protegido, nas formas em que um import pode nomea-lo. */
const GUARDED = ["@/lib/qa/asr-quality", "lib/qa/asr-quality", "qa/asr-quality"];

/**
 * Quem pode importar, e por que cada um.
 *
 * Lista curta de proposito: cada entrada aqui e uma porta a mais para o numero
 * chegar perto de uma transcricao real.
 */
const ALLOWED = [
  // A propria implementacao e o que vive ao lado dela.
  "src/lib/qa/",
  // A tela de comparacao A/B — existe so sob o flag de QA.
  "src/components/asr-model-comparison",
  "src/app/qa/",
  // Testes e scripts nao sao produto.
  "tests/",
  "scripts/",
];

const SCAN_ROOTS = ["src", "tests", "scripts"];
const EXTENSIONS = [".ts", ".tsx", ".mjs", ".js"];

async function* walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      yield* walk(full);
    } else if (EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      yield full;
    }
  }
}

function isAllowed(path) {
  return ALLOWED.some((prefix) => path.startsWith(prefix));
}

const violations = [];
let importers = 0;

for (const root of SCAN_ROOTS) {
  for await (const file of walk(resolve(ROOT, root))) {
    const path = relative(ROOT, file).split("\\").join("/");
    const source = await readFile(file, "utf8");
    /*
      Casa `from "..."` e `import("...")`. Nao tenta ser um parser: um regex
      frouxo aqui erra para o lado seguro — acusa um import que nao existe em
      vez de deixar passar um que existe.
    */
    const hit = GUARDED.some((module) =>
      new RegExp(`(from|import\\()\\s*["'][^"']*${module.replace(/\//gu, "\\/")}["']`, "u").test(source),
    );
    if (!hit) continue;
    importers += 1;
    if (!isAllowed(path)) violations.push(path);
  }
}

for (const path of violations) {
  console.log(`!! ${path} importa o modulo de WER fora da arvore de QA`);
}

console.log(`importers=${importers} violations=${violations.length}`);
console.log(
  violations.length === 0
    ? "ASR_QUALITY_BOUNDARY=PASS"
    : "ASR_QUALITY_BOUNDARY=FAIL",
);
if (violations.length > 0) process.exitCode = 1;
