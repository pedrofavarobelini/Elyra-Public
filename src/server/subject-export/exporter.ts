import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  SUBJECT_EXPORT_REGISTRY,
  type ExportOrderRule,
  type PublicTableName,
  type SubjectExportDescriptor,
} from "@/server/subject-export/registry";

type Client = SupabaseClient<Database>;
type ExportRow = Record<string, unknown>;
type ExportData = Record<string, unknown[]>;

const PAGE_SIZE = 500;
const ID_CHUNK_SIZE = 100;

type QueryResult = {
  data: unknown[] | null;
  error: unknown;
};

type DynamicQuery = PromiseLike<QueryResult> & {
  eq(column: string, value: string): DynamicQuery;
  in(column: string, values: string[]): DynamicQuery;
  or(filters: string): DynamicQuery;
  order(
    column: string,
    options: { ascending: boolean },
  ): DynamicQuery;
  range(from: number, to: number): DynamicQuery;
};

type DynamicClient = {
  from(table: string): {
    select(columns: string): DynamicQuery;
  };
};

export class SubjectExportRegistryError extends Error {
  constructor(
    public readonly code:
      | "EXPORT_READ_FAILED"
      | "EXPORT_DEPENDENCY_UNRESOLVED"
      | "EXPORT_CARDINALITY_VIOLATION"
      | "EXPORT_REGISTRY_DUPLICATE"
      | "EXPORT_STRATEGY_UNKNOWN"
      | "EXPORT_ROW_INVALID",
    public readonly table: string,
  ) {
    super(`Falha no registry do export: ${code}.`);
    this.name = "SubjectExportRegistryError";
  }
}

function asRows(raw: unknown[] | null, table: string): ExportRow[] {
  const rows = raw ?? [];
  if (
    rows.some(
      (row) => row === null || typeof row !== "object" || Array.isArray(row),
    )
  ) {
    throw new SubjectExportRegistryError("EXPORT_ROW_INVALID", table);
  }
  return rows as ExportRow[];
}

async function fetchRows(
  client: Client,
  table: PublicTableName,
  order: readonly ExportOrderRule[],
  filter: (query: DynamicQuery) => DynamicQuery,
): Promise<ExportRow[]> {
  const rows: ExportRow[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = (client as unknown as DynamicClient).from(table).select("*");
    query = filter(query);
    for (const rule of order) {
      query = query.order(rule.column, { ascending: rule.ascending });
    }
    query = query.range(from, from + PAGE_SIZE - 1);

    const { data, error } = await query;
    if (error) {
      throw new SubjectExportRegistryError("EXPORT_READ_FAILED", table);
    }
    const page = asRows(data, table);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

function chunked(values: string[]): string[][] {
  const chunks: string[][] = [];
  for (let offset = 0; offset < values.length; offset += ID_CHUNK_SIZE) {
    chunks.push(values.slice(offset, offset + ID_CHUNK_SIZE));
  }
  return chunks;
}

async function fetchRowsByIds(
  client: Client,
  table: PublicTableName,
  column: string,
  values: string[],
  order: readonly ExportOrderRule[],
): Promise<ExportRow[]> {
  const unique = [...new Set(values)].sort();
  if (unique.length === 0) return [];

  const rows: ExportRow[] = [];
  for (const ids of chunked(unique)) {
    rows.push(
      ...(await fetchRows(client, table, order, (query) =>
        query.in(column, ids),
      )),
    );
  }
  return rows;
}

function dependencyRows(data: ExportData, table: PublicTableName): unknown[] {
  if (!Object.prototype.hasOwnProperty.call(data, table)) {
    throw new SubjectExportRegistryError(
      "EXPORT_DEPENDENCY_UNRESOLVED",
      table,
    );
  }
  return data[table] ?? [];
}

function stringValues(rows: unknown[], column: string): string[] {
  const values: string[] = [];
  for (const raw of rows) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const value = (raw as ExportRow)[column];
    if (typeof value === "string") values.push(value);
  }
  return values;
}

function compareValues(left: unknown, right: unknown): number {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  const leftText = String(left);
  const rightText = String(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function sortRows(
  rows: ExportRow[],
  order: readonly ExportOrderRule[],
): ExportRow[] {
  return [...rows].sort((left, right) => {
    for (const rule of order) {
      const compared = compareValues(left[rule.column], right[rule.column]);
      if (compared !== 0) return rule.ascending ? compared : -compared;
    }
    return 0;
  });
}

function deduplicateRows(
  rows: ExportRow[],
  key: string,
  table: PublicTableName,
): ExportRow[] {
  const unique = new Map<string, ExportRow>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value !== "string") {
      throw new SubjectExportRegistryError("EXPORT_ROW_INVALID", table);
    }
    unique.set(value, row);
  }
  return [...unique.values()];
}

function transformRows(
  rows: ExportRow[],
  descriptor: SubjectExportDescriptor,
): ExportRow[] {
  if (!descriptor.transform) return rows;
  return rows.map((row) => {
    const transformed = { ...row };
    for (const field of descriptor.transform?.fields ?? []) {
      delete transformed[field];
    }
    return transformed;
  });
}

async function readDescriptor(
  client: Client,
  subjectId: string,
  data: ExportData,
  descriptor: SubjectExportDescriptor,
): Promise<ExportRow[]> {
  const { ownership } = descriptor;

  if (ownership.kind === "direct") {
    return fetchRows(client, descriptor.table, descriptor.order, (query) =>
      query.eq(ownership.column, subjectId),
    );
  }

  if (ownership.kind === "participant") {
    const [first, second] = ownership.columns;
    return fetchRows(client, descriptor.table, descriptor.order, (query) =>
      query.or(`${first}.eq.${subjectId},${second}.eq.${subjectId}`),
    );
  }

  if (ownership.kind === "parent") {
    const parentIds = stringValues(
      dependencyRows(data, ownership.parentTable),
      ownership.parentKey,
    );
    return fetchRowsByIds(
      client,
      descriptor.table,
      ownership.foreignKey,
      parentIds,
      descriptor.order,
    );
  }

  if (ownership.kind === "client_connection") {
    const connections = dependencyRows(data, ownership.connectionTable).filter(
      (raw) =>
        raw !== null &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        (raw as ExportRow)[ownership.clientColumn] === subjectId,
    );
    const connectionIds = stringValues(connections, ownership.connectionKey);
    return fetchRowsByIds(
      client,
      descriptor.table,
      ownership.foreignKey,
      connectionIds,
      descriptor.order,
    );
  }

  if (ownership.kind === "self_rpc") {
    // A RPC filtra por `auth.uid()`; nao ha parametro de sujeito para adulterar.
    const { data, error } = await (
      client as unknown as { rpc(fn: string): PromiseLike<QueryResult> }
    ).rpc(ownership.fn);
    if (error) {
      throw new SubjectExportRegistryError("EXPORT_READ_FAILED", descriptor.table);
    }
    return asRows(data, descriptor.table);
  }

  if (ownership.kind === "owned_or_referenced_catalog") {
    const referencedIds = stringValues(
      dependencyRows(data, ownership.linkTable),
      ownership.linkReferenceColumn,
    );
    const [owned, referenced] = await Promise.all([
      fetchRows(client, descriptor.table, descriptor.order, (query) =>
        query.eq(ownership.ownerColumn, subjectId),
      ),
      fetchRowsByIds(
        client,
        descriptor.table,
        ownership.idColumn,
        referencedIds,
        descriptor.order,
      ),
    ]);
    return deduplicateRows(
      [...owned, ...referenced],
      ownership.idColumn,
      descriptor.table,
    );
  }

  // Fail-closed: uma strategy que ninguem classificou nao vira leitura ampla.
  // O `never` prova em compilacao que o switch esta completo; o `throw` cobre o
  // caso em que alguem contorna o tipo e injeta um descriptor invalido.
  ownership satisfies never;
  throw new SubjectExportRegistryError(
    "EXPORT_STRATEGY_UNKNOWN",
    descriptor.table,
  );
}

export async function readSubjectExportData(
  client: Client,
  subjectId: string,
  registry: readonly SubjectExportDescriptor[] = SUBJECT_EXPORT_REGISTRY,
): Promise<ExportData> {
  const data: ExportData = {};
  const seen = new Set<string>();

  for (const descriptor of registry) {
    if (seen.has(descriptor.table)) {
      throw new SubjectExportRegistryError(
        "EXPORT_REGISTRY_DUPLICATE",
        descriptor.table,
      );
    }
    seen.add(descriptor.table);

    const rows = sortRows(
      await readDescriptor(client, subjectId, data, descriptor),
      descriptor.order,
    );
    if (descriptor.cardinality === "zero_or_one" && rows.length > 1) {
      throw new SubjectExportRegistryError(
        "EXPORT_CARDINALITY_VIOLATION",
        descriptor.table,
      );
    }
    data[descriptor.table] = transformRows(rows, descriptor);
  }

  return data;
}
