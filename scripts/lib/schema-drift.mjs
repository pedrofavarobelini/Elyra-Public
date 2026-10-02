

export const DEMO_DEV_COMMAND = "npm run demo -- -Dev";
const VERSION_RE = /^(\d{14})_.+\.sql$/;

/** Versoes (prefixo de 14 digitos) dos arquivos de `supabase/migrations`. */
export function repoVersionsFromFiles(fileNames) {
  const versions = [];
  for (const name of fileNames) {
    const match = VERSION_RE.exec(name);
    if (match) versions.push(match[1]);
  }
  return [...new Set(versions)].sort();
}

/** Versoes vindas do `psql -At` (uma por linha). Linhas nao numericas sao ignoradas. */
export function dbVersionsFromPsql(stdout) {
  return [
    ...new Set(
      String(stdout)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^\d{14}$/.test(line)),
    ),
  ].sort();
}

/**
 * @returns {{ status: "ALIGNED" | "BEHIND" | "AHEAD" | "DIVERGED" | "UNAVAILABLE",
 *   repo: number, database: number | null, pending: string[], unknown: string[] }}
 */
export function compareSchema(repoVersions, dbVersions) {
  const repo = [...new Set(repoVersions)].sort();
  if (dbVersions === null) {
    return { status: "UNAVAILABLE", repo: repo.length, database: null, pending: [], unknown: [] };
  }
  const db = new Set(dbVersions);
  const repoSet = new Set(repo);
  const pending = repo.filter((v) => !db.has(v));
  const unknown = [...db].filter((v) => !repoSet.has(v)).sort();
  let status = "ALIGNED";
  if (pending.length && unknown.length) status = "DIVERGED";
  else if (pending.length) status = "BEHIND";
  else if (unknown.length) status = "AHEAD";
  return { status, repo: repo.length, database: db.size, pending, unknown };
}

/**
 * Decide se o `npm run dev` pode seguir e o que imprimir. Sem dado pessoal,
 * sem URL, sem segredo: so contagens e versoes de migration.
 */
export function schemaVerdict(result) {
  const counts = `repo=${result.repo} database=${result.database ?? "unknown"}`;
  switch (result.status) {
    case "ALIGNED":
      return { exitCode: 0, lines: [`DATABASE_SCHEMA=ALIGNED ${counts}`] };
    case "BEHIND":
    case "DIVERGED":
      return {
        exitCode: 1,
        lines: [
          `DATABASE_SCHEMA_BEHIND_CODE ${counts}`,
          `pending=${result.pending.length} (${result.pending.join(", ")})`,
          ...(result.unknown.length
            ? [`database_only=${result.unknown.length} (${result.unknown.join(", ")}) — o banco tem migration que esta branch nao conhece`]
            : []),
          "O servidor NAO foi iniciado: telas novas quebrariam com \"Nao foi possivel carregar\".",
          `Aplique as pendentes sem apagar dados e suba em modo dev: ${DEMO_DEV_COMMAND}`,
        ],
      };
    case "AHEAD":
      return {
        exitCode: 0,
        lines: [
          `DATABASE_SCHEMA_AHEAD_OF_CODE ${counts} database_only=${result.unknown.join(", ")}`,
          "Aviso: o banco tem migration que esta branch nao conhece (troca de branch?). Seguindo.",
        ],
      };
    default:
      return {
        exitCode: 1,
        lines: [
          `DATABASE_SCHEMA=UNAVAILABLE ${counts}`,
          "Nao consegui ler o banco local (Supabase parado?). O servidor NAO foi iniciado.",
          `Suba tudo e aplique migrations: ${DEMO_DEV_COMMAND}`,
          "Para iniciar mesmo assim (sem banco), no PowerShell: $env:ELYRA_SKIP_SCHEMA_CHECK=\"1\"; npm run dev",
        ],
      };
  }
}
