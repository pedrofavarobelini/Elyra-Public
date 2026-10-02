import { describe, expect, it } from "vitest";

import { supportFreshness } from "../contracts/support-network";
import { parseCsvStream, CsvFormatError } from "./csv-stream.ts";
import { applyZeroPad, normalizeRecord, parseCoordinates, parsePhone, resolveHeader } from "./cnes-record.ts";
import { ImportFailure, runImportPipeline, type ImportBatch } from "./import-pipeline.ts";

const MAPPING = {
  cnes_code: "CNES",
  official_name: "NOME",
  official_type_code: "TIPO",
  official_type_name: "TIPO_NOME",
  municipality_code: "MUN",
  state_code: "UF",
  phone: "TEL",
  latitude: "LAT",
  longitude: "LNG",
  source_active: "ATIVO",
};
const HEADER = "CNES;NOME;TIPO;TIPO_NOME;MUN;UF;TEL;LAT;LNG;ATIVO";

async function collect(text: string, delimiter = ";") {
  const out: string[][] = [];
  for await (const record of parseCsvStream([text], delimiter)) out.push(record.fields);
  return out;
}

async function run(lines: string[], extra: Partial<Parameters<typeof runImportPipeline>[0]> = {}) {
  const batches: ImportBatch[] = [];
  const report = await runImportPipeline({
    chunks: [lines.join("\n")],
    delimiter: ";",
    mapping: MAPPING,
    onBatch: async (batch) => {
      batches.push(batch);
    },
    maxRejectRatio: 1,
    ...extra,
  });
  return { report, batches, facilities: batches.flatMap((batch) => batch.facilities) };
}

describe("CSV em streaming", () => {
  it("aspas, delimitador e quebra de linha dentro do campo; CRLF", async () => {
    expect(await collect('a;"b;c";"d""e"\r\n1;"x\ny";z\r\n')).toEqual([
      ["a", "b;c", 'd"e'],
      ["1", "x\ny", "z"],
    ]);
  });

  it("registro dividido entre pedacos continua inteiro", async () => {
    const out: string[][] = [];
    for await (const record of parseCsvStream(['a;"b', '";c\n1', ";2;3\n"], ";")) out.push(record.fields);
    expect(out).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("recusa aspas nao fechadas, campo gigante e colunas demais", async () => {
    await expect(collect('a;"b\n')).rejects.toBeInstanceOf(CsvFormatError);
    await expect(
      (async () => {
        for await (const record of parseCsvStream(["x".repeat(50) + "\n"], ";", { maxFieldLength: 10, maxColumns: 5 })) void record;
      })(),
    ).rejects.toMatchObject({ code: "CSV_FIELD_TOO_LARGE" });
    await expect(
      (async () => {
        for await (const record of parseCsvStream(["a;b;c;d;e;f;g\n"], ";", { maxFieldLength: 10, maxColumns: 5 })) void record;
      })(),
    ).rejects.toMatchObject({ code: "CSV_TOO_MANY_COLUMNS" });
  });
});

describe("mapeamento x cabecalho", () => {
  it("coluna mapeada ausente = SCHEMA_DRIFT_DETECTED", () => {
    const { issues } = resolveHeader(["CNES", "NOME"], MAPPING);
    expect(issues.some((issue) => issue.code === "SCHEMA_DRIFT_DETECTED")).toBe(true);
  });
  it("cabecalho duplicado, campo desconhecido e coluna pessoal sao recusados", () => {
    expect(resolveHeader(["CNES", "CNES"], MAPPING).issues.some((i) => i.code === "DUPLICATE_HEADER")).toBe(true);
    expect(resolveHeader(HEADER.split(";"), { ...MAPPING, extra: "X" }).issues[0]?.code).toBe("MAPPING_UNKNOWN_FIELD");
    expect(
      resolveHeader([...HEADER.split(";"), "NU_CPF"], { ...MAPPING, municipality_name: "NU_CPF" }).issues[0]?.code,
    ).toBe("FORBIDDEN_COLUMN_MAPPED");
  });
});

describe("normalizacao minima", () => {
  const header = HEADER.split(";");
  const { index } = resolveHeader(header, MAPPING);
  const row = (overrides: Partial<Record<string, string>> = {}) => {
    const base: Record<string, string> = {
      CNES: "9900001", NOME: "  UBS Ficticia  ", TIPO: "02", TIPO_NOME: "CENTRO DE SAUDE/UNIDADE BASICA",
      MUN: "355030", UF: "SP", TEL: "(11) 3000-0001", LAT: "-23,55", LNG: "-46.63", ATIVO: "S", ...overrides,
    };
    return header.map((name) => base[name] ?? "");
  };

  it("trim, valores literais, coordenada com virgula, UF por codigo IBGE", () => {
    const result = normalizeRecord(row({ UF: "35" }), header.length, index, new Map());
    expect(result).toMatchObject({
      ok: true,
      facility: {
        official_name: "UBS Ficticia",
        state_code: "SP",
        latitude: -23.55,
        longitude: -46.63,
        coordinate_status: "valid",
        phone_digits: "1130000001",
        source_active: true,
      },
    });
  });

  it("rejeita identidade invalida e injecao; mantem unidade com opcional ruim", () => {
    expect(normalizeRecord(row({ CNES: "12" }), header.length, index, new Map())).toEqual({ ok: false, reason: "INVALID_CNES" });
    expect(normalizeRecord(row({ UF: "XX" }), header.length, index, new Map())).toEqual({ ok: false, reason: "INVALID_STATE" });
    expect(normalizeRecord(row({ UF: "RJ" }), header.length, index, new Map())).toEqual({ ok: false, reason: "INVALID_MUNICIPALITY" });
    expect(normalizeRecord(row({ NOME: "=HYPERLINK(\"x\")" }), header.length, index, new Map())).toEqual({ ok: false, reason: "FORMULA_INJECTION" });
    expect(normalizeRecord(row({ NOME: "ab\u0000c" }), header.length, index, new Map())).toEqual({ ok: false, reason: "CONTROL_CHARACTERS" });
    expect(normalizeRecord(row({ TIPO_NOME: "" }), header.length, index, new Map())).toEqual({ ok: false, reason: "TYPE_NAME_UNAVAILABLE" });
    expect(normalizeRecord(row().slice(1), header.length, index, new Map())).toEqual({ ok: false, reason: "COLUMN_COUNT_MISMATCH" });
    const badOptional = normalizeRecord(row({ LAT: "0", LNG: "0", TEL: "javascript:alert(1)" }), header.length, index, new Map());
    expect(badOptional).toMatchObject({ ok: true, facility: { coordinate_status: "invalid", latitude: null, phone_display: null, phone_digits: null } });
  });

  it("coordenada: faixa, (0,0), fora do Brasil, lixo", () => {
    expect(parseCoordinates("95", "10").status).toBe("invalid");
    expect(parseCoordinates("40.7", "-74.0").status).toBe("invalid");
    expect(parseCoordinates("-23.5", null).status).toBe("invalid");
    expect(parseCoordinates(null, null).status).toBe("missing");
    expect(parseCoordinates("1e3", "2").status).toBe("invalid");
  });

  it("telefone nunca vira URL", () => {
    expect(parsePhone("tel:+551130000001")).toEqual({ display: null, digits: null, noAreaCode: false });
    expect(parsePhone("+55 (11) 3000-0001")).toEqual({ display: "+55 (11) 3000-0001", digits: "551130000001", noAreaCode: false });
  });

  it("telefone sem DDD fica visivel, mas nao vira tel: (L-368)", () => {
    expect(parsePhone("3522-1848")).toEqual({ display: "3522-1848", digits: null, noAreaCode: true });
    expect(parsePhone("(81)35221848")).toMatchObject({ digits: "8135221848" });
    const result = normalizeRecord(row({ TEL: "3522-1848" }), header.length, index, new Map());
    expect(result).toMatchObject({ ok: true, warnings: ["PHONE_NO_AREA_CODE"], facility: { phone_display: "3522-1848", phone_digits: null } });
  });
});

describe("pipeline", () => {
  it("lotes com tipos antes das linhas, duplicata rejeitada, relatorio sem conteudo", async () => {
    const { report, batches, facilities } = await run(
      [
        HEADER,
        "9900001;UBS A;02;CENTRO DE SAUDE/UNIDADE BASICA;355030;SP;;;;S",
        "9900001;UBS A repetida;02;CENTRO DE SAUDE/UNIDADE BASICA;355030;SP;;;;S",
        "9900002;CAPS B;70;CENTRO DE ATENCAO PSICOSSOCIAL;355030;SP;;;;N",
        "abc;Invalida;02;X;355030;SP;;;;S",
      ],
      { batchSize: 1 },
    );
    expect(report).toMatchObject({ recordCount: 4, acceptedCount: 2, rejectedCount: 2, typeCount: 2 });
    expect(report.rejectedByReason).toEqual({ DUPLICATE_CNES: 1, INVALID_CNES: 1 });
    expect(batches[0]?.newTypes).toEqual([{ code: "02", name: "CENTRO DE SAUDE/UNIDADE BASICA" }]);
    expect(facilities.map((facility) => facility.source_active)).toEqual([true, false]);
    expect(JSON.stringify(report)).not.toContain("UBS A");
  });

  it("drift de cabecalho e rejeicao acima do limite falham a importacao inteira", async () => {
    await expect(run(["CNES;NOME", "9900001;X"])).rejects.toMatchObject({ code: "SCHEMA_DRIFT_DETECTED" });
    await expect(
      run([HEADER, "abc;X;02;T;355030;SP;;;;", "9900001;UBS;02;T;355030;SP;;;;"], { maxRejectRatio: 0.05 }),
    ).rejects.toMatchObject({ code: "REJECT_RATIO_EXCEEDED" });
    await expect(run([HEADER])).rejects.toBeInstanceOf(ImportFailure);
    await expect(run([])).rejects.toMatchObject({ code: "EMPTY_FILE" });
    await expect(run([HEADER, '9900001;"UBS;02'])).rejects.toMatchObject({ code: "CSV_MALFORMED" });
  });

  it("nome do tipo por tabela auxiliar quando o arquivo nao traz a coluna", async () => {
    const { official_type_name: _unused, ...mapping } = MAPPING;
    void _unused;
    const { facilities } = await run([HEADER, "9900001;UBS;02;;355030;SP;;;;"], {
      mapping,
      typeNames: new Map([["02", "CENTRO DE SAUDE/UNIDADE BASICA"]]),
    });
    expect(facilities[0]?.official_type_name).toBe("CENTRO DE SAUDE/UNIDADE BASICA");
  });
});

// Cabecalho REAL do arquivo oficial (26/09/2026), recortado; valores ficticios.
const REAL_HEADER = "CO_CNES;CO_UNIDADE;CO_UF;CO_IBGE;NU_CNPJ;NO_RAZAO_SOCIAL;NO_FANTASIA;TP_UNIDADE;NU_TELEFONE;NU_LATITUDE;NU_LONGITUDE;NO_EMAIL;CO_MOTIVO_DESAB";
const REAL_MAPPING = {
  cnes_code: "CO_CNES",
  official_name: "NO_FANTASIA",
  official_type_code: "TP_UNIDADE",
  municipality_code: "CO_IBGE",
  state_code: "CO_UF",
  phone: "NU_TELEFONE",
  latitude: "NU_LATITUDE",
  longitude: "NU_LONGITUDE",
  $rules: { zeroPad: { cnes_code: 7, official_type_code: 2 }, typeAllowlist: ["02", "70"], excludeWhenFilled: ["CO_MOTIVO_DESAB"] },
};
const REAL_TYPES = new Map([["02", "[DEMO] TIPO 02"], ["70", "[DEMO] TIPO 70"]]);

describe("regras declarativas do mapeamento (arquivo oficial real)", () => {
  it("zero-pad so em codigo de digitos que cabe na largura", () => {
    expect(applyZeroPad("19", 7)).toBe("0000019");
    expect(applyZeroPad("2", 2)).toBe("02");
    expect(applyZeroPad("12345678", 7)).toBe("12345678");
    expect(applyZeroPad("A1", 7)).toBe("A1");
    expect(applyZeroPad(null, 7)).toBeNull();
    expect(applyZeroPad("19", undefined)).toBe("19");
  });

  it("regra desconhecida, largura invalida, campo nao paddable e coluna de exclusao ausente sao recusados", () => {
    const header = REAL_HEADER.split(";");
    const codes = (rules: unknown) => resolveHeader(header, { ...REAL_MAPPING, $rules: rules }).issues.map((i) => Object.values(i).join(":"));
    expect(codes({ guess: true })).toEqual(["MAPPING_RULE_INVALID:guess"]);
    expect(codes({ zeroPad: { cnes_code: 0 } })).toEqual(["MAPPING_RULE_INVALID:zeroPad.cnes_code"]);
    expect(codes({ zeroPad: { official_name: 3 } })).toEqual(["MAPPING_RULE_INVALID:zeroPad.official_name"]);
    expect(codes({ typeAllowlist: [] })).toEqual(["MAPPING_RULE_INVALID:typeAllowlist"]);
    expect(codes({ excludeWhenFilled: ["NAO_EXISTE"] })).toEqual(["SCHEMA_DRIFT_DETECTED:NAO_EXISTE:excludeWhenFilled"]);
    expect(codes("x")).toEqual(["MAPPING_RULE_INVALID:$rules"]);
  });

  it("CNPJ, razao social e e-mail nunca podem ser mapeados (L-367)", () => {
    const header = REAL_HEADER.split(";");
    for (const column of ["NU_CNPJ", "NO_RAZAO_SOCIAL", "NO_EMAIL"]) {
      expect(resolveHeader(header, { ...REAL_MAPPING, official_name: column }).issues[0]?.code).toBe("FORBIDDEN_COLUMN_MAPPED");
    }
  });

  it("pad, allowlist e exclusao: fora do escopo nao e rejeicao; selo confere o escopo", async () => {
    const { report, facilities } = await run(
      [
        REAL_HEADER,
        "19;3534700000019;35;353470;;;UBS DEMO;2;(16)30000001;-20.72;-47.88;;",
        "20;3534700000020;35;353470;;;CAPS DEMO;70;30000002;-20.72;-47.88;;",
        "21;3534700000021;35;353470;;;CONSULTORIO DEMO;22;(16)30000003;-20.72;-47.88;;",
        "22;3534700000022;35;353470;;;UBS DESATIVADA DEMO;2;;;;;08",
        "23;3534700000023;35;353470;;;;2;;;;;",
      ],
      { mapping: REAL_MAPPING, typeNames: REAL_TYPES, municipalityNames: new Map([["353470", "Orlândia [DEMO]"]]) },
    );
    expect(facilities.map((f) => [f.cnes_code, f.official_type_code, f.state_code, f.municipality_name, f.phone_digits])).toEqual([
      ["0000019", "02", "SP", "Orlândia [DEMO]", "1630000001"],
      ["0000020", "70", "SP", "Orlândia [DEMO]", null],
    ]);
    expect(report).toMatchObject({
      recordCount: 5,
      skippedCount: 2,
      skippedByReason: { OUT_OF_SCOPE_TYPE: 1, EXCLUDED_BY_RULE: 1 },
      inScopeCount: 3,
      acceptedCount: 2,
      rejectedCount: 1,
      rejectedByReason: { INVALID_NAME: 1 },
      acceptedByType: { "02": 1, "70": 1 },
      missingPhones: 1,
      warnings: { PHONE_NO_AREA_CODE: 1 },
    });
    expect(report.acceptedCount + report.rejectedCount).toBe(report.inScopeCount);
  });

  it("tipo em escopo sem nome oficial: conta em unknown_types e o relatorio parcial sobrevive a falha", async () => {
    const failure = await run([REAL_HEADER, "19;3534700000019;35;353470;;;UBS DEMO;2;;;;;"], { mapping: REAL_MAPPING }).catch((error) => error);
    expect(failure).toBeInstanceOf(ImportFailure);
    expect(failure.code).toBe("NO_ACCEPTED_RECORDS");
    expect(failure.report).toMatchObject({ unknownTypes: { "02": 1 }, rejectedByReason: { TYPE_NAME_UNAVAILABLE: 1 } });
  });

  it("municipio sem nome na tabela auxiliar gera aviso, nao rejeicao", async () => {
    const { report, facilities } = await run([REAL_HEADER, "19;3534700000019;35;353470;;;UBS DEMO;2;;;;;"], {
      mapping: REAL_MAPPING,
      typeNames: REAL_TYPES,
      municipalityNames: new Map(),
    });
    expect(facilities[0]?.municipality_name).toBeNull();
    expect(report.warnings).toMatchObject({ MUNICIPALITY_NAME_UNAVAILABLE: 1 });
  });
});

describe("frescor (contrato unico)", () => {
  it("CURRENT ate 45 dias, AGING ate 90, STALE depois ou invalido", () => {
    expect(supportFreshness(0)).toBe("CURRENT");
    expect(supportFreshness(45)).toBe("CURRENT");
    expect(supportFreshness(46)).toBe("AGING");
    expect(supportFreshness(90)).toBe("AGING");
    expect(supportFreshness(91)).toBe("STALE");
    expect(supportFreshness(-1)).toBe("STALE");
    expect(supportFreshness(Number.NaN)).toBe("STALE");
  });
});
