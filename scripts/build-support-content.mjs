/**
 * SUP-3 (ADR-0033) — gera os modulos dos Conteudos de Apoio a partir de
 * `content/support/*.md`, validando cada arquivo.
 *
 *   node scripts/build-support-content.mjs          # valida e escreve
 *   node scripts/build-support-content.mjs --check  # valida e so compara (CI/teste)
 *
 * Sai com erro (e nao escreve nada) se:
 * - qualquer arquivo tem frontmatter malformado ou chave desconhecida;
 * - um PUBLISHED viola a politica (fonte fora da allowlist, sem revisor
 *   humano, sem data de revisao, HTML no corpo, termo clinico, ...);
 * - dois arquivos tem o mesmo slug.
 *
 * Nao acessa a internet: a saude dos links e o `qa:sup3:links`, separado.
 *
 * Saida:
 * - `corpus.generated.ts`: PUBLISHED (+ lista de ARCHIVED). Pode ir para o
 *   cliente e para o shell offline.
 * - `review.generated.ts`: REVIEW. Importado SO pelo servidor, e so exibido
 *   no modo de pre-visualizacao editorial (fora de producao).
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildCorpus, parseContentFile } from "../src/lib/support-content/content-model.ts";
import { isReviewOverdue } from "../src/lib/support-content/policy.ts";

const CONTENT_DIR = join("content", "support");
const OUT_DIR = join("src", "lib", "support-content");
const check = process.argv.includes("--check");

const files = readdirSync(CONTENT_DIR)
  .filter((name) => name.endsWith(".md") && name !== "README.md")
  .sort();
const results = files.map((name) => parseContentFile(name, readFileSync(join(CONTENT_DIR, name), "utf8")));
const corpus = buildCorpus(results);

for (const result of results) {
  for (const warning of result.warnings) console.log(`WARN ${result.file} ${warning.code} ${warning.detail}`);
}
if (corpus.errors.length) {
  for (const error of corpus.errors) console.error(`ERROR ${error.code} ${error.detail}`);
  console.error(`SUPPORT_CONTENT=FAIL errors=${corpus.errors.length}`);
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
for (const item of corpus.items) {
  if (isReviewOverdue(item.reviewedAt, today)) console.log(`REVIEW_OVERDUE ${item.slug} reviewed_at=${item.reviewedAt}`);
}

const review = results.filter((result) => result.status === "REVIEW" && result.item).map((result) => result.item);
const header = (what) =>
  `// GERADO por scripts/build-support-content.mjs a partir de content/support/*.md.\n// Nao editar a mao: edite o Markdown e rode o gerador. ${what}\n`;
const outputs = {
  "corpus.generated.ts":
    `${header("So PUBLISHED/ARCHIVED.")}import type { ContentItem } from "./content-model";\n\n` +
    `export const PUBLISHED_CONTENT: readonly ContentItem[] = ${JSON.stringify(corpus.items, null, 2)};\n\n` +
    `export const ARCHIVED_CONTENT: readonly { slug: string; title: string }[] = ${JSON.stringify(corpus.archived, null, 2)};\n`,
  "review.generated.ts":
    `${header("So REVIEW: importar apenas no servidor.")}import "server-only";\n\nimport type { ContentItem } from "./content-model";\n\n` +
    `export const REVIEW_CONTENT: readonly ContentItem[] = ${JSON.stringify(review, null, 2)};\n`,
};

let drift = false;
for (const [name, text] of Object.entries(outputs)) {
  const path = join(OUT_DIR, name);
  let current = "";
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = "";
  }
  if (current === text) continue;
  if (check) {
    drift = true;
    console.error(`DRIFT ${path} desatualizado: rode node scripts/build-support-content.mjs`);
  } else writeFileSync(path, text);
}
if (drift) process.exit(1);
console.log(
  `SUPPORT_CONTENT=PASS files=${files.length} published=${corpus.items.length} review=${review.length} archived=${corpus.archived.length}${check ? " mode=check" : ""}`,
);
