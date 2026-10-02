// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";


describe("demo: Rede de Apoio pronta sem comando manual", () => {
  it("start-demo.ps1 prepara a fixture [DEMO] depois das migrations e antes de subir o app", () => {
    const script = readFileSync("scripts/start-demo.ps1", "utf8");
    const ensure = script.indexOf("node scripts/import-support-network.mjs --ensure-demo");
    expect(ensure).toBeGreaterThan(script.indexOf('Step "Migrations"'));
    expect(ensure).toBeLessThan(script.indexOf('Step "Porta $Port"'));
  });

  it("--ensure-demo recusa qualquer alvo que nao seja o Supabase local, mesmo com confirmacao remota", () => {
    const result = spawnSync(process.execPath, ["scripts/import-support-network.mjs", "--ensure-demo"], {
      encoding: "utf8",
      env: {
        ...process.env,
        NEXT_PUBLIC_SUPABASE_URL: "https://producao.example.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "nao-usada",
        ELYRA_OPS_CONFIRM_REMOTE: "true",
      },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("SUPPORT_DEMO=REFUSED reason=alvo_nao_local");
  });

  it("--ensure-demo reimporta quando o CSV versionado da fixture mudou (ex.: unidades [DEMO] de Orlandia)", () => {
    const script = readFileSync("scripts/import-support-network.mjs", "utf8");
    const body = script.slice(script.indexOf("async function ensureDemo()"), script.indexOf("async function main()"));
    expect(body).toContain("const changed = fixture ? fixture.source_sha256 !== csvSha : false;");
    expect(body).toContain("const stale = !fixture || ageDays > 30 || changed;");
    // QA 27/09 (2a rodada): o mesmo CSV ja importado e depois substituido volta a ser o ativo,
    // em vez de a demo dizer "atualizada" com a fixture antiga no ar.
    expect(body).toContain('if (active?.source_sha256 !== csvSha)');
    expect(body).toContain("support_network_rollback_snapshot");
    const csv = readFileSync("scripts/fixtures/support-network/qa-fixture-support-network.csv", "utf8");
    const orlandia = csv.split("\n").filter((line) => line.includes(";353470;Orlândia;SP;"));
    expect(orlandia).toHaveLength(3);
    // Sinteticas: marcador [DEMO], CNES da faixa ficticia 99000xx, telefone 0000.
    for (const line of orlandia) expect(line).toMatch(/^99000\d\d;\[DEMO\] .*\(16\) 0000-00\d\d/);
  });

  it("-Dev liga a previa editorial (REVIEW) antes do npm run dev; o modo de producao nao", () => {
    const script = readFileSync("scripts/start-demo.ps1", "utf8");
    const dev = script.slice(script.indexOf("if ($Dev) {"), script.indexOf("npm run dev -- --port $Port"));
    expect(dev).toContain('$env:ELYRA_SUPPORT_CONTENT_PREVIEW = "review"');
    const beforeDev = script.slice(0, script.indexOf("if ($Dev) {"));
    expect(beforeDev).not.toContain("ELYRA_SUPPORT_CONTENT_PREVIEW");
  });
});
