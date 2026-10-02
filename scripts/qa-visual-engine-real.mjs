#!/usr/bin/env node
/**
 * QA do motor visual REAL (L-397): o CI normal nao tem os ativos do MediaPipe
 * (gitignored, baixados a parte), entao nenhum E2E exercitava `detectForVideo`.
 *
 * Este gate:
 *   1. garante os ativos (`vision:assets`, digest sha256 conferido);
 *   2. roda `tests/e2e/visual-engine-real.spec.ts` com camera falsa do Chromium,
 *      rosto + corpo reais, medindo responsividade e o encerramento da sessao.
 *
 * Sem ativos (sem rede, digest divergente): `VISUAL_ENGINE_REAL=SKIPPED reason=...`
 * com codigo 0 e motivo explicito. Nunca PASS falso. O build normal nao depende
 * disto.
 */
import { execFileSync, spawnSync } from "node:child_process";

function run(args, env = {}) {
  return spawnSync(process.execPath, args, { stdio: "inherit", env: { ...process.env, ...env } });
}

let assets = "";
try {
  assets = execFileSync(process.execPath, ["scripts/vision-assets.mjs"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
} catch (error) {
  const reason = String(error?.stderr ?? error?.message ?? "").split("\n")[0].slice(0, 160) || "download_falhou";
  console.log(`VISUAL_ENGINE_REAL=SKIPPED reason=ativos_indisponiveis (${reason})`);
  process.exit(0);
}
if (!/VISION_ASSETS=PRESENT/.test(assets)) {
  console.log("VISUAL_ENGINE_REAL=SKIPPED reason=ativos_incompletos");
  process.exit(0);
}

const project = process.env.QA_VISUAL_PROJECT ?? "desktop";
const result = run(
  ["node_modules/@playwright/test/cli.js", "test", "tests/e2e/visual-engine-real.spec.ts", `--project=${project}`, "--reporter=line"],
  { ELYRA_VISUAL_ENGINE_REAL: "1" },
);
console.log(result.status === 0 ? "VISUAL_ENGINE_REAL=PASS" : "VISUAL_ENGINE_REAL=FAIL");
process.exit(result.status ?? 1);
