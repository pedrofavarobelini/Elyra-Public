#!/usr/bin/env node
/**
 * `predev`: impede `npm run dev` de subir com o banco local atras do codigo
 * (L-309). Somente leitura: um `select version` em
 * `supabase_migrations.schema_migrations`. Nunca aplica, reseta nem apaga.
 *
 * Alvo: so o Supabase local. Se `.env.local` apontar para outro host, a
 * checagem e pulada (nunca consultamos banco remoto daqui).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import {
  compareSchema,
  dbVersionsFromPsql,
  repoVersionsFromFiles,
  schemaVerdict,
} from "./lib/schema-drift.mjs";

const CONTAINER = "supabase_db_elyra-public-snapshot-local";
const SQL = "select version from supabase_migrations.schema_migrations";

try {
  try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}
} catch {
  // sem .env.local: a propria app vai reclamar; aqui seguimos com o local padrao
}

if (process.env.ELYRA_SKIP_SCHEMA_CHECK === "1") {
  console.warn("DATABASE_SCHEMA=SKIPPED reason=ELYRA_SKIP_SCHEMA_CHECK");
  process.exit(0);
}

const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (publicUrl) {
  let host = "";
  try {
    host = new URL(publicUrl).hostname;
  } catch {
    host = "invalid";
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    console.warn("DATABASE_SCHEMA=SKIPPED reason=supabase_not_local");
    process.exit(0);
  }
}

function readDbVersions() {
  const attempts = [
    ["docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-At", "-c", SQL]],
    [
      "psql",
      ["-h", "127.0.0.1", "-p", "54382", "-U", "postgres", "-d", "postgres", "-At", "-c", SQL],
    ],
  ];
  for (const [cmd, args] of attempts) {
    const run = spawnSync(cmd, args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
      env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres", PGCONNECT_TIMEOUT: "5" },
    });
    if (run.status === 0) return dbVersionsFromPsql(run.stdout);
  }
  return null;
}

const files = readdirSync(resolve(process.cwd(), "supabase", "migrations"));
const verdict = schemaVerdict(compareSchema(repoVersionsFromFiles(files), readDbVersions()));
const print = verdict.exitCode === 0 ? console.log : console.error;
for (const line of verdict.lines) print(line);
process.exit(verdict.exitCode);
