/**
 * SUP-1 — importador de snapshot da Rede de Apoio (ADR-0031).
 *
 *   npm run support:network:import -- --file <csv> --source cnes_download \
 *        --reference-date 2026-08-01 --mapping <json> [--types <csv>] \
 *        [--delimiter ";"] [--encoding utf8|latin1] [--no-activate] [--max-drop-ratio 0.2]
 *        [--municipalities <csv>] [--types-columns COD,NOME] [--municipalities-columns COD,NOME]
 *   npm run support:network:import -- --dry-run --file <csv> --reference-date AAAA-MM-DD --mapping <json> \
 *        [--types <csv>] [--municipalities <csv>] [--focus-municipality 353470]
 *   npm run support:network:import -- --qa-fixture [--reference-date AAAA-MM-DD] [--show-fixtures on|off]
 *   npm run support:network:import -- --status
 *   npm run support:network:import -- --rollback <snapshot-id>
 *   npm run support:network:import -- --activate <snapshot-id> [--max-drop-ratio 0.2]
 *   npm run support:network:import -- --show-fixtures on|off
 *   npm run support:network:import -- --ensure-demo   # so local; usado pelo npm run demo
 *
 * Arquivo externo e NAO CONFIAVEL. O importador:
 * - le so o caminho local passado (nunca baixa nada, nunca segue URL do arquivo);
 * - recusa ZIP (extraia o CSV antes: sem descompressao, sem zip bomb/path traversal);
 * - exige MAPEAMENTO explicito para fonte real (nenhuma coluna e adivinhada);
 * - calcula SHA-256; mesma fonte + competencia + hash = NO_OP (idempotente);
 * - grava em snapshot `staging`, sela conferindo contagens e ativa atomicamente;
 * - qualquer falha remove o staging: nada parcial fica publicado;
 * - loga contagens e motivos, nunca o conteudo de uma linha.
 *
 * Fonte real (`cnes_*`) so passa com licenca VERIFIED e interruptor ligado no
 * banco (`support_network_settings`); hoje LICENSE_STATUS = UNRESOLVED.
 *
 * `--dry-run` le e valida o arquivo inteiro SEM banco: nada e gravado, nenhuma
 * credencial e usada e o interruptor de licenca nao e consultado (nao ha
 * snapshot). Imprime o relatorio agregado (sem conteudo de linha).
 *
 * Saidas: 0 ok/no-op · 1 arquivo/mapeamento/validacao · 2 ambiente recusado · 3 importacao real desabilitada.
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";

import { applyZeroPad, IMPORT_POLICY, MAPPING_RULES_KEY } from "../src/lib/support-network/cnes-record.ts";
import { ImportFailure, runImportPipeline } from "../src/lib/support-network/import-pipeline.ts";
import { parseCsvStream } from "../src/lib/support-network/csv-stream.ts";

try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const FIXTURE_DIR = "scripts/fixtures/support-network";
const REAL_SOURCES = ["cnes_download", "cnes_api"];

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}
function flag(name) {
  return process.argv.includes(`--${name}`);
}
function log(message) {
  console.log(`SUPPORT_IMPORT ${message}`);
}
function fail(code, message) {
  console.error(`SUPPORT_IMPORT=FAIL ${message}`);
  process.exit(code);
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail(2, "reason=credenciais_ausentes");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host) && process.env.ELYRA_OPS_CONFIRM_REMOTE !== "true") {
    fail(2, `reason=alvo_remoto_sem_confirmacao host=${host}`);
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function sha256Of(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Node 22: TextDecoder fatal lanca ERR_ENCODING_INVALID_ENCODED_DATA ("not valid for encoding"). */
function isEncodingError(error) {
  return error instanceof TypeError && (error.code === "ERR_ENCODING_INVALID_ENCODED_DATA" || /decode|encoding/i.test(String(error.message)));
}

/** Pedacos de texto decodificados em streaming; utf8 invalido falha (fatal). */
async function* decodedChunks(path, encoding) {
  const decoder = new TextDecoder(encoding === "latin1" ? "latin1" : "utf-8", { fatal: encoding !== "latin1" });
  for await (const chunk of createReadStream(path, { highWaterMark: 1 << 20 })) {
    yield decoder.decode(chunk, { stream: true });
  }
  const tail = decoder.decode();
  if (tail) yield tail;
}

/**
 * Tabela auxiliar oficial (codigo -> nome). Colunas pelo NOME do cabecalho
 * (`--types-columns COD,NOME`); sem a opcao, as duas primeiras colunas.
 * Coluna pedida e ausente = falha (nada e adivinhado).
 */
async function readLookup(path, delimiter, encoding, columns, { pattern, pad, keyLength }) {
  const names = new Map();
  let positions = null;
  for await (const { fields } of parseCsvStream(decodedChunks(path, encoding), delimiter)) {
    if (positions === null) {
      const header = fields.map((value) => value.trim().replace(/^\uFEFF/, ""));
      if (columns) {
        const [codeName, nameName] = columns.split(",").map((value) => value.trim());
        positions = [header.indexOf(codeName), header.indexOf(nameName)];
        if (positions.some((position) => position < 0)) fail(1, `reason=tabela_auxiliar_sem_coluna colunas=${columns}`);
      } else positions = [0, 1];
      continue;
    }
    let code = fields[positions[0]]?.trim();
    const name = fields[positions[1]]?.trim();
    code = applyZeroPad(code ?? null, pad) ?? "";
    if (keyLength && /^[0-9]+$/.test(code) && code.length > keyLength) code = code.slice(0, keyLength);
    if (code && name && pattern.test(code) && name.length <= 200) names.set(code, name);
  }
  return names;
}

/** Relatorio agregado do dry-run: contagens, nunca conteudo. */
function printDryRun({ report, failure, sha, bytes, referenceDate, schemaVersion, focus }) {
  log(
    `DRY_RUN=${failure ? "FAIL" : "PASS"}${failure ? ` failure=${failure}` : ""} sha256=${sha} bytes=${bytes} ` +
      `reference_date=${referenceDate} schema_version=${schemaVersion}`,
  );
  if (!report) return;
  log(
    `DRY_RUN_REPORT rows_total=${report.recordCount} out_of_scope=${report.skippedCount} ` +
      `out_of_scope_by=${JSON.stringify(report.skippedByReason)} in_scope=${report.recordCount - report.skippedCount} ` +
      `accepted=${report.acceptedCount} rejected=${report.rejectedCount} rejection_reasons=${JSON.stringify(report.rejectedByReason)} ` +
      `unknown_types=${JSON.stringify(report.unknownTypes)} accepted_by_type=${JSON.stringify(report.acceptedByType)} ` +
      `missing_coordinates=${report.missingCoordinates} missing_phones=${report.missingPhones} duplicate_cnes=${report.duplicateCnes} ` +
      `warnings=${JSON.stringify(report.warnings)}`,
  );
  if (focus) log(`DRY_RUN_FOCUS municipality=${focus.code} ${JSON.stringify(focus.counts)}`);
}

function checkFile(path) {
  if (!path) fail(1, "uso: --file <csv>");
  const absolute = resolve(path);
  if (/\.(zip|gz|7z|rar|tar)$/i.test(absolute)) fail(1, "reason=arquivo_compactado (extraia o CSV oficial antes; o importador nao descompacta)");
  let stat;
  try {
    stat = statSync(absolute);
  } catch {
    fail(1, "reason=arquivo_inexistente");
  }
  if (!stat.isFile()) fail(1, "reason=nao_e_arquivo_regular");
  if (stat.size === 0) fail(1, "reason=arquivo_vazio");
  if (stat.size > IMPORT_POLICY.maxFileBytes) fail(1, `reason=arquivo_grande_demais bytes=${stat.size}`);
  return { absolute, bytes: stat.size };
}

async function status(admin) {
  const [{ data: settings }, { data: snapshots }] = await Promise.all([
    admin.from("support_network_settings").select("license_status,real_import_enabled,fixtures_visible").single(),
    admin
      .from("support_network_snapshots")
      .select("id,source,source_reference_date,status,accepted_count,rejected_count,imported_at,schema_version")
      .order("imported_at", { ascending: false })
      .limit(8),
  ]);
  log(`SETTINGS=${JSON.stringify(settings)}`);
  log(`SNAPSHOTS=${JSON.stringify(snapshots ?? [])}`);
}

async function dryRun() {
  const referenceDate = arg("reference-date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate ?? "")) fail(1, "--reference-date AAAA-MM-DD");
  if (!arg("mapping")) fail(1, "--mapping <json> e obrigatorio");
  const delimiter = arg("delimiter") ?? ";";
  const encoding = arg("encoding") ?? "utf8";
  const { absolute, bytes } = checkFile(arg("file"));
  const mapping = JSON.parse(readFileSync(resolve(arg("mapping")), "utf8"));
  const lookups = await loadLookups(mapping, delimiter, encoding);
  const sha = await sha256Of(absolute);
  const schemaVersion = `mapped-${createHash("sha256").update(JSON.stringify(mapping)).digest("hex").slice(0, 12)}`;
  const focusCode = arg("focus-municipality");
  const focus = focusCode ? { code: focusCode, counts: { accepted: 0, by_type: {}, with_coordinates: 0, with_phone: 0, with_name: 0 } } : null;
  let report = null;
  let failure = null;
  try {
    report = await runImportPipeline({
      chunks: decodedChunks(absolute, encoding),
      delimiter,
      mapping,
      ...lookups,
      onBatch: async ({ facilities }) => {
        if (!focus) return;
        for (const facility of facilities) {
          if (facility.municipality_code !== focus.code) continue;
          const counts = focus.counts;
          counts.accepted += 1;
          counts.by_type[facility.official_type_code] = (counts.by_type[facility.official_type_code] ?? 0) + 1;
          if (facility.coordinate_status === "valid") counts.with_coordinates += 1;
          if (facility.phone_digits) counts.with_phone += 1;
          if (facility.municipality_name) counts.with_name += 1;
        }
      },
    });
  } catch (error) {
    if (!(error instanceof ImportFailure)) {
      if (isEncodingError(error)) fail(1, "DRY_RUN=FAIL ENCODING_INVALID (use --encoding latin1 se o arquivo oficial nao for UTF-8)");
      throw error;
    }
    failure = `${error.code} ${error.detail}`;
    report = error.report;
  }
  printDryRun({ report, failure, sha, bytes, referenceDate, schemaVersion, focus });
  if (failure) process.exit(1);
}

/** Tabelas auxiliares oficiais; o zero-pad do tipo vale tambem para a chave da tabela. */
async function loadLookups(mapping, delimiter, encoding) {
  const typePad = mapping?.[MAPPING_RULES_KEY]?.zeroPad?.official_type_code;
  const typeNames = arg("types")
    ? await readLookup(checkFile(arg("types")).absolute, delimiter, encoding, arg("types-columns"), { pattern: /^[0-9A-Za-z]{1,10}$/, pad: typePad })
    : undefined;
  const municipalityNames = arg("municipalities")
    ? await readLookup(checkFile(arg("municipalities")).absolute, delimiter, encoding, arg("municipalities-columns"), { pattern: /^[0-9]{6}$/, keyLength: 6 })
    : undefined;
  return { typeNames, municipalityNames };
}


async function ensureDemo() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // tratado abaixo
  }
  if (!["127.0.0.1", "localhost"].includes(host)) fail(2, `SUPPORT_DEMO=REFUSED reason=alvo_nao_local host=${host || "desconhecido"}`);
  const admin = adminClient();
  const [{ data: settings }, { data: real }, { data: fixture }] = await Promise.all([
    admin.from("support_network_settings").select("real_import_enabled,fixtures_visible").single(),
    admin.from("support_network_snapshots").select("id").eq("status", "active").neq("source", "qa_fixture").limit(1),
    admin.from("support_network_snapshots").select("id,source_reference_date,source_sha256").eq("status", "active").eq("source", "qa_fixture").maybeSingle(),
  ]);
  if (settings?.real_import_enabled && (real ?? []).length > 0) {
    log("SUPPORT_DEMO=SKIPPED reason=snapshot_real_ativo");
    return;
  }
  const ageDays = fixture ? (Date.now() - Date.parse(`${fixture.source_reference_date}T00:00:00Z`)) / 86_400_000 : Infinity;

  const csvSha = await sha256Of(resolve(`${FIXTURE_DIR}/qa-fixture-support-network.csv`));
  const changed = fixture ? fixture.source_sha256 !== csvSha : false;
  const stale = !fixture || ageDays > 30 || changed;
  if (stale) {
    const { execFileSync } = await import("node:child_process");
    let output = "";
    try {
      output = execFileSync(process.execPath, [process.argv[1], "--qa-fixture"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      // Sem stack trace: o motivo detalhado ja foi para o stderr do filho.
    }
    if (!/SUPPORT_IMPORT=PASS/.test(output)) fail(1, "SUPPORT_DEMO=FAIL reason=importacao_da_fixture");
    // Mesmo CSV ja importado hoje e depois substituido (NO_OP=IDEMPOTENT) nao volta a ser ativo
    // sozinho: sem isto o banco ficava com a fixture antiga e a demo dizia "atualizada".
    const { data: active } = await admin
      .from("support_network_snapshots").select("source_sha256").eq("status", "active").eq("source", "qa_fixture").maybeSingle();
    if (active?.source_sha256 !== csvSha) {
      const { data: same } = await admin
        .from("support_network_snapshots").select("id,status").eq("source", "qa_fixture").eq("source_sha256", csvSha)
        .in("status", ["inactive", "superseded"]).order("imported_at", { ascending: false }).limit(1).maybeSingle();
      if (!same) fail(1, "SUPPORT_DEMO=FAIL reason=fixture_atual_sem_snapshot");
      const { error } = same.status === "inactive"
        ? await admin.rpc("support_network_activate_snapshot", { p_snapshot_id: same.id, p_max_drop_ratio: 1 })
        : await admin.rpc("support_network_rollback_snapshot", { p_snapshot_id: same.id });
      if (error) fail(1, `SUPPORT_DEMO=FAIL reason=ativacao ${error.message}`);
    }
  }
  if (!settings?.fixtures_visible || stale) {
    const { error } = await admin.from("support_network_settings").update({ fixtures_visible: true }).eq("singleton", true);
    if (error) fail(1, `SUPPORT_DEMO=FAIL settings=${error.code}`);
  }
  log(`SUPPORT_DEMO=READY fixture=${stale ? (changed ? "atualizada" : "importada") : "existente"} visible=true`);
}

async function main() {
  if (flag("dry-run")) return dryRun();
  if (flag("ensure-demo")) return ensureDemo();
  const admin = adminClient();

  if (flag("status")) return status(admin);

  const showFixtures = arg("show-fixtures");
  if (showFixtures && !["on", "off"].includes(showFixtures)) fail(1, "--show-fixtures on|off");

  if (arg("rollback")) {
    const { data, error } = await admin.rpc("support_network_rollback_snapshot", { p_snapshot_id: arg("rollback") });
    if (error) fail(1, `rollback=${error.message}`);
    log(`ROLLBACK=PASS reativado=${arg("rollback")} desativado=${data ?? "nenhum"}`);
    return;
  }

  if (arg("activate")) {
    // Ativa um snapshot selado e `inactive` (importado com --no-activate) depois de conferir o REPORT.
    const { data, error } = await admin.rpc("support_network_activate_snapshot", {
      p_snapshot_id: arg("activate"),
      p_max_drop_ratio: Number(arg("max-drop-ratio") ?? "0.2"),
    });
    if (error) fail(1, `ativacao=${error.message}`);
    log(`ACTIVATED snapshot=${arg("activate")} previous=${data ?? "nenhum"}`);
    return;
  }

  if (showFixtures && !flag("qa-fixture") && !arg("file")) {
    const { error } = await admin.from("support_network_settings").update({ fixtures_visible: showFixtures === "on" }).eq("singleton", true);
    if (error) fail(1, `settings=${error.code}`);
    log(`FIXTURES_VISIBLE=${showFixtures === "on"}`);
    return;
  }

  const qaFixture = flag("qa-fixture");
  const source = qaFixture ? "qa_fixture" : arg("source");
  if (!["cnes_download", "cnes_api", "qa_fixture"].includes(source ?? "")) fail(1, "--source cnes_download|cnes_api ou --qa-fixture");
  const today = new Date().toISOString().slice(0, 10);
  const referenceDate = arg("reference-date") ?? (qaFixture ? today : undefined);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate ?? "")) fail(1, "--reference-date AAAA-MM-DD (competencia publicada pela fonte)");
  const filePath = qaFixture ? `${FIXTURE_DIR}/qa-fixture-support-network.csv` : arg("file");
  const mappingPath = qaFixture ? `${FIXTURE_DIR}/qa-fixture-mapping.json` : arg("mapping");
  if (!mappingPath) fail(1, "--mapping <json> e obrigatorio para fonte real (os cabecalhos oficiais nao sao adivinhados)");
  const delimiter = arg("delimiter") ?? ";";
  const encoding = arg("encoding") ?? "utf8";
  if (!["utf8", "latin1"].includes(encoding)) fail(1, "--encoding utf8|latin1");
  const maxDropRatio = Number(arg("max-drop-ratio") ?? "0.2");
  // A fixture tem rejeicoes de proposito (casos de QA); fonte real segue a politica padrao.
  const maxRejectRatio = qaFixture ? 0.5 : IMPORT_POLICY.maxRejectRatio;

  // Fonte real: interruptor do banco antes de ler um byte do arquivo.
  if (REAL_SOURCES.includes(source)) {
    const { data: settings } = await admin.from("support_network_settings").select("license_status,real_import_enabled").single();
    if (!settings?.real_import_enabled) {
      fail(3, `REAL_IMPORT=DISABLED license_status=${settings?.license_status ?? "desconhecido"} (ADR-0031: dado real so com licenca VERIFIED)`);
    }
  }

  const { absolute, bytes } = checkFile(filePath);
  const mapping = JSON.parse(readFileSync(resolve(mappingPath), "utf8"));
  const { typeNames, municipalityNames } = await loadLookups(mapping, delimiter, encoding);
  const sha = await sha256Of(absolute);
  const identifier = basename(absolute).slice(0, 200);
  const started = Date.now();
  let peakRss = process.memoryUsage().rss;

  const { data: existing } = await admin
    .from("support_network_snapshots")
    .select("id,status")
    .eq("source", source)
    .eq("source_reference_date", referenceDate)
    .eq("source_sha256", sha)
    .maybeSingle();
  if (existing) {
    log(`NO_OP=IDEMPOTENT snapshot=${existing.id} status=${existing.status} sha256=${sha.slice(0, 12)}`);
    if (existing.status === "inactive") log(`HINT ative com --activate ${existing.id}`);
  } else {
    const { data: snapshot, error } = await admin
      .from("support_network_snapshots")
      .insert({
        source,
        source_reference_date: referenceDate,
        source_identifier: identifier,
        source_sha256: sha,
        schema_version: qaFixture ? "qa-fixture-1" : `mapped-${createHash("sha256").update(JSON.stringify(mapping)).digest("hex").slice(0, 12)}`,
      })
      .select("id")
      .single();
    if (error) fail(error.message === "real_import_disabled" ? 3 : 1, `snapshot=${error.message}`);

    const cleanup = async (reason) => {
      await admin.from("support_facilities").delete().eq("snapshot_id", snapshot.id);
      await admin.from("support_facility_types").delete().eq("snapshot_id", snapshot.id);
      await admin.from("support_network_snapshots").delete().eq("id", snapshot.id);
      fail(1, `${reason} (nada publicado; staging removido)`);
    };

    let report;
    try {
      report = await runImportPipeline({
        chunks: decodedChunks(absolute, encoding),
        delimiter,
        mapping,
        typeNames,
        municipalityNames,
        maxRejectRatio,
        batchSize: 1000,
        onBatch: async ({ facilities, newTypes }) => {
          if (newTypes.length) {
            const { error: typeError } = await admin.from("support_facility_types").insert(
              newTypes.map((type) => ({ snapshot_id: snapshot.id, official_type_code: type.code, official_type_name: type.name })),
            );
            if (typeError) throw new Error(`tipos code=${typeError.code}`);
          }
          const { error: rowError } = await admin
            .from("support_facilities")
            .insert(
              // O nome do tipo mora em support_facility_types; a linha guarda so o codigo.
              facilities.map((facility) => {
                const row = { ...facility, snapshot_id: snapshot.id };
                delete row.official_type_name;
                return row;
              }),
            );
          if (rowError) throw new Error(`lote code=${rowError.code}`);
          peakRss = Math.max(peakRss, process.memoryUsage().rss);
        },
      });
    } catch (error) {
      if (error instanceof ImportFailure) return cleanup(`${error.code} ${error.detail}`);
      if (isEncodingError(error)) return cleanup("ENCODING_INVALID (use --encoding latin1 se o arquivo oficial for ISO-8859-1)");
      return cleanup(`erro=${error instanceof Error ? error.message : "desconhecido"}`);
    }

    const { error: sealError } = await admin.rpc("support_network_seal_snapshot", {
      p_snapshot_id: snapshot.id,
      // O selo confere o que esta EM ESCOPO: guardadas + rejeitadas = em escopo.
      p_record_count: report.inScopeCount,
      p_rejected_count: report.rejectedCount,
    });
    if (sealError) return cleanup(`selo=${sealError.message}`);

    log(
      `REPORT snapshot=${snapshot.id} source=${source} reference_date=${referenceDate} sha256=${sha.slice(0, 12)} ` +
        `bytes=${bytes} records=${report.recordCount} out_of_scope=${report.skippedCount} accepted=${report.acceptedCount} rejected=${report.rejectedCount} ` +
        `types=${report.typeCount} rejected_by=${JSON.stringify(report.rejectedByReason)} warnings=${JSON.stringify(report.warnings)} ` +
        `duration_ms=${Date.now() - started} peak_rss_mb=${Math.round(peakRss / 1048576)}`,
    );

    if (!flag("no-activate")) {
      const { data: previous, error: activateError } = await admin.rpc("support_network_activate_snapshot", {
        p_snapshot_id: snapshot.id,
        p_max_drop_ratio: maxDropRatio,
      });
      if (activateError) fail(1, `ativacao=${activateError.message} (snapshot selado e inativo: ${snapshot.id})`);
      log(`ACTIVATED snapshot=${snapshot.id} previous=${previous ?? "nenhum"}`);
    } else {
      log(`INACTIVE snapshot=${snapshot.id} (confira o REPORT e ative com --activate <id>)`);
    }
  }

  if (showFixtures) {
    const { error } = await admin.from("support_network_settings").update({ fixtures_visible: showFixtures === "on" }).eq("singleton", true);
    if (error) fail(1, `settings=${error.code}`);
    log(`FIXTURES_VISIBLE=${showFixtures === "on"}`);
  }
  console.log("SUPPORT_IMPORT=PASS");
}

await main();
