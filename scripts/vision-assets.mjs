#!/usr/bin/env node


import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");


const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
];

/**
 * Modelos, com digest fixado.
 *
 * O digest nao e paranoia: o arquivo define a **aritmetica** de todo sinal
 * visual. Um modelo trocado em silencio mudaria o significado de series ja
 * gravadas sem mudar uma linha de codigo, e nenhum teste apontaria.
 */
const MODELS = [
  {
    file: "face_landmarker.task",
    url: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
    sha256: "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
    bytes: 3758596,
  },
  {
    file: "pose_landmarker_lite.task",
    url: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
    bytes: 5777746,
  },
];

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function vendorWasm() {
  const from = resolve(ROOT, "node_modules/@mediapipe/tasks-vision/wasm");
  const to = resolve(ROOT, "public/vision/wasm");
  if (!existsSync(from)) {
    throw new Error(
      "@mediapipe/tasks-vision nao esta instalado. Rode `npm ci` antes.",
    );
  }
  await mkdir(to, { recursive: true });
  for (const file of WASM_FILES) {
    await copyFile(resolve(from, file), resolve(to, file));
    console.log(`wasm     ok  ${file}`);
  }
}

async function vendorModels() {
  const to = resolve(ROOT, "public/vision/models");
  await mkdir(to, { recursive: true });

  for (const model of MODELS) {
    const target = resolve(to, model.file);

    if (existsSync(target)) {
      const existing = await readFile(target);
      if (digest(existing) === model.sha256) {
        console.log(`model    ok  ${model.file} (ja presente)`);
        continue;
      }
      console.log(`model    !!  ${model.file} com digest divergente, rebaixando`);
    }

    const response = await fetch(model.url);
    if (!response.ok) {
      throw new Error(`Falha ao baixar ${model.file}: HTTP ${response.status}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());

    const actual = digest(buffer);
    if (actual !== model.sha256) {
      // Nao gravar. Um modelo diferente do fixado muda a aritmetica de todo
      // sinal visual, e falhar alto e a unica resposta honesta.
      throw new Error(
        `Digest divergente para ${model.file}:\n  esperado ${model.sha256}\n  obtido   ${actual}`,
      );
    }
    if (buffer.byteLength !== model.bytes) {
      throw new Error(`Tamanho divergente para ${model.file}.`);
    }

    await writeFile(target, buffer);
    console.log(`model    ok  ${model.file} (${buffer.byteLength} bytes)`);
  }
}

async function main() {
  const verifyOnly = process.argv.includes("--verify");

  if (verifyOnly) {
    let missing = 0;
    for (const file of WASM_FILES) {
      const path = resolve(ROOT, "public/vision/wasm", file);
      if (!existsSync(path)) {
        console.log(`wasm     -- ${file} ausente`);
        missing += 1;
      }
    }
    for (const model of MODELS) {
      const path = resolve(ROOT, "public/vision/models", model.file);
      if (!existsSync(path)) {
        console.log(`model    -- ${model.file} ausente`);
        missing += 1;
        continue;
      }
      const actual = digest(await readFile(path));
      if (actual !== model.sha256) {
        console.log(`model    !! ${model.file} digest divergente`);
        missing += 1;
      }
    }
    console.log(
      missing === 0
        ? "VISION_ASSETS=PRESENT"
        : `VISION_ASSETS=INCOMPLETE missing_or_invalid=${missing}`,
    );
    return;
  }

  await vendorWasm();
  await vendorModels();
  console.log("VISION_ASSETS=PRESENT");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
