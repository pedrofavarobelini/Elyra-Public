// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { dependencySyncStatus, recordSync } from "../scripts/lib/dependency-sync.mjs";



const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function project(deps: Record<string, string>, installed: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "elyra-deps-"));
  roots.push(root);
  const packages: Record<string, unknown> = { "": { dependencies: deps } };
  for (const [name, version] of Object.entries(deps)) packages[`node_modules/${name}`] = { version };
  writeFileSync(join(root, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  mkdirSync(join(root, "node_modules"));
  for (const [name, version] of Object.entries(installed)) {
    mkdirSync(join(root, "node_modules", name), { recursive: true });
    writeFileSync(join(root, "node_modules", name, "package.json"), JSON.stringify({ name, version }));
  }
  return root;
}

describe("demo: sincronia package-lock x node_modules", () => {
  it("estado A: lockfile inalterado e pacotes presentes -> nao reinstala", () => {
    const root = project({ next: "16.0.0", "maplibre-gl": "6.11.2" }, { next: "16.0.0", "maplibre-gl": "6.11.2" });
    recordSync(root);
    expect(dependencySyncStatus(root)).toEqual({ inSync: true });
  });

  it("estado B: git pull muda o lockfile (dependencia nova) -> npm ci", () => {
    const root = project({ next: "16.0.0" }, { next: "16.0.0" });
    recordSync(root);
    // O pull traz o maplibre-gl no lockfile; o next continua instalado.
    const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
    lock.packages[""].dependencies["maplibre-gl"] = "6.11.2";
    lock.packages["node_modules/maplibre-gl"] = { version: "6.11.2" };
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
    expect(dependencySyncStatus(root)).toMatchObject({ inSync: false, reason: expect.stringContaining("package-lock.json mudou") });
  });

  it("hash igual, mas pacote apagado ou em outra versao -> detecta", () => {
    const missing = project({ next: "16.0.0", "maplibre-gl": "6.11.2" }, { next: "16.0.0" });
    recordSync(missing);
    expect(dependencySyncStatus(missing)).toMatchObject({ inSync: false, reason: expect.stringContaining("maplibre-gl ausente") });
    const drift = project({ "maplibre-gl": "6.11.2" }, { "maplibre-gl": "6.10.0" });
    recordSync(drift);
    expect(dependencySyncStatus(drift).reason).toContain("maplibre-gl 6.10.0 (travado 6.11.2)");
  });

  it("primeira execucao e instalacao antiga sem registro -> npm ci", () => {
    const root = project({ next: "16.0.0" }, { next: "16.0.0" });
    expect(dependencySyncStatus(root)).toMatchObject({ inSync: false, reason: "sem registro da ultima sincronizacao" });
    rmSync(join(root, "node_modules"), { recursive: true });
    expect(dependencySyncStatus(root).reason).toContain("primeira instalacao");
  });

  it("dependencia opcional de plataforma ausente nao dispara reinstalacao", () => {
    const root = project({}, {});
    const lock = { lockfileVersion: 3, packages: { "": { dependencies: { fsevents: "2.3.3" } }, "node_modules/fsevents": { version: "2.3.3", optional: true } } };
    writeFileSync(join(root, "package-lock.json"), JSON.stringify(lock));
    recordSync(root);
    expect(dependencySyncStatus(root)).toEqual({ inSync: true });
  });
});

describe("demo: guardas de contrato", () => {
  const script = readFileSync("scripts/start-demo.ps1", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  it("start-demo.ps1 sincroniza por npm ci guiado pelo lockfile, nunca npm install", () => {
    expect(script).toContain("node scripts/check-dependencies.mjs");
    expect(script).toContain("npm ci");
    expect(script).toContain("--record");
    expect(script).not.toMatch(/npm install/);
    // Nunca mais a verificacao que so olhava o next.
    expect(script).not.toMatch(/if \(-not \(Test-Path "node_modules\/next"\)\)/);
  });

  it("estado C: o -Dev passa pelo npm run dev, entao o predev publica o worker do MapLibre", () => {
    expect(script).toMatch(/npm run dev -- --port \$Port/);
    expect(script).not.toMatch(/^\s*npx next dev/m);
    expect(pkg.scripts.predev).toContain("vendor-maplibre-worker.mjs");
    expect(pkg.scripts.prebuild).toContain("vendor-maplibre-worker.mjs");
  });
});
