

/**
 * Versao da normalizacao.
 *
 * Numeros medidos sob normalizacoes diferentes nao sao comparaveis. Sem esta
 * versao, uma comparacao entre a medicao de hoje e a de dois meses atras
 * pareceria uma melhora do modelo quando foi so uma mudanca de regra.
 */
export const ASR_QA_NORMALIZATION_VERSION = 1;

/**
 * Normalizacao **conservadora**, e deliberadamente pequena.
 *
 * A tentacao em QA de ASR e normalizar ate os numeros ficarem bonitos. Cada
 * regra a mais esconde uma classe de erro real, entao aqui so entra o que nao
 * muda o que foi dito:
 *
 * - caixa: "Ana" e "ana" sao a mesma palavra dita; trocar "Ana" por "Alice"
 *   continua aparecendo como substituicao.
 * - pontuacao de borda: o Whisper pontua por conta propria, e a pontuacao nao
 *   foi falada.
 * - espaco repetido.
 *
 * O que **nao** entra, e por que:
 *
 * - digito <-> extenso: colapsar "5" e "cinco" esconderia `changed_number`.
 * - acentuacao: "e" e "é" sao palavras diferentes em portugues.
 * - stopwords, stemming, lematizacao: apagariam `added_word` e `omitted_span`,
 *   e "nao" e uma stopword em quase toda lista pronta — a negacao sumiria.
 */
export function normalizeForQa(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.,;:!?"“”'‘’()\[\]—–]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function tokenize(text: string): string[] {
  const normalized = text.trim();
  return normalized === "" ? [] : normalized.split(/\s+/u);
}

export interface ErrorCounts {
  substitutions: number;
  deletions: number;
  insertions: number;
  /** Tamanho da referencia — o denominador. */
  referenceLength: number;
}

export interface RateResult extends ErrorCounts {
  /**
   * `(S + D + I) / N`.
   *
   * Pode passar de 1: um reconhecedor que inventa texto acumula insercoes sem
   * limite. Nao truncamos em 1 — um WER de 1.8 e informacao, e escondê-lo faria
   * fabricacao parecer erro comum.
   */
  rate: number;
}

/**
 * Alinhamento de Levenshtein com rastreio das tres operacoes.
 *
 * Programacao dinamica classica, O(n*m). As fixtures de QA sao frases, e nao
 * livros; a versao com duas linhas so serviria para nao poder recuperar o
 * caminho, que e justamente o que a revisao semantica precisa ler.
 */
export function align<T>(reference: T[], candidate: T[]): ErrorCounts {
  const n = reference.length;
  const m = candidate.length;
  const cost: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = 0; i <= n; i += 1) cost[i]![0] = i;
  for (let j = 0; j <= m; j += 1) cost[0]![j] = j;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const same = reference[i - 1] === candidate[j - 1];
      cost[i]![j] = Math.min(
        cost[i - 1]![j]! + 1, // delecao: a referencia tinha, o candidato nao
        cost[i]![j - 1]! + 1, // insercao: o candidato tem, a referencia nao
        cost[i - 1]![j - 1]! + (same ? 0 : 1), // substituicao
      );
    }
  }

  // Retrocede pelo caminho otimo para separar S, D e I. O total delas e a
  // distancia; a separacao e o que permite distinguir "engoliu metade" de
  // "inventou o dobro", que tem o mesmo numero e significados opostos.
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const same = reference[i - 1] === candidate[j - 1];
      if (cost[i]![j] === cost[i - 1]![j - 1]! + (same ? 0 : 1)) {
        if (!same) substitutions += 1;
        i -= 1;
        j -= 1;
        continue;
      }
    }
    if (i > 0 && cost[i]![j] === cost[i - 1]![j]! + 1) {
      deletions += 1;
      i -= 1;
      continue;
    }
    insertions += 1;
    j -= 1;
  }

  return { substitutions, deletions, insertions, referenceLength: n };
}

function toRate(counts: ErrorCounts): RateResult {
  const errors = counts.substitutions + counts.deletions + counts.insertions;
  return {
    ...counts,
    /*
      Referencia vazia nao tem taxa de erro definida. Devolver 0 diria "perfeito"
      para uma medicao que nao aconteceu, e ABSENCE > FABRICATION vale aqui
      tambem: sem referencia, o unico numero honesto para um candidato que
      inventou texto e um WER que cresce com o que ele inventou.
    */
    rate: counts.referenceLength === 0 ? (errors === 0 ? 0 : Number.POSITIVE_INFINITY) : errors / counts.referenceLength,
  };
}

/** WER sobre o texto cru, sem normalizacao alguma. */
export function werRaw(reference: string, candidate: string): RateResult {
  return toRate(align(tokenize(reference), tokenize(candidate)));
}

/** WER sobre o texto normalizado pela versao `ASR_QA_NORMALIZATION_VERSION`. */
export function werNormalized(reference: string, candidate: string): RateResult {
  return toRate(
    align(tokenize(normalizeForQa(reference)), tokenize(normalizeForQa(candidate))),
  );
}

/**
 * CER, sobre caracteres do texto normalizado.
 *
 * Usa `Array.from` para contar por ponto de codigo: em pt-BR "ç" e "ã" sao um
 * caractere cada, e conta-los como dois inflaria o denominador exatamente nas
 * palavras que mais interessam.
 */
export function cer(reference: string, candidate: string): RateResult {
  return toRate(
    align(
      Array.from(normalizeForQa(reference).replace(/\s/gu, "")),
      Array.from(normalizeForQa(candidate).replace(/\s/gu, "")),
    ),
  );
}

export interface QualityMeasurement {
  normalizationVersion: number;
  werRaw: RateResult;
  werNormalized: RateResult;
  cer: RateResult;
}

export function measureQuality(reference: string, candidate: string): QualityMeasurement {
  return {
    normalizationVersion: ASR_QA_NORMALIZATION_VERSION,
    werRaw: werRaw(reference, candidate),
    werNormalized: werNormalized(reference, candidate),
    cer: cer(reference, candidate),
  };
}
