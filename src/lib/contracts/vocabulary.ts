

/** Termos que afirmam condicao clinica. Origem: `docs/01-Product/Non-Clinical-Language.md`. */
export const TERMOS_CLINICOS = [
  "diagnóstico",
  "diagnostico",
  "diagnosticar",
  "transtorno",
  "depressão",
  "depressao",
  "ansiedade clínica",
  "risco psicológico",
  "quadro clínico",
] as const;

/**
 * Verbos que transformam associacao em causa.
 *
 * "ansiedade" sozinha nao entra em nenhuma das duas listas: a metrica se chama
 * **ansiedade percebida**, e proibir a palavra inteira quebraria o nome correto.
 */
export const TERMOS_CAUSAIS = [
  "causou",
  "por causa de",
  "provocou",
  "faz com que",
  "resultou em",
] as const;

/**
 * Vocabulario de implementacao que nao pode chegar ao leitor.
 *
 * Vem do `VR-005`, que encontrou "Sem dado persistido" numa tela de Relatorios.
 * Aplicado a **rotulo de catalogo**, onde o texto e curto e controlado; nao a
 * qualquer copy, para nao reprovar a tela de Seguranca por falar em "token".
 */
export const VOCABULARIO_INTERNO = [
  "payload",
  "fallback",
  "timestamp",
  "endpoint",
  "persistido",
  "persistida",
  "undefined",
  "null",
  "uuid",
  "deploy",
] as const;

/**
 * Palavras acentuadas que o produto usa na copy que vem do banco.
 *
 * A lista e o **alvo**: se um rotulo trouxer a mesma palavra sem acento, o
 * achado aponta a forma correta. Crescer esta lista e o jeito de ensinar o gate
 * uma palavra nova — de proposito, porque uma lista explicita e revisavel e um
 * dicionario inteiro nao e.
 */
export const LEXICO_ACENTUADO = [
  "Exercício",
  "Família",
  "Saúde",
  "Finanças",
  "Gratidão",
  "Reflexão",
  "Relações",
  "Cólica",
  "cabeça",
  "Cansaço",
  "Inchaço",
  "Alteração",
  "Sessões",
  "Relatórios",
  "Diário",
  "Histórico",
  "Configurações",
  "Análise",
] as const;

/** Remove diacriticos preservando o resto (NFD + corte da faixa combinante). */
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export const REGRA_COPY = {
  ACENTO: "ACENTO",
  CLINICO: "CLINICO",
  CAUSAL: "CAUSAL",
  INTERNO: "INTERNO",
} as const;

export type RegraCopy = (typeof REGRA_COPY)[keyof typeof REGRA_COPY];

export type AchadoCopy = {
  regra: RegraCopy;
  /** O trecho encontrado, como aparece no texto. */
  termo: string;
  /** Forma correta, quando a regra sabe apontar uma. */
  sugestao?: string;
};

/**
 * Sufixos que, em portugues, **sempre** carregam acento.
 *
 * Nenhuma palavra terminada em `-cao`, `-coes`, `-ancia`, `-encia`, `-avel` ou
 * `-ivel` e escrita sem acento na lingua. Por isso a regra pode afirmar o erro
 * sem consultar dicionario, e por isso ela pega palavra que a lista acima ainda
 * nao conhece — o caso do rotulo novo, que e exatamente o que escapou na V1.
 */
const SUFIXOS_ACENTUADOS: ReadonlyArray<{ sufixo: string; correcao: string }> = [
  { sufixo: "coes", correcao: "ções" },
  { sufixo: "cao", correcao: "ção" },
  { sufixo: "ancia", correcao: "ância" },
  { sufixo: "encia", correcao: "ência" },
  { sufixo: "avel", correcao: "ável" },
  { sufixo: "ivel", correcao: "ível" },
];

function palavras(texto: string): string[] {
  return texto.match(/\p{L}+/gu) ?? [];
}

/** Acentuacao: palavra conhecida escrita sem acento, ou sufixo que exige acento. */
function acharAcento(texto: string): AchadoCopy[] {
  const achados: AchadoCopy[] = [];
  for (const palavra of palavras(texto)) {
    // Palavra ja acentuada nao e candidata: `semAcento` so muda o que tem acento.
    if (semAcento(palavra) !== palavra) continue;
    const chave = palavra.toLowerCase();

    const noLexico = LEXICO_ACENTUADO.find(
      (correta) => semAcento(correta).toLowerCase() === chave,
    );
    if (noLexico) {
      achados.push({ regra: REGRA_COPY.ACENTO, termo: palavra, sugestao: noLexico });
      continue;
    }

    const sufixo = SUFIXOS_ACENTUADOS.find((regra) => chave.endsWith(regra.sufixo));
    if (sufixo && chave.length > sufixo.sufixo.length) {
      achados.push({
        regra: REGRA_COPY.ACENTO,
        termo: palavra,
        sugestao: `${palavra.slice(0, palavra.length - sufixo.sufixo.length)}${sufixo.correcao}`,
      });
    }
  }
  return achados;
}

function acharTermos(texto: string, lista: readonly string[], regra: RegraCopy): AchadoCopy[] {
  const alvo = texto.toLowerCase();
  return lista.filter((termo) => alvo.includes(termo)).map((termo) => ({ regra, termo }));
}

/**
 * Varredura de **rotulo de catalogo** — a copy que vive no banco.
 *
 * Texto curto, controlado pelo produto e exibido como chip: acento, vocabulario
 * clinico e vocabulario de implementacao. Conteudo escrito pela pessoa (anotacao,
 * meta, nome) **nunca** passa por aqui: seria varrer dado pessoal.
 */
export function auditarRotuloDeCatalogo(rotulo: string): AchadoCopy[] {
  return [
    ...acharAcento(rotulo),
    ...acharTermos(rotulo, TERMOS_CLINICOS, REGRA_COPY.CLINICO),
    ...acharTermos(rotulo, VOCABULARIO_INTERNO, REGRA_COPY.INTERNO),
  ];
}

/** Varredura de copy de tela: condicao clinica e afirmacao de causa. */
export function auditarCopyDeTela(texto: string): AchadoCopy[] {
  return [
    ...acharTermos(texto, TERMOS_CLINICOS, REGRA_COPY.CLINICO),
    ...acharTermos(texto, TERMOS_CAUSAIS, REGRA_COPY.CAUSAL),
  ];
}
