/**
 * SUP-1 — contrato de origem e normalizacao minima de um registro CNES.
 *
 * Nenhum nome de coluna oficial e adivinhado: os cabecalhos reais do CNES nao
 * puderam ser conferidos na origem desta sessao (egress bloqueado, L-343). O
 * importador recebe um MAPEAMENTO explicito (campo logico -> cabecalho do
 * arquivo). A fixture de QA tem mapeamento proprio e conhecido.
 *
 * Normalizacao permitida (ADR-0031): trim, vazio -> null, validacao de
 * formato, parse de coordenada e de telefone. Valor textual e guardado
 * LITERAL: nada e reescrito, traduzido, reclassificado ou "corrigido".
 */

export const REQUIRED_FIELDS = [
  "cnes_code",
  "official_name",
  "official_type_code",
  "municipality_code",
  "state_code",
] as const;

export const OPTIONAL_FIELDS = [
  "official_type_name",
  "municipality_name",
  "postal_code",
  "address_street",
  "address_number",
  "address_complement",
  "address_district",
  "phone",
  "latitude",
  "longitude",
  "source_active",
  "source_updated_at",
] as const;

export type LogicalField = (typeof REQUIRED_FIELDS)[number] | (typeof OPTIONAL_FIELDS)[number];

/** Campo logico -> nome exato do cabecalho no arquivo. */
export type SourceMapping = Partial<Record<LogicalField, string>> & Record<(typeof REQUIRED_FIELDS)[number], string>;

/**
 * Colunas que existem em bases CNES e NUNCA entram na projecao (privacidade).
 * CNPJ e razao social: em consultorio de pessoa fisica podem identificar a
 * pessoa (arquivo oficial de 26/09/2026, L-367).
 */
export const FORBIDDEN_HEADER_PATTERN = /(^|_)(CPF|CNS|NU_CPF|CO_CPF|NO_PROFISSIONAL|NOME_PROFISSIONAL|PACIENTE|EMAIL|E_MAIL|CNPJ|RAZAO_SOCIAL)(_|$)/i;

/** Chave reservada do mapeamento com regras declarativas (nao e campo logico). */
export const MAPPING_RULES_KEY = "$rules";

/**
 * Regras declarativas do mapeamento (arquivo oficial real, L-363). Nada e
 * inferido: cada regra e escrita no JSON versionado e conferida aqui.
 * - `zeroPad`: completa com zeros a esquerda um codigo so de digitos
 *   (o CNES oficial tem 7 digitos; o arquivo publica "19" para "0000019").
 * - `typeAllowlist`: tipos oficiais em escopo; os demais ficam FORA da
 *   projecao (nao sao rejeicao: sao escopo). Protege dado pessoal (tipo 22).
 * - `excludeWhenFilled`: coluna que, preenchida, tira a unidade do escopo
 *   (ex.: codigo do motivo de desabilitacao).
 */
export type MappingRules = {
  zeroPad: Partial<Record<"cnes_code" | "official_type_code", number>>;
  typeAllowlist: ReadonlySet<string> | null;
  excludeWhenFilled: string[];
};

const PADDABLE_FIELDS = new Set(["cnes_code", "official_type_code"]);
const CODE_PATTERN = /^[0-9A-Za-z]{1,10}$/;

/** Le e valida `$rules`. Regra desconhecida ou malformada = mapeamento invalido. */
export function parseMappingRules(mapping: Record<string, unknown>) {
  const issues: MappingIssue[] = [];
  const rules: MappingRules = { zeroPad: {}, typeAllowlist: null, excludeWhenFilled: [] };
  const raw = mapping[MAPPING_RULES_KEY];
  if (raw === undefined) return { rules, issues };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { rules, issues: [{ code: "MAPPING_RULE_INVALID", field: MAPPING_RULES_KEY }] as MappingIssue[] };
  }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "zeroPad" && typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [field, width] of Object.entries(value as Record<string, unknown>)) {
        if (!PADDABLE_FIELDS.has(field) || !Number.isInteger(width) || (width as number) < 1 || (width as number) > 10) {
          issues.push({ code: "MAPPING_RULE_INVALID", field: `zeroPad.${field}` });
        } else rules.zeroPad[field as "cnes_code" | "official_type_code"] = width as number;
      }
    } else if (key === "typeAllowlist" && Array.isArray(value) && value.length > 0 && value.every((code) => typeof code === "string" && CODE_PATTERN.test(code))) {
      rules.typeAllowlist = new Set(value as string[]);
    } else if (key === "excludeWhenFilled" && Array.isArray(value) && value.every((name) => typeof name === "string" && name.trim())) {
      rules.excludeWhenFilled = value as string[];
    } else {
      issues.push({ code: "MAPPING_RULE_INVALID", field: key });
    }
  }
  return { rules, issues };
}

/** Zero-pad declarado; so para codigo de digitos que cabe na largura. */
export function applyZeroPad(value: string | null, width: number | undefined): string | null {
  if (value === null || width === undefined || !/^[0-9]+$/.test(value) || value.length > width) return value;
  return value.padStart(width, "0");
}

export const UF_BY_IBGE: Record<string, string> = {
  "11": "RO", "12": "AC", "13": "AM", "14": "RR", "15": "PA", "16": "AP", "17": "TO",
  "21": "MA", "22": "PI", "23": "CE", "24": "RN", "25": "PB", "26": "PE", "27": "AL", "28": "SE", "29": "BA",
  "31": "MG", "32": "ES", "33": "RJ", "35": "SP",
  "41": "PR", "42": "SC", "43": "RS",
  "50": "MS", "51": "MT", "52": "GO", "53": "DF",
};
const UF_SET = new Set(Object.values(UF_BY_IBGE));

export type MappingIssue =
  | { code: "MAPPING_MISSING_REQUIRED"; field: string }
  | { code: "MAPPING_UNKNOWN_FIELD"; field: string }
  | { code: "SCHEMA_DRIFT_DETECTED"; header: string; field: string }
  | { code: "DUPLICATE_HEADER"; header: string }
  | { code: "FORBIDDEN_COLUMN_MAPPED"; header: string }
  | { code: "MAPPING_RULE_INVALID"; field: string };

/** Confere mapeamento x cabecalho. Qualquer problema => a importacao falha fechada. */
export function resolveHeader(header: string[], mapping: Record<string, unknown>) {
  const issues: MappingIssue[] = [];
  const known = new Set<string>([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]);
  for (const key of Object.keys(mapping)) {
    if (key !== MAPPING_RULES_KEY && !known.has(key)) issues.push({ code: "MAPPING_UNKNOWN_FIELD", field: key });
  }
  const { rules, issues: ruleIssues } = parseMappingRules(mapping);
  issues.push(...ruleIssues);
  for (const field of REQUIRED_FIELDS) {
    if (typeof mapping[field] !== "string" || !(mapping[field] as string).trim()) {
      issues.push({ code: "MAPPING_MISSING_REQUIRED", field });
    }
  }
  const seen = new Set<string>();
  for (const name of header) {
    if (seen.has(name)) issues.push({ code: "DUPLICATE_HEADER", header: name });
    seen.add(name);
  }
  const index: Partial<Record<LogicalField, number>> = {};
  for (const [field, headerName] of Object.entries(mapping)) {
    if (!known.has(field) || typeof headerName !== "string") continue;
    if (FORBIDDEN_HEADER_PATTERN.test(headerName)) {
      issues.push({ code: "FORBIDDEN_COLUMN_MAPPED", header: headerName });
      continue;
    }
    const position = header.indexOf(headerName);
    if (position === -1) issues.push({ code: "SCHEMA_DRIFT_DETECTED", header: headerName, field });
    else index[field as LogicalField] = position;
  }
  const excludeIndexes: number[] = [];
  for (const headerName of rules.excludeWhenFilled) {
    const position = header.indexOf(headerName);
    if (position === -1) issues.push({ code: "SCHEMA_DRIFT_DETECTED", header: headerName, field: "excludeWhenFilled" });
    else excludeIndexes.push(position);
  }
  return { index, issues, rules, excludeIndexes };
}

/** Linha fora do escopo declarado: nao entra, mas nao conta como rejeicao. */
export type SkipReason = "OUT_OF_SCOPE_TYPE" | "EXCLUDED_BY_RULE";

/** Regras ja resolvidas contra o cabecalho + tabelas auxiliares oficiais. */
export type RecordContext = {
  rules?: MappingRules;
  excludeIndexes?: number[];
  /** Codigo IBGE (6 digitos) -> nome oficial do municipio. */
  municipalityNames?: ReadonlyMap<string, string>;
};

export type RejectReason =
  | "COLUMN_COUNT_MISMATCH"
  | "INVALID_CNES"
  | "INVALID_NAME"
  | "INVALID_TYPE_CODE"
  | "TYPE_NAME_UNAVAILABLE"
  | "INVALID_MUNICIPALITY"
  | "INVALID_STATE"
  | "FORMULA_INJECTION"
  | "CONTROL_CHARACTERS"
  | "DUPLICATE_CNES";

export type NormalizedFacility = {
  cnes_code: string;
  official_name: string;
  official_type_code: string;
  official_type_name: string;
  municipality_code: string;
  municipality_name: string | null;
  state_code: string;
  postal_code: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  phone_display: string | null;
  phone_digits: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinate_status: "valid" | "missing" | "invalid";
  source_active: boolean | null;
  source_updated_at: string | null;
};

export type NormalizeResult =
  | { ok: true; facility: NormalizedFacility; warnings: string[] }
  | { ok: false; reason: RejectReason }
  | { ok: false; skipped: SkipReason; typeCode: string | null };

const TEXT_LIMITS = {
  official_name: 200,
  municipality_name: 120,
  address_street: 200,
  address_number: 30,
  address_complement: 120,
  address_district: 120,
} as const;

// `=`, `+`, `-`, `@`, tab, CR no inicio viram formula em planilha (CSV injection).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function clean(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

/** Coordenada decimal (ponto ou virgula). Fora de faixa, (0,0) ou fora do Brasil = invalida. */
export function parseCoordinates(rawLat: string | null, rawLng: string | null) {
  if (rawLat === null && rawLng === null) return { latitude: null, longitude: null, status: "missing" as const };
  const toNumber = (raw: string | null) => {
    if (raw === null || !/^-?\d{1,3}([.,]\d{1,12})?$/.test(raw)) return Number.NaN;
    return Number(raw.replace(",", "."));
  };
  const lat = toNumber(rawLat);
  const lng = toNumber(rawLng);
  const inRange = Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  // Caixa envolvente do Brasil com folga: ponto fora dela nao e uma unidade brasileira.
  const inBrazil = inRange && lat >= -34.5 && lat <= 6 && lng >= -74.5 && lng <= -28.5;
  if (!inBrazil || (lat === 0 && lng === 0)) return { latitude: null, longitude: null, status: "invalid" as const };
  return { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6, status: "valid" as const };
}

/**
 * Telefone: exibe o literal se seguro; `tel:` so com DDD (10-13 digitos).
 * Numero de 8-9 digitos (sem DDD; 44.856 no arquivo oficial, L-368) continua
 * visivel, mas nao vira `tel:`: discado de outra area, ligaria para outro
 * numero. Nunca URL.
 */
export function parsePhone(raw: string | null) {
  if (raw === null) return { display: null, digits: null, noAreaCode: false };
  const safeDisplay = raw.length <= 40 && /^[0-9()\s+\-.]+$/.test(raw) ? raw : null;
  const digits = raw.replace(/\D/g, "");
  return {
    display: safeDisplay,
    digits: safeDisplay && /^[0-9]{10,13}$/.test(digits) ? digits : null,
    noAreaCode: safeDisplay !== null && /^[0-9]{8,9}$/.test(digits),
  };
}

function parseActive(raw: string | null): boolean | null {
  if (raw === null) return null;
  const value = raw.toUpperCase();
  if (["1", "S", "SIM", "ATIVO", "TRUE"].includes(value)) return true;
  if (["0", "N", "NAO", "NÃO", "INATIVO", "DESATIVADO", "FALSE"].includes(value)) return false;
  return null;
}

function parseDate(raw: string | null): string | null {
  if (raw === null) return null;
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return null;
}

/**
 * Um registro do arquivo -> linha da projecao, ou motivo de rejeicao.
 * Politica (ADR-0031): problema de identidade/localidade = REJECT_RECORD;
 * problema em campo opcional = campo nulo + aviso (a unidade continua).
 */
export function normalizeRecord(
  fields: string[],
  headerLength: number,
  index: Partial<Record<LogicalField, number>>,
  typeNames: ReadonlyMap<string, string>,
  context: RecordContext = {},
): NormalizeResult {
  if (fields.length !== headerLength) return { ok: false, reason: "COLUMN_COUNT_MISMATCH" };
  const get = (field: LogicalField) => (index[field] === undefined ? null : clean(fields[index[field]!]));
  const warnings: string[] = [];
  const zeroPad = context.rules?.zeroPad ?? {};

  for (const value of fields) {
    if (CONTROL_CHARS.test(value)) return { ok: false, reason: "CONTROL_CHARACTERS" };
  }

  // Escopo antes da validacao: linha fora do escopo nao e "erro" do arquivo.
  const typeCode = applyZeroPad(get("official_type_code"), zeroPad.official_type_code);
  for (const position of context.excludeIndexes ?? []) {
    if (clean(fields[position]) !== null) return { ok: false, skipped: "EXCLUDED_BY_RULE", typeCode };
  }
  const allowlist = context.rules?.typeAllowlist;
  if (allowlist && (typeCode === null || !allowlist.has(typeCode))) {
    return { ok: false, skipped: "OUT_OF_SCOPE_TYPE", typeCode };
  }

  const cnes = applyZeroPad(get("cnes_code"), zeroPad.cnes_code);
  if (!cnes || !/^[0-9]{7}$/.test(cnes)) return { ok: false, reason: "INVALID_CNES" };

  const name = get("official_name");
  if (!name || name.length < 2 || name.length > TEXT_LIMITS.official_name) return { ok: false, reason: "INVALID_NAME" };

  if (!typeCode || !CODE_PATTERN.test(typeCode)) return { ok: false, reason: "INVALID_TYPE_CODE" };

  const municipality = get("municipality_code");
  if (!municipality || !/^[0-9]{6,7}$/.test(municipality)) return { ok: false, reason: "INVALID_MUNICIPALITY" };

  const rawState = get("state_code");
  const state = rawState && /^[0-9]{2}$/.test(rawState) ? (UF_BY_IBGE[rawState] ?? null) : rawState?.toUpperCase() ?? null;
  if (!state || !UF_SET.has(state)) return { ok: false, reason: "INVALID_STATE" };
  // O prefixo do codigo IBGE do municipio e a UF: incoerencia = rejeicao.
  if (UF_BY_IBGE[municipality.slice(0, 2)] !== state) return { ok: false, reason: "INVALID_MUNICIPALITY" };

  // Nome do tipo por ultimo: o relatorio mostra os outros defeitos primeiro.
  const typeName = get("official_type_name") ?? typeNames.get(typeCode) ?? null;
  if (!typeName || typeName.length > 200) return { ok: false, reason: "TYPE_NAME_UNAVAILABLE" };

  const optionalText = (field: keyof typeof TEXT_LIMITS) => {
    const value = get(field);
    if (value !== null && value.length > TEXT_LIMITS[field]) {
      warnings.push(`${field}_TOO_LONG`);
      return null;
    }
    return value;
  };
  let municipalityName = optionalText("municipality_name");
  if (municipalityName === null && context.municipalityNames) {
    municipalityName = context.municipalityNames.get(municipality.slice(0, 6)) ?? null;
    if (municipalityName !== null && municipalityName.length > TEXT_LIMITS.municipality_name) municipalityName = null;
    if (municipalityName === null) warnings.push("MUNICIPALITY_NAME_UNAVAILABLE");
  }
  const text = {
    municipality_name: municipalityName,
    address_street: optionalText("address_street"),
    address_number: optionalText("address_number"),
    address_complement: optionalText("address_complement"),
    address_district: optionalText("address_district"),
  };
  for (const value of [name, typeName, ...Object.values(text)]) {
    if (value !== null && FORMULA_PREFIX.test(value)) return { ok: false, reason: "FORMULA_INJECTION" };
  }

  const rawPostal = get("postal_code");
  const postalDigits = rawPostal?.replace(/\D/g, "") ?? null;
  const postal = postalDigits && /^[0-9]{8}$/.test(postalDigits) ? postalDigits : null;
  if (rawPostal && !postal) warnings.push("POSTAL_CODE_INVALID");

  const coordinates = parseCoordinates(get("latitude"), get("longitude"));
  if (coordinates.status === "invalid") warnings.push("COORDINATES_INVALID");

  const phone = parsePhone(get("phone"));
  if (get("phone") && !phone.digits) warnings.push(phone.noAreaCode ? "PHONE_NO_AREA_CODE" : "PHONE_INVALID");

  return {
    ok: true,
    warnings,
    facility: {
      cnes_code: cnes,
      official_name: name,
      official_type_code: typeCode,
      official_type_name: typeName,
      municipality_code: municipality,
      state_code: state,
      postal_code: postal,
      ...text,
      phone_display: phone.display,
      phone_digits: phone.digits,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      coordinate_status: coordinates.status,
      source_active: parseActive(get("source_active")),
      source_updated_at: parseDate(get("source_updated_at")),
    },
  };
}

/** Politica de falha da importacao inteira (fail-closed). */
export const IMPORT_POLICY = {
  maxFileBytes: 1_500_000_000,
  maxRecords: 2_000_000,
  /** Acima disso de rejeicao, o arquivo e suspeito: nada e publicado. */
  maxRejectRatio: 0.05,
} as const;
