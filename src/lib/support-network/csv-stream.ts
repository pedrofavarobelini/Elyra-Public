/**
 * Leitor CSV em streaming (SUP-1). Sem dependencia nova e sem carregar o
 * arquivo inteiro: recebe pedacos de texto ja decodificados e emite registros.
 *
 * RFC 4180 com delimitador configuravel: aspas escapam delimitador, quebra de
 * linha e aspas duplicadas (""). Limites duros contra arquivo hostil: tamanho
 * de campo e numero de colunas. Estourar limite nao e "cortar e seguir": e erro
 * com posicao, e o importador decide (rejeitar a linha ou falhar a importacao).
 */

export type CsvLimits = { maxFieldLength: number; maxColumns: number };

export const DEFAULT_CSV_LIMITS: CsvLimits = { maxFieldLength: 4000, maxColumns: 400 };

export type CsvFormatCode = "CSV_FIELD_TOO_LARGE" | "CSV_TOO_MANY_COLUMNS" | "CSV_UNTERMINATED_QUOTE" | "CSV_BAD_QUOTE";

// Campos explicitos (sem "parameter properties"): o importador Node le este
// arquivo com type stripping, que nao aceita sintaxe que gera codigo.
export class CsvFormatError extends Error {
  readonly code: CsvFormatCode;
  readonly line: number;

  constructor(code: CsvFormatCode, line: number) {
    super(`${code} na linha ${line}`);
    this.name = "CsvFormatError";
    this.code = code;
    this.line = line;
  }
}

export async function* parseCsvStream(
  chunks: AsyncIterable<string> | Iterable<string>,
  delimiter: string,
  limits: CsvLimits = DEFAULT_CSV_LIMITS,
): AsyncGenerator<{ fields: string[]; line: number }> {
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\n" || delimiter === "\r") {
    throw new Error("delimitador invalido");
  }
  let field = "";
  let fields: string[] = [];
  let quoted = false;
  let afterQuote = false;
  let pendingQuote = false;
  let line = 1;
  let recordLine = 1;
  let pendingCr = false;

  const pushField = () => {
    fields.push(field);
    field = "";
    afterQuote = false;
    if (fields.length > limits.maxColumns) throw new CsvFormatError("CSV_TOO_MANY_COLUMNS", recordLine);
  };

  for await (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const char = chunk[i]!;
      if (pendingCr) {
        pendingCr = false;
        if (char === "\n") continue;
      }
      if (pendingQuote) {
        pendingQuote = false;
        if (char === '"') {
          field += '"';
          continue;
        }
        quoted = false;
        afterQuote = true;
      }
      if (quoted) {
        if (char === '"') {
          pendingQuote = true;
        } else {
          if (char === "\n") line += 1;
          field += char;
          if (field.length > limits.maxFieldLength) throw new CsvFormatError("CSV_FIELD_TOO_LARGE", recordLine);
        }
        continue;
      }
      if (char === delimiter) {
        pushField();
      } else if (char === "\n" || char === "\r") {
        pushField();
        const record = fields;
        fields = [];
        if (char === "\r") pendingCr = true;
        const at = recordLine;
        line += 1;
        recordLine = line;
        if (!(record.length === 1 && record[0] === "")) yield { fields: record, line: at };
      } else if (char === '"') {
        if (field.length > 0 || afterQuote) throw new CsvFormatError("CSV_BAD_QUOTE", recordLine);
        quoted = true;
      } else {
        if (afterQuote) throw new CsvFormatError("CSV_BAD_QUOTE", recordLine);
        field += char;
        if (field.length > limits.maxFieldLength) throw new CsvFormatError("CSV_FIELD_TOO_LARGE", recordLine);
      }
    }
  }
  if (pendingQuote) {
    quoted = false;
  }
  if (quoted) throw new CsvFormatError("CSV_UNTERMINATED_QUOTE", recordLine);
  if (field.length > 0 || fields.length > 0) {
    pushField();
    yield { fields, line: recordLine };
  }
}
