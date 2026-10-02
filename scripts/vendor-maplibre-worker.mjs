/**
 * SUP-2 (ADR-0032) — publica o worker do MapLibre 6 na propria origem.
 *
 * O MapLibre 6 roda o worker como modulo carregado de URL; com bundler, a URL
 * precisa ser dada (`setWorkerUrl`). Servindo de `/vendor/maplibre/<versao>/`
 * a CSP fica em `worker-src 'self'` — sem CDN de terceiro e sem abrir `blob:`
 * para isso. O worker importa `maplibre-gl-shared.mjs` por caminho relativo,
 * entao os dois arquivos vao juntos. Versao no caminho = cache seguro.
 *
 * Gerado (fora do Git): roda no `prebuild` e no `predev`.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const pkgDir = join("node_modules", "maplibre-gl");
const { version } = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) throw new Error(`MAPLIBRE_WORKER=FAIL versao inesperada ${version}`);

const root = join("public", "vendor", "maplibre");
const target = join(root, version);
mkdirSync(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(pkgDir, "dist", file), join(target, file));
}
// Versoes antigas saem: nada de worker velho servido depois de um upgrade.
if (existsSync(root)) {
  for (const entry of readdirSync(root)) if (entry !== version) rmSync(join(root, entry), { recursive: true, force: true });
}
console.log(`MAPLIBRE_WORKER=READY version=${version}`);
