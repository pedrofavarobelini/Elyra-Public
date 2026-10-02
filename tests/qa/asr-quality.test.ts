import { describe, expect, it } from "vitest";

import {
  ASR_QA_NORMALIZATION_VERSION,
  align,
  cer,
  measureQuality,
  normalizeForQa,
  tokenize,
  werNormalized,
  werRaw,
} from "./asr-quality";
import {
  ASR_FIXTURE_BLOCKS,
  ASR_FIXTURE_ID,
  fixtureReference,
} from "./asr-fixture-pt-br";
import {
  BLOCKING_SEMANTIC_ERRORS,
  countByKind,
  hasBlockingError,
  type SemanticReview,
} from "./semantic-review";

describe("alinhamento", () => {
  it("separa substituicao, delecao e insercao", () => {
    // referencia: a b c  |  candidato: a x c d  -> 1 substituicao, 1 insercao
    const counts = align(["a", "b", "c"], ["a", "x", "c", "d"]);
    expect(counts).toEqual({
      substitutions: 1,
      deletions: 0,
      insertions: 1,
      referenceLength: 3,
    });
  });

  it("candidato vazio e delecao pura", () => {
    expect(align(["a", "b"], [])).toEqual({
      substitutions: 0,
      deletions: 2,
      insertions: 0,
      referenceLength: 2,
    });
  });
});

describe("WER", () => {
  it("WER = (S+D+I)/N", () => {
    const result = werRaw("um dois tres quatro", "um dois tres quatro");
    expect(result.rate).toBe(0);

    // Uma palavra trocada em quatro.
    expect(werRaw("um dois tres quatro", "um dois nove quatro").rate).toBeCloseTo(0.25);
  });

  it("passa de 1 quando o reconhecedor inventa texto", () => {
    /*
      Truncar em 1 faria fabricacao parecer erro comum. Um WER de 1.5 e
      informacao, e a informacao e "o modelo devolveu mais do que foi dito".
    */
    const result = werRaw("um dois", "um dois tres quatro cinco");
    expect(result.rate).toBeGreaterThan(1);
    expect(result.insertions).toBe(3);
  });

  it("referencia vazia com candidato inventado nao vale zero", () => {
    // Zero diria "perfeito" para uma medicao que nao aconteceu.
    expect(werRaw("", "texto que ninguem falou").rate).toBe(Number.POSITIVE_INFINITY);
    expect(werRaw("", "").rate).toBe(0);
  });
});

describe("normalizacao conservadora", () => {
  it("ignora caixa e pontuacao, que nao foram faladas", () => {
    expect(normalizeForQa("Olá, tudo bem?")).toBe("olá tudo bem");
    expect(werNormalized("Olá, tudo bem?", "ola tudo bem").rate).toBeGreaterThan(0);
    expect(werNormalized("Olá, tudo bem?", "olá tudo bem").rate).toBe(0);
  });

  it("NAO esconde negacao perdida", () => {
    const result = werNormalized("eu não consegui terminar", "eu consegui terminar");
    expect(result.rate).toBeGreaterThan(0);
    expect(result.deletions).toBe(1);
  });

  it("NAO esconde numero trocado", () => {
    expect(werNormalized("comprei 3 cadernos", "comprei 8 cadernos").rate).toBeGreaterThan(0);
  });

  it("NAO colapsa digito e extenso", () => {
    // Colapsar esconderia `changed_number`: "5" e "cinco" seguem distintos.
    expect(werNormalized("eram 5 pessoas", "eram cinco pessoas").rate).toBeGreaterThan(0);
  });

  it("NAO esconde nome trocado", () => {
    expect(werNormalized("falei com Ana", "falei com Alice").rate).toBeGreaterThan(0);
    // Mas caixa sozinha nao e erro: a pessoa nao fala maiuscula.
    expect(werNormalized("falei com Ana", "falei com ana").rate).toBe(0);
  });

  it("NAO esconde palavra acrescentada nem trecho omitido", () => {
    expect(werNormalized("vou sair agora", "vou sair correndo agora").insertions).toBe(1);
    expect(werNormalized("vou sair agora mesmo", "vou sair").deletions).toBe(2);
  });

  it("acentuacao continua distinguindo palavras do portugues", () => {
    expect(normalizeForQa("é")).not.toBe(normalizeForQa("e"));
  });

  it("a versao da normalizacao acompanha a medicao", () => {
    expect(measureQuality("a b", "a b").normalizationVersion).toBe(
      ASR_QA_NORMALIZATION_VERSION,
    );
  });
});

describe("CER", () => {
  it("conta por ponto de codigo, e nao por byte", () => {
    // "ç" e um caractere falado, e nao dois.
    expect(Array.from("ação")).toHaveLength(4);
    expect(cer("ação", "ação").rate).toBe(0);
    expect(cer("ação", "acao").referenceLength).toBe(4);
  });

  it("um caractere trocado em dez", () => {
    expect(cer("abcdefghij", "abcdefghix").rate).toBeCloseTo(0.1);
  });
});

describe("tokenizacao", () => {
  it("texto vazio nao produz token fantasma", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
});

describe("fixture pt-BR", () => {
  it("cobre negacao, numeros, curtas, longa, pausa e retomada", () => {
    expect(ASR_FIXTURE_BLOCKS.map((block) => block.id)).toEqual([
      "negacao",
      "numeros",
      "curtas",
      "longa",
      "pausa",
      "retomada",
    ]);
  });

  it("cada bloco tem referencia e instrucao de leitura", () => {
    for (const block of ASR_FIXTURE_BLOCKS) {
      expect(block.reference.trim().length).toBeGreaterThan(0);
      expect(block.direction.trim().length).toBeGreaterThan(0);
    }
  });

  it("nao carrega conteudo sensivel", () => {
    /*
      A fixture e lida em voz alta e fica versionada. Ela nao pode conter tema
      de saude, humor ou diagnostico - nem como exemplo.
    */
    const sensitive = /ansiedad|depress|diagnóstic|remédio|medicament|terapi|suicíd|doenç|sintoma/iu;
    expect(sensitive.test(fixtureReference())).toBe(false);
  });

  it("identifica a versao da fixture", () => {
    expect(ASR_FIXTURE_ID).toBe("elyra-asr-fixture-pt-br/v1");
  });

  it("uma leitura perfeita mede WER zero contra a propria referencia", () => {
    expect(werNormalized(fixtureReference(), fixtureReference()).rate).toBe(0);
  });
});

describe("revisao semantica", () => {
  const review = (kinds: SemanticReview["observations"]): SemanticReview => ({
    fixtureId: ASR_FIXTURE_ID,
    reviewer: "humano",
    reviewedAt: "2026-09-09T00:00:00.000Z",
    observations: kinds,
  });

  it("negacao perdida e fabricacao bloqueiam independentemente do WER", () => {
    expect(BLOCKING_SEMANTIC_ERRORS).toEqual(["lost_negation", "fabricated_phrase"]);

    const lost = review([
      { kind: "lost_negation", reference: "não consegui", candidate: "consegui" },
    ]);
    // WER de um erro em vinte palavras seria 0.05 - excelente, e irrelevante aqui.
    expect(werNormalized(
      "eu não consegui terminar a lista de compras hoje de manhã porque faltou tempo e vontade minha",
      "eu consegui terminar a lista de compras hoje de manhã porque faltou tempo e vontade minha",
    ).rate).toBeLessThan(0.06);
    expect(hasBlockingError(lost)).toBe(true);
  });

  it("erro nao bloqueante nao derruba a revisao sozinho", () => {
    expect(hasBlockingError(review([
      { kind: "added_word", reference: "vou sair", candidate: "vou sair correndo" },
    ]))).toBe(false);
  });

  it("conta por categoria", () => {
    const counts = countByKind(review([
      { kind: "changed_number", reference: "3", candidate: "8" },
      { kind: "changed_number", reference: "12", candidate: "20" },
      { kind: "omitted_span", reference: "e mais isso", candidate: "" },
    ]));
    expect(counts.changed_number).toBe(2);
    expect(counts.omitted_span).toBe(1);
    expect(counts.lost_negation).toBe(0);
  });
});
