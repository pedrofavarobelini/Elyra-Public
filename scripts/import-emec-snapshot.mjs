

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const REQUIRED = ["institution_code", "institution_name", "course_code", "course_name"];
const OPTIONAL = ["degree", "course_status"];

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

/** Parser CSV minimo com aspas ("" escapa aspas). Sem dependencia nova. */
export function parseCsvLine(line, delimiter) {
  const out = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      out.push(field);
      field = "";
    } else {
      field += char;
    }
  }
  out.push(field);
  return out.map((value) => value.trim());
}

export function normalizeName(value) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fail(code, message) {
  console.error(`EMEC_IMPORT=FAIL ${message}`);
  process.exit(code);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail(2, "reason=credenciais_ausentes");
  const host = new URL(url).hostname;
  if (!["127.0.0.1", "localhost"].includes(host) && process.env.ELYRA_OPS_CONFIRM_REMOTE !== "true") {
    fail(2, `reason=alvo_remoto_sem_confirmacao host=${host}`);
  }
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  if (process.argv.includes("--status")) {
    const { data } = await admin.from("education_registry_snapshots").select("source,reference_date,row_count,active,imported_at").order("imported_at", { ascending: false }).limit(5);
    console.log(`EMEC_SNAPSHOTS=${JSON.stringify(data ?? [])}`);
    return;
  }

  const file = arg("file");
  const mappingPath = arg("mapping");
  const referenceDate = arg("reference-date");
  const delimiter = arg("delimiter") ?? ";";
  const encoding = arg("encoding") ?? "utf8";
  const source = process.argv.includes("--qa-fixture") ? "qa_fixture" : "emec_open_data";
  if (!file || !mappingPath || !/^\d{4}-\d{2}-\d{2}$/.test(referenceDate ?? "")) {
    fail(1, "uso: --file <csv> --mapping <json> --reference-date AAAA-MM-DD");
  }
  if (!["utf8", "latin1"].includes(encoding)) fail(1, "encoding deve ser utf8 ou latin1");

  const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));
  const missingKeys = REQUIRED.filter((field) => typeof mapping[field] !== "string");
  if (missingKeys.length) fail(1, `mapeamento_sem=${missingKeys.join(",")}`);

  const bytes = readFileSync(file);
  const text = bytes.toString(encoding);
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = parseCsvLine(lines[0] ?? "", delimiter);
  const index = {};
  for (const field of [...REQUIRED, ...OPTIONAL]) {
    if (typeof mapping[field] !== "string") continue;
    const position = header.indexOf(mapping[field]);
    if (position === -1) fail(1, `cabecalho_ausente=${mapping[field]} (confira o mapeamento com o arquivo oficial)`);
    index[field] = position;
  }

  const rows = new Map();
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line, delimiter);
    const institutionCode = Number.parseInt(cells[index.institution_code], 10);
    const courseCode = Number.parseInt(cells[index.course_code], 10);
    const institutionName = normalizeName(cells[index.institution_name] ?? "");
    const courseName = normalizeName(cells[index.course_name] ?? "");
    if (!(institutionCode > 0) || !(courseCode > 0) || institutionName.length < 2 || courseName.length < 2) {
      skipped += 1;
      continue;
    }
    rows.set(courseCode, {
      institution_code: institutionCode,
      institution_name_normalized: institutionName.slice(0, 300),
      course_code: courseCode,
      course_name_normalized: courseName.slice(0, 300),
      degree: index.degree !== undefined ? cells[index.degree]?.slice(0, 80) || null : null,
      course_status: index.course_status !== undefined ? cells[index.course_status]?.slice(0, 80) || null : null,
    });
  }

  const { data: snapshot, error } = await admin
    .from("education_registry_snapshots")
    .insert({
      source,
      reference_date: referenceDate,
      file_sha256: createHash("sha256").update(bytes).digest("hex"),
      row_count: rows.size,
      active: false,
    })
    .select("id")
    .single();
  if (error) fail(1, `snapshot=${error.code}`);

  const all = [...rows.values()].map((row) => ({ ...row, snapshot_id: snapshot.id }));
  for (let i = 0; i < all.length; i += 1000) {
    const { error: batchError } = await admin.from("education_registry_courses").insert(all.slice(i, i + 1000));
    if (batchError) {
      await admin.from("education_registry_snapshots").delete().eq("id", snapshot.id);
      fail(1, `lote=${i} code=${batchError.code}`);
    }
  }
  // Troca atomica o bastante para um job manual: desativa o anterior e ativa este.
  await admin.from("education_registry_snapshots").update({ active: false }).eq("active", true);
  await admin.from("education_registry_snapshots").update({ active: true }).eq("id", snapshot.id);
  console.log(`EMEC_IMPORT=PASS source=${source} reference_date=${referenceDate} courses=${rows.size} skipped=${skipped}`);
}

await main();
