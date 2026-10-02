

export const ASR_AB_FIXTURE_VERSION = "elyra-asr-ab-fixture/v1";

export interface AsrAbFixtureBlock {
  id: string;
  /** O que a pessoa deve fazer neste bloco. */
  instruction: string;
  /** O que ela deve dizer. Vazio quando o bloco e silencio. */
  reference: string;
}

export const ASR_AB_FIXTURE_BLOCKS: readonly AsrAbFixtureBlock[] = [
  {
    id: "fala_1",
    instruction: "Leia em voz alta, no seu ritmo normal.",
    reference:
      "Hoje eu não vou compartilhar a tela. " +
      "Eu tenho dois livros, três cadernos e quatro canetas. " +
      "A câmera está desligada e somente o microfone está ativo. " +
      "Esta frase serve para verificar se palavras importantes são omitidas ou adicionadas.",
  },
  {
    id: "silencio",
    instruction:
      "Fique em silêncio de 8 a 10 segundos. Não tussa, não diga \"hum\", não encoste no microfone.",
    reference: "",
  },
  {
    id: "fala_2",
    instruction: "Volte a falar, na mesma voz.",
    reference: "Agora eu voltei a falar depois de alguns segundos em silêncio.",
  },
];

/**
 * A referencia completa — **uma so**, usada para os dois modelos.
 *
 * Derivada dos blocos, e nao redigitada: uma segunda copia divergiria do
 * roteiro no primeiro ajuste de frase, e os dois modelos passariam a ser
 * medidos contra textos diferentes. Isso destruiria a comparacao em silencio,
 * que e o pior jeito de destruir uma comparacao.
 */
export const ASR_AB_REFERENCE: string = ASR_AB_FIXTURE_BLOCKS.map(
  (block) => block.reference,
)
  .filter((reference) => reference !== "")
  .join(" ");

/** Duracao esperada do silencio, em ms. Usada so para orientar a tela. */
export const ASR_AB_SILENCE_MIN_MS = 8_000;
export const ASR_AB_SILENCE_MAX_MS = 10_000;
