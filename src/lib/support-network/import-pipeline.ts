/**
 * SUP-1 — pipeline de importacao, sem I/O de banco: le registros em streaming,
 * valida, normaliza, deduplica e entrega LOTES a quem grava. O relatorio diz
 * quantas linhas entraram e por que as outras nao entraram, sem nunca
 * reproduzir o conteudo de uma linha (log sem dado).
 *
 * Falhas que invalidam o ARQUIVO inteiro lancam `ImportFailure` (fail-closed):
 * cabecalho divergente do mapeamento, CSV malformado, arquivo grande demais,
 * zero aceitos ou rejeicao acima do limite. Problema de uma linha so a rejeita.
 */

import { CsvFormatError, DEFAULT_CSV_LIMITS, parseCsvStream, type CsvLimits } from "./csv-stream.ts";
import {
  applyZeroPad,
  IMPORT_POLICY,
  normalizeRecord,
  resolveHeader,
  type MappingIssue,
  type NormalizedFacility,
  type RejectReason,
  type SkipReason,
} from "./cnes-record.ts";

export type ImportFailureCode =
  | "SCHEMA_DRIFT_DETECTED"
  | "MAPPING_INVALID"
  | "CSV_MALFORMED"
  | "EMPTY_FILE"
  | "TOO_MANY_RECORDS"
  | "NO_ACCEPTED_RECORDS"
  | "REJECT_RATIO_EXCEEDED";

export class ImportFailure extends Error {
  readonly code: ImportFailureCode;
  readonly detail: string;
  readonly issues: MappingIssue[];
  /** Relatorio parcial (contagens) quando a falha vem depois da leitura: serve ao dry-run. */
  readonly report: ImportReport | null;

  constructor(code: ImportFailureCode, detail: string, issues: MappingIssue[] = [], report: ImportReport | null = null) {
    super(`${code}: ${detail}`);
    this.name = "ImportFailure";
    this.code = code;
    this.detail = detail;
    this.issues = issues;
    this.report = report;
  }
}

export type ImportBatch = {
  facilities: NormalizedFacility[];
  /** Tipos oficiais vistos pela primeira vez neste lote (gravar antes das linhas). */
  newTypes: { code: string; name: string }[];
};

export type ImportReport = {
  /** Linhas de dados lidas do arquivo (todas). */
  recordCount: number;
  /** Linhas fora do escopo declarado no mapeamento (tipo fora da allowlist, regra de exclusao). */
  skippedCount: number;
  skippedByReason: Partial<Record<SkipReason, number>>;
  /** Linhas em escopo = recordCount - skippedCount; e o que o selo do snapshot confere. */
  inScopeCount: number;
  acceptedCount: number;
  rejectedCount: number;
  rejectedByReason: Partial<Record<RejectReason, number>>;
  /** Codigo de tipo em escopo sem nome oficial (arquivo nem tabela auxiliar). */
  unknownTypes: Record<string, number>;
  acceptedByType: Record<string, number>;
  missingCoordinates: number;
  missingPhones: number;
  duplicateCnes: number;
  warnings: Record<string, number>;
  typeCount: number;
  headerColumns: number;
};

export async function runImportPipeline(options: {
  chunks: AsyncIterable<string> | Iterable<string>;
  delimiter: string;
  mapping: Record<string, unknown>;
  /** Nomes oficiais dos tipos quando o arquivo principal nao traz a coluna. */
  typeNames?: ReadonlyMap<string, string>;
  /** Nomes oficiais de municipio (IBGE 6 digitos) quando o arquivo nao traz a coluna. */
  municipalityNames?: ReadonlyMap<string, string>;
  onBatch: (batch: ImportBatch) => Promise<void>;
  batchSize?: number;
  limits?: CsvLimits;
  maxRejectRatio?: number;
}): Promise<ImportReport> {
  const batchSize = options.batchSize ?? 1000;
  const typeNames = options.typeNames ?? new Map<string, string>();
  const maxRejectRatio = options.maxRejectRatio ?? IMPORT_POLICY.maxRejectRatio;
  const report: ImportReport = {
    recordCount: 0,
    skippedCount: 0,
    skippedByReason: {},
    inScopeCount: 0,
    acceptedCount: 0,
    rejectedCount: 0,
    rejectedByReason: {},
    unknownTypes: {},
    acceptedByType: {},
    missingCoordinates: 0,
    missingPhones: 0,
    duplicateCnes: 0,
    warnings: {},
    typeCount: 0,
    headerColumns: 0,
  };
  const seenCnes = new Set<string>();
  const knownTypes = new Map<string, string>();
  let header: string[] | null = null;
  let index: ReturnType<typeof resolveHeader>["index"] = {};
  let context: Parameters<typeof normalizeRecord>[4] = {};
  let batch: ImportBatch = { facilities: [], newTypes: [] };

  const reject = (reason: RejectReason) => {
    report.rejectedCount += 1;
    report.rejectedByReason[reason] = (report.rejectedByReason[reason] ?? 0) + 1;
  };
  const flush = async () => {
    if (!batch.facilities.length) return;
    const current = batch;
    batch = { facilities: [], newTypes: [] };
    await options.onBatch(current);
  };

  try {
    for await (const { fields } of parseCsvStream(options.chunks, options.delimiter, options.limits ?? DEFAULT_CSV_LIMITS)) {
      if (header === null) {
        header = fields.map((name) => name.trim().replace(/^﻿/, ""));
        report.headerColumns = header.length;
        const resolved = resolveHeader(header, options.mapping);
        if (resolved.issues.length) {
          const drift = resolved.issues.some((issue) => issue.code === "SCHEMA_DRIFT_DETECTED");
          throw new ImportFailure(
            drift ? "SCHEMA_DRIFT_DETECTED" : "MAPPING_INVALID",
            resolved.issues.map((issue) => Object.values(issue).join(":")).join(", "),
            resolved.issues,
          );
        }
        index = resolved.index;
        context = { rules: resolved.rules, excludeIndexes: resolved.excludeIndexes, municipalityNames: options.municipalityNames };
        continue;
      }
      report.recordCount += 1;
      if (report.recordCount > IMPORT_POLICY.maxRecords) {
        throw new ImportFailure("TOO_MANY_RECORDS", `limite ${IMPORT_POLICY.maxRecords}`);
      }
      const result = normalizeRecord(fields, header.length, index, typeNames, context);
      if (!result.ok && "skipped" in result) {
        report.skippedCount += 1;
        report.skippedByReason[result.skipped] = (report.skippedByReason[result.skipped] ?? 0) + 1;
        continue;
      }
      if (!result.ok) {
        reject(result.reason);
        if (result.reason === "TYPE_NAME_UNAVAILABLE" && index.official_type_code !== undefined) {
          const code = applyZeroPad(fields[index.official_type_code]!.trim(), context.rules?.zeroPad.official_type_code) ?? "";
          report.unknownTypes[code] = (report.unknownTypes[code] ?? 0) + 1;
        }
        continue;
      }
      const facility = result.facility;
      if (seenCnes.has(facility.cnes_code)) {
        reject("DUPLICATE_CNES");
        report.duplicateCnes += 1;
        continue;
      }
      seenCnes.add(facility.cnes_code);
      for (const warning of result.warnings) report.warnings[warning] = (report.warnings[warning] ?? 0) + 1;
      const knownName = knownTypes.get(facility.official_type_code);
      if (knownName === undefined) {
        knownTypes.set(facility.official_type_code, facility.official_type_name);
        batch.newTypes.push({ code: facility.official_type_code, name: facility.official_type_name });
      } else if (knownName !== facility.official_type_name) {
        // Mesmo codigo com nomes diferentes: o primeiro vale; a divergencia fica no relatorio.
        report.warnings.TYPE_NAME_DIVERGENT = (report.warnings.TYPE_NAME_DIVERGENT ?? 0) + 1;
        facility.official_type_name = knownName;
      }
      batch.facilities.push(facility);
      report.acceptedCount += 1;
      report.acceptedByType[facility.official_type_code] = (report.acceptedByType[facility.official_type_code] ?? 0) + 1;
      if (facility.coordinate_status !== "valid") report.missingCoordinates += 1;
      if (facility.phone_digits === null) report.missingPhones += 1;
      if (batch.facilities.length >= batchSize) await flush();
    }
  } catch (error) {
    if (error instanceof CsvFormatError) throw new ImportFailure("CSV_MALFORMED", `${error.code} linha ${error.line}`);
    throw error;
  }

  if (header === null) throw new ImportFailure("EMPTY_FILE", "sem cabecalho");
  await flush();
  report.typeCount = knownTypes.size;
  report.inScopeCount = report.recordCount - report.skippedCount;
  if (report.acceptedCount === 0) throw new ImportFailure("NO_ACCEPTED_RECORDS", `${report.inScopeCount} em escopo de ${report.recordCount} lidas`, [], report);
  // A razao de rejeicao e sobre o que esta EM ESCOPO: filtro declarado nao e defeito do arquivo.
  if (report.inScopeCount > 0 && report.rejectedCount / report.inScopeCount > maxRejectRatio) {
    throw new ImportFailure(
      "REJECT_RATIO_EXCEEDED",
      `${report.rejectedCount}/${report.inScopeCount} acima de ${maxRejectRatio}`,
      [],
      report,
    );
  }
  return report;
}
