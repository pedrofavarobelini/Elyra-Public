#!/usr/bin/env node
/**
 * Usado pelo `npm run demo` (start-demo.ps1). Nao instala nada.
 *
 *   node scripts/check-dependencies.mjs           # 0 = sincronizado · 10 = precisa de npm ci
 *   node scripts/check-dependencies.mjs --record  # depois de um npm ci bem-sucedido
 *
 * Saida: uma linha `DEPENDENCIES=IN_SYNC` ou `DEPENDENCIES=OUT_OF_SYNC reason=...`.
 */
import { dependencySyncStatus, missingDirectDependencies, recordSync } from "./lib/dependency-sync.mjs";

if (process.argv.includes("--record")) {
  const problems = missingDirectDependencies(process.cwd());
  if (problems.length) {
    console.log(`DEPENDENCIES=OUT_OF_SYNC reason=${problems.slice(0, 5).join(", ")}`);
    process.exit(10);
  }
  recordSync();
  console.log("DEPENDENCIES=RECORDED");
  process.exit(0);
}

const status = dependencySyncStatus();
if (status.inSync) {
  console.log("DEPENDENCIES=IN_SYNC");
  process.exit(0);
}
console.log(`DEPENDENCIES=OUT_OF_SYNC reason=${status.reason}`);
process.exit(10);
