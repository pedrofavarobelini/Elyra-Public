
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STAMP_FILE = join("node_modules", ".elyra-lock-sha256");

export function lockHash(root) {
  return createHash("sha256").update(readFileSync(join(root, "package-lock.json"))).digest("hex");
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Dependencias diretas (prod + dev) que faltam ou divergem da versao travada. */
export function missingDirectDependencies(root) {
  const lock = readJson(join(root, "package-lock.json"));
  const packages = lock?.packages ?? {};
  const rootEntry = packages[""] ?? {};
  const names = [...Object.keys(rootEntry.dependencies ?? {}), ...Object.keys(rootEntry.devDependencies ?? {})];
  const problems = [];
  for (const name of names) {
    const locked = packages[`node_modules/${name}`];
    // Opcional de plataforma (ex.: binario de outro SO) pode faltar legitimamente.
    if (!locked || locked.optional) continue;
    const installed = readJson(join(root, "node_modules", name, "package.json"));
    if (!installed) problems.push(`${name} ausente`);
    else if (locked.version && installed.version !== locked.version) {
      problems.push(`${name} ${installed.version} (travado ${locked.version})`);
    }
  }
  return problems;
}

/**
 * `{ inSync: true }` ou `{ inSync: false, reason }`. Nunca instala nada.
 * A ordem vai do mais barato ao mais caro.
 */
export function dependencySyncStatus(root = process.cwd()) {
  if (!existsSync(join(root, "package-lock.json"))) return { inSync: false, reason: "package-lock.json ausente" };
  if (!existsSync(join(root, "node_modules"))) return { inSync: false, reason: "primeira instalacao (sem node_modules)" };
  const stampPath = join(root, STAMP_FILE);
  if (!existsSync(stampPath)) return { inSync: false, reason: "sem registro da ultima sincronizacao" };
  if (readFileSync(stampPath, "utf8").trim() !== lockHash(root)) {
    return { inSync: false, reason: "package-lock.json mudou desde a ultima sincronizacao" };
  }
  const problems = missingDirectDependencies(root);
  if (problems.length) return { inSync: false, reason: `dependencias fora do lockfile: ${problems.slice(0, 5).join(", ")}` };
  return { inSync: true };
}

/** Grava o hash depois de um `npm ci` bem-sucedido. */
export function recordSync(root = process.cwd()) {
  writeFileSync(join(root, STAMP_FILE), `${lockHash(root)}\n`);
}
