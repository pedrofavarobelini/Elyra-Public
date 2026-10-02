// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  compareSchema,
  dbVersionsFromPsql,
  repoVersionsFromFiles,
  schemaVerdict,
} from "../scripts/lib/schema-drift.mjs";

const v = (n: number) => `2026092${String(n).padStart(2, "0")}000000`.slice(0, 14);
const repo49 = Array.from({ length: 49 }, (_, i) => `${String(20260000000000 + i)}`);

describe("schema drift guard (L-309)", () => {
  it("le versoes dos arquivos e ignora o que nao e migration", () => {
    expect(
      repoVersionsFromFiles([
        "20260926130000_stage29_pro7r_realtime.sql",
        "20260926100000_stage29_pro6_scheduling.sql",
        "README.md",
        "seed.sql",
      ]),
    ).toEqual(["20260926100000", "20260926130000"]);
  });

  it("le versoes do psql -At ignorando ruido", () => {
    expect(dbVersionsFromPsql("20260926100000\r\n\nWARNING x\n20260926100000\n")).toEqual([
      "20260926100000",
    ]);
  });

  it("BEHIND: repo=49 database=44 para o dev com o comando da demo", () => {
    const result = compareSchema(repo49, repo49.slice(0, 44));
    expect(result.status).toBe("BEHIND");
    expect(result.pending).toHaveLength(5);
    const verdict = schemaVerdict(result);
    expect(verdict.exitCode).toBe(1);
    expect(verdict.lines[0]).toBe("DATABASE_SCHEMA_BEHIND_CODE repo=49 database=44");
    expect(verdict.lines.join("\n")).toContain("npm run demo -- -Dev");
  });

  it("ALIGNED: segue sem ruido", () => {
    const verdict = schemaVerdict(compareSchema(repo49, [...repo49].reverse()));
    expect(verdict).toEqual({ exitCode: 0, lines: ["DATABASE_SCHEMA=ALIGNED repo=49 database=49"] });
  });

  it("UNAVAILABLE: para com instrucao, nunca finge alinhado", () => {
    const result = compareSchema(repo49, null);
    expect(result.status).toBe("UNAVAILABLE");
    const verdict = schemaVerdict(result);
    expect(verdict.exitCode).toBe(1);
    expect(verdict.lines[0]).toBe("DATABASE_SCHEMA=UNAVAILABLE repo=49 database=unknown");
  });

  it("AHEAD: banco com migration desconhecida so avisa", () => {
    const verdict = schemaVerdict(compareSchema(repo49.slice(0, 48), repo49));
    expect(verdict.exitCode).toBe(0);
    expect(verdict.lines[0]).toMatch(/^DATABASE_SCHEMA_AHEAD_OF_CODE repo=48 database=49/);
  });

  it("DIVERGED (mesma contagem, versoes diferentes) conta como atras: contagem sozinha engana", () => {
    const db = [...repo49.slice(0, 48), v(99)];
    const result = compareSchema(repo49, db);
    expect(result.status).toBe("DIVERGED");
    expect(schemaVerdict(result).exitCode).toBe(1);
  });

  it("nao imprime URL, chave nem dado pessoal", () => {
    const text = [
      ...schemaVerdict(compareSchema(repo49, repo49.slice(0, 44))).lines,
      ...schemaVerdict(compareSchema(repo49, null)).lines,
    ].join("\n");
    expect(text).not.toMatch(/https?:\/\/|eyJ|service_role|@/);
  });
});
