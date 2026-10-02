/**
 * SUP-1 — teste de integracao (so contra o Supabase local).
 *
 *   npm run qa:sup1                 # fixture -> importacao -> snapshot -> RPC -> contrato
 *   npm run qa:sup1 -- --perf 100000  # + medicao com arquivo sintetico grande (scratch, nunca versionado)
 *
 * Prova que o consumidor (SUP-2) so precisa da projecao: o usuario autenticado
 * chama as RPCs e recebe unidades + procedencia, sem saber do arquivo, da
 * fonte fisica ou do snapshot. Restaura os interruptores e apaga o que criou.
 */

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { demoTargetRefusal } from "./lib/demo-local-guard.mjs";

try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const refusal = demoTargetRefusal(process.env);
if (!url || !serviceKey || !anonKey) throw new Error("SUP1_QA=FAIL credenciais locais ausentes");
if (refusal || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error(`SUP1_QA=FAIL alvo nao local ${refusal ?? ""}`);

const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` · ${detail}` : ""}`);
};
const importer = (...args) =>
  execFileSync(process.execPath, ["scripts/import-support-network.mjs", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

const { data: before } = await admin.from("support_network_settings").select("fixtures_visible").single();
const { data: activeBefore } = await admin
  .from("support_network_snapshots")
  .select("id")
  .eq("source", "qa_fixture")
  .eq("status", "active")
  .maybeSingle();
const email = `sup1-qa-${Date.now()}@elyra.invalid`;
const password = `Sup1Qa!${Date.now()}`;
let userId = null;
let createdSnapshot = null;

try {
  // 1. Importacao da fixture numa competencia propria; repetir e no-op.
  const referenceDate = "2026-09-02";
  const first = importer("--qa-fixture", "--reference-date", referenceDate);
  createdSnapshot = /REPORT snapshot=([0-9a-f-]{36})/.exec(first)?.[1] ?? /NO_OP=IDEMPOTENT snapshot=([0-9a-f-]{36})/.exec(first)?.[1] ?? null;
  check("importacao da fixture", /SUPPORT_IMPORT=PASS/.test(first), /REPORT[^\n]*/.exec(first)?.[0]?.replace(/snapshot=\S+ /, "") ?? "reuso");
  check("reimportacao identica = NO_OP", /NO_OP=IDEMPOTENT/.test(importer("--qa-fixture", "--reference-date", referenceDate)));

  // 2. Fixture invisivel por padrao; o modo demo liga explicitamente.
  await admin.from("support_network_settings").update({ fixtures_visible: false }).eq("singleton", true);
  const { data: created, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userError) throw userError;
  userId = created.user.id;
  const user = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: signInError } = await user.auth.signInWithPassword({ email, password });
  if (signInError) throw signInError;
  const hidden = await user.rpc("search_support_facilities", { p_municipality_code: "355030" });
  check("fixture invisivel por padrao", !hidden.error && hidden.data.length === 0);

  await admin.from("support_network_settings").update({ fixtures_visible: true }).eq("singleton", true);
  const search = await user.rpc("search_support_facilities", { p_municipality_code: "3550308" });
  check("busca por municipio (IBGE 7 digitos)", !search.error && search.data.length === 6, `${search.data?.length ?? search.error?.message} unidades`);
  const keys = Object.keys(search.data?.[0] ?? {});
  check("projecao sem campo interno", keys.length > 0 && !keys.some((key) => /snapshot|sha|hash|imported|identifier/.test(key)));
  check("desativada explicita fora; RJ fora do municipio", !search.data.some((row) => ["9900007", "9900008"].includes(row.cnes_code)));
  check("coordenada impossivel nao vira ponto", search.data.find((row) => row.cnes_code === "9900006")?.coordinate_status === "invalid");
  check("tipo sem mapeamento sem categoria", search.data.every((row) => row.category === null));

  const provenance = await user.rpc("support_network_provenance");
  const meta = provenance.data?.[0];
  check("procedencia: fixture marcada e datada", meta?.is_fixture === true && meta.source === "qa_fixture" && typeof meta.age_days === "number");
  const detail = await user.rpc("get_support_facility", { p_cnes_code: "9900008" });
  check("detalhe pelo CNES", detail.data?.length === 1 && detail.data[0].state_code === "RJ");

  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anonSearch = await anon.rpc("search_support_facilities", { p_municipality_code: "355030" });
  check("anon nao le", Boolean(anonSearch.error));
  const directRead = await user.from("support_facilities").select("cnes_code").limit(1);
  check("usuario nao le a tabela", Boolean(directRead.error));
  const directWrite = await user.from("support_network_settings").update({ fixtures_visible: false }).eq("singleton", true).select();
  check("usuario nao escreve interruptor", Boolean(directWrite.error) || (directWrite.data ?? []).length === 0);

  // 3. Rollback para o snapshot anterior (se havia), provando a troca.
  if (activeBefore?.id && activeBefore.id !== createdSnapshot) {
    const rollback = importer("--rollback", activeBefore.id);
    check("rollback reativa o anterior", /ROLLBACK=PASS/.test(rollback));
  }

  // 3b. Importar sem ativar -> conferir -> --activate -> voltar ao ativo de antes.
  const staged = importer("--qa-fixture", "--reference-date", "2026-09-03", "--no-activate");
  const stagedId = /INACTIVE snapshot=([0-9a-f-]{36})/.exec(staged)?.[1] ?? /NO_OP=IDEMPOTENT snapshot=([0-9a-f-]{36})/.exec(staged)?.[1];
  const hint = importer("--qa-fixture", "--reference-date", "2026-09-03");
  check("sem ativar: fica inactive e o NO_OP aponta --activate", Boolean(stagedId) && hint.includes(`--activate ${stagedId}`));
  if (stagedId) {
    const { data: activeNow } = await admin
      .from("support_network_snapshots")
      .select("id")
      .eq("source", "qa_fixture")
      .eq("status", "active")
      .maybeSingle();
    check("--activate ativa o snapshot conferido", /ACTIVATED/.test(importer("--activate", stagedId)));
    if (activeNow?.id) importer("--rollback", activeNow.id);
    await admin.from("support_network_snapshots").delete().eq("id", stagedId).neq("status", "active");
  }

  // 3c. Formato REAL do arquivo oficial (cabecalho de 36 colunas, cp1252, CNES sem zeros)
  //     com o MAPEAMENTO VERSIONADO do CNES. Valores ficticios; fonte qa_fixture.
  //     Prova: inativo -> conferencia no banco -> contrato SUP-2 -> rollback.
  const fixtures = "scripts/fixtures/support-network";
  const realShape = importer(
    "--file", `${fixtures}/qa-fixture-cnes-real-shape.csv`, "--source", "qa_fixture", "--reference-date", "2026-09-26",
    "--encoding", "latin1", "--mapping", "scripts/support-network/cnes-estabelecimentos.mapping.json",
    "--types", `${fixtures}/qa-fixture-cnes-real-shape-types.csv`, "--types-columns", "CO_TIPO,DS_TIPO",
    "--municipalities", `${fixtures}/qa-fixture-cnes-real-shape-municipalities.csv`, "--municipalities-columns", "CO_MUNICIPIO,NO_MUNICIPIO",
    "--no-activate",
  );
  const realId = /INACTIVE snapshot=([0-9a-f-]{36})/.exec(realShape)?.[1] ?? /NO_OP=IDEMPOTENT snapshot=([0-9a-f-]{36})/.exec(realShape)?.[1];
  const { data: realSnap } = await admin
    .from("support_network_snapshots")
    .select("status,record_count,accepted_count,rejected_count,schema_version")
    .eq("id", realId ?? "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  check(
    "formato real: snapshot inativo; selo confere o escopo (7 lidas, 2 fora, 5 aceitas)",
    realSnap?.status === "inactive" && realSnap.record_count === 5 && realSnap.accepted_count === 5 && realSnap.rejected_count === 0,
    /REPORT[^\n]*/.exec(realShape)?.[0]?.replace(/snapshot=\S+ /, "").replace(/ duration_ms.*/, "") ?? "reuso",
  );
  const { data: realRows } = await admin.from("support_facilities").select("*").eq("snapshot_id", realId ?? "");
  const byCnes = new Map((realRows ?? []).map((row) => [row.cnes_code, row]));
  check(
    "formato real: CNES com 7 digitos e tipo com 2 (zero-pad declarado)",
    ["0099101", "0099102", "0099103", "0099106", "0099107"].every((code) => byCnes.has(code)) &&
      byCnes.get("0099106")?.official_type_code === "01" && byCnes.get("0099101")?.state_code === "SP",
  );
  check("formato real: tipo fora da allowlist e unidade com motivo de desabilitacao ficam fora", !byCnes.has("0099104") && !byCnes.has("0099105"));
  const serialized = JSON.stringify(realRows ?? []);
  check(
    "formato real: e-mail, CNPJ e razao social nunca entram",
    !/nao-projetar|RAZAO NAO PROJETADA|00000000000000/.test(serialized) && !Object.keys(realRows?.[0] ?? {}).some((key) => /email|cnpj|razao/i.test(key)),
  );
  check(
    "formato real: telefone sem DDD visivel e sem tel:; coordenada impossivel sem ponto",
    byCnes.get("0099102")?.phone_display === "30000002" && byCnes.get("0099102")?.phone_digits === null &&
      byCnes.get("0099101")?.phone_digits === "1630000001" && byCnes.get("0099106")?.coordinate_status === "invalid",
  );

  if (realId) {
    const { data: activeBeforeReal } = await admin
      .from("support_network_snapshots")
      .select("id")
      .eq("source", "qa_fixture")
      .eq("status", "active")
      .maybeSingle();
    check("formato real: --activate (so qa_fixture)", /ACTIVATED/.test(importer("--activate", realId, "--max-drop-ratio", "1")));
    await admin.from("support_network_settings").update({ fixtures_visible: true }).eq("singleton", true);
    const found = await user.rpc("search_support_facilities", { p_municipality_code: "353470" });
    check(
      "SUP-2 search: Orlandia (IBGE 6) devolve as 4 unidades em escopo",
      !found.error && found.data.length === 4 && found.data.every((row) => row.municipality_name === "Cidade Demo"),
      `${found.data?.length ?? found.error?.message} unidades`,
    );
    const municipalities = await user.rpc("list_support_municipalities");
    check(
      "SUP-2 municipios: nome oficial vindo da tabela auxiliar",
      !municipalities.error && municipalities.data.some((row) => row.municipality_code === "353470" && row.municipality_name === "Cidade Demo" && row.facility_count === 4),
    );
    const types = await user.rpc("list_support_municipality_types", { p_municipality_code: "353470" });
    check(
      "SUP-2 tipos: codigo e nome oficiais (tabela auxiliar)",
      !types.error && ["01", "02", "70", "73"].every((code) => types.data.some((row) => row.official_type_code === code && row.official_type_name.startsWith("[DEMO] TIPO"))),
    );
    const realDetail = await user.rpc("get_support_facility", { p_cnes_code: "0099101" });
    check("SUP-2 detalhe pelo CNES com zeros", realDetail.data?.length === 1 && realDetail.data[0].official_type_code === "02");
    const realProvenance = (await user.rpc("support_network_provenance")).data?.[0];
    check(
      "SUP-2 procedencia e frescor do snapshot novo",
      realProvenance?.source === "qa_fixture" && realProvenance.is_fixture === true && String(realProvenance.source_reference_date).startsWith("2026-09-26") && typeof realProvenance.age_days === "number",
    );
    if (activeBeforeReal?.id) {
      check("formato real: rollback devolve o snapshot anterior", /ROLLBACK=PASS/.test(importer("--rollback", activeBeforeReal.id)));
      const { data: activeAfter } = await admin
        .from("support_network_snapshots")
        .select("id")
        .eq("source", "qa_fixture")
        .eq("status", "active")
        .maybeSingle();
      check("formato real: ativo depois do rollback = anterior", activeAfter?.id === activeBeforeReal.id);
    }
    await admin.from("support_network_snapshots").delete().eq("id", realId).neq("status", "active");
  }

  // 4. Desempenho (opcional): arquivo sintetico grande, fora do repositorio.
  const perfIndex = process.argv.indexOf("--perf");
  if (perfIndex > -1) {
    const rows = Number(process.argv[perfIndex + 1] ?? "100000");
    const dir = mkdtempSync(join(tmpdir(), "sup1-perf-"));
    const file = join(dir, "sup1-perf.csv");
    const lines = ["CNES;NOME_UNIDADE;TIPO_CODIGO;TIPO_NOME;MUNICIPIO_IBGE;MUNICIPIO_NOME;UF;CEP;LOGRADOURO;NUMERO;BAIRRO;TELEFONE;LATITUDE;LONGITUDE;SITUACAO;ATUALIZADO_EM"];
    for (let i = 0; i < rows; i += 1) {
      const cnes = String(8000000 + i).padStart(7, "0");
      lines.push(`${cnes};[DEMO] Unidade sintetica ${i};02;CENTRO DE SAUDE/UNIDADE BASICA;355030;São Paulo;SP;01000000;Rua Sintetica;${i};Bairro;(11) 0000-0000;-23.5;-46.6;S;2026-08-01`);
    }
    writeFileSync(file, lines.join("\n"));
    const output = importer(
      "--file", file, "--source", "qa_fixture", "--reference-date", "2000-01-01",
      "--mapping", "scripts/fixtures/support-network/qa-fixture-mapping.json", "--no-activate",
    );
    const report = /REPORT[^\n]*/.exec(output)?.[0] ?? "";
    const perfId = /snapshot=([0-9a-f-]{36})/.exec(report)?.[1];
    check(`desempenho ${rows} linhas`, /accepted=\d+/.test(report), report.replace(/snapshot=\S+ /, "").replace(/rejected_by=\S+ warnings=\S+ /, ""));
    if (perfId) await admin.from("support_network_snapshots").delete().eq("id", perfId);
    rmSync(dir, { recursive: true, force: true });
  }
} finally {
  await admin.from("support_network_settings").update({ fixtures_visible: before?.fixtures_visible ?? false }).eq("singleton", true);
  if (createdSnapshot && activeBefore?.id && createdSnapshot !== activeBefore.id) {
    await admin.from("support_network_snapshots").delete().eq("id", createdSnapshot).neq("status", "active");
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
}

const failed = results.filter((item) => !item.ok).length;
console.log(`SUP1_QA=${failed ? "FAIL" : "PASS"} checks=${results.length} failed=${failed}`);
process.exit(failed ? 1 : 0);
