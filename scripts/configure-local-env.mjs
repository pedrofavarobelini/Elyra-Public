import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const cli = resolve(
  process.cwd(),
  "node_modules",
  "supabase",
  "dist",
  "supabase.js",
);
const result = spawnSync(process.execPath, [cli, "status", "-o", "env"], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
});

if (result.status !== 0) {
  console.error("LOCAL_ENV=BLOCKED reason=supabase_not_running");
  process.exit(result.status ?? 1);
}

const values = Object.fromEntries(
  result.stdout
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2].replace(/^"|"$/g, "")]),
);

for (const name of ["API_URL", "DB_URL", "SERVICE_ROLE_KEY"]) {
  if (!values[name]) {
    console.error(`LOCAL_ENV=BLOCKED reason=missing_${name.toLowerCase()}`);
    process.exit(1);
  }
}

const publishableKey = values.PUBLISHABLE_KEY ?? values.ANON_KEY;
if (!publishableKey) {
  console.error("LOCAL_ENV=BLOCKED reason=missing_publishable_key");
  process.exit(1);
}

/*
 * Este script gera as chaves do Supabase local — e SO elas.
 *
 * Ate 23/09/2026 ele escrevia o arquivo inteiro do zero. Quem tivesse somado
 * credenciais a mao (Brevo, Google OAuth, PedroCore, a senha da conta QA
 * canonica) perdia todas silenciosamente: o comando dizia `LOCAL_ENV=PASS` e o
 * `.env.local` voltava com seis linhas. Foi assim que, na vespera da
 * apresentacao, `npm run brevo:check` passou a reportar tudo AUSENTE e o login
 * Google ficou sem client id.
 *
 * Agora o arquivo existente e lido antes: as chaves gerenciadas aqui sao
 * reescritas com os valores do Supabase, e toda chave desconhecida e preservada
 * como estava. Um gerador que apaga o que nao sabe ler destroi configuracao.
 */
const MANAGED = new Map([
  ["ELYRA_RUNTIME_ENV", "qa"],
  ["SUPABASE_PROJECT_ID", "elyra-public-snapshot-local"],
  ["NEXT_PUBLIC_SUPABASE_URL", values.API_URL],
  ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", publishableKey],
  ["SUPABASE_SERVICE_ROLE_KEY", values.SERVICE_ROLE_KEY],
  ["SUPABASE_DB_URL", values.DB_URL],
]);

const target = resolve(process.cwd(), ".env.local");
const previous = existsSync(target) ? readFileSync(target, "utf8") : "";

const preserved = [];
for (const line of previous.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
  if (!match || MANAGED.has(match[1])) continue;
  preserved.push(trimmed);
}

const contents = [
  "# Gerado por npm run qa:env:local. Nao versionar.",
  "# As chaves do Supabase local sao reescritas a cada execucao;",
  "# qualquer outra chave presente no arquivo e preservada.",
  ...[...MANAGED].map(([name, value]) => `${name}=${value}`),
  ...(preserved.length ? ["", "# Preservadas da configuracao anterior."] : []),
  ...preserved,
  "",
].join("\n");

writeFileSync(target, contents, { encoding: "utf8", mode: 0o600 });
console.log(
  `LOCAL_ENV=PASS file=.env.local values=redacted managed=${MANAGED.size} preserved=${preserved.length}`,
);
