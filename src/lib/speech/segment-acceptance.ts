import type {
  AcceptedSegment,
  RejectedSegment,
  SegmentRejection,
  SpeechCandidate,
  SpeechTranscription,
} from "@/lib/speech/types";

/**
 * A regra de aceitacao — onde a Elyra decide o que conta como fala.
 *
 * ## Por que esta camada existe
 *
 * O Whisper e um **sensor imperfeito**, e a validacao tecnica provou isso de
 * forma reproduzivel: com 30 s de silencio digital na entrada, o `whisper-base`
 * devolveu, 2 de 2, a frase *"A gente tem que ter que fazer isso."* — em
 * portugues, plausivel, e dita por ninguem.
 *
 * Aceitar a saida do ASR como verdade colocaria essa frase em `speech_rate`, na
 * projecao do Veltrix e no relatorio que um profissional le. Numa plataforma
 * cuja regra e *"nada e preenchido para a tela nao ficar vazia"*, isso e o pior
 * defeito possivel.
 *
 * ## Defesa em profundidade, e nao uma barreira
 *
 * A energia RMS **nao** e VAD: ventilador, teclado, musica e televisao passam de
 * qualquer limiar de energia sem que exista fala. Por isso a decisao vem em
 * camadas, e esta e a ultima:
 *
 * ```
 * RMS (energia)  ->  VAD (ha fala?)  ->  ASR (o que foi dito?)  ->  aceitacao
 * ```
 *
 * Quando houver duvida em qualquer uma delas: **`ABSENCE > FABRICATION`**.
 */


const NON_SPEECH_MARKUP = /[[(][^\])]*[\])]/gu;
const MUSICAL_SYMBOLS = /[♪-♯♩⚬]/gu;

/**
 * Remove marcacoes de nao-fala e devolve o que sobrou de texto dito.
 *
 * Devolve string vazia quando **nada** sobra - e e isso que faz o trecho ser
 * recusado como `non_speech_only`.
 */
export function stripNonSpeechMarkup(text: string): string {
  return text
    .replace(NON_SPEECH_MARKUP, " ")
    .replace(MUSICAL_SYMBOLS, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** O texto e composto exclusivamente de marcacao de nao-fala? */
export function isNonSpeechOnly(text: string): boolean {
  return text.trim().length > 0 && stripNonSpeechMarkup(text) === "";
}

/**
 * Palavras por espaco em branco, sobre o texto **ja limpo**.
 *
 * `[música]` nao e palavra. Conta-la inflaria `speech_rate` com um evento que
 * nao e fala de ninguem.
 */
export function countSpeechWords(text: string): number {
  const clean = stripNonSpeechMarkup(text);
  return clean === "" ? 0 : clean.split(/\s+/u).length;
}


export const VAD_SPEECH_THRESHOLD = 0.5;

/**
 * O que o ASR devolveu para um trecho candidato.
 *
 * `noSpeechProbability` e `undefined` quando o runtime nao expoe a medida. Ver a
 * nota em `acceptSegment`: ausencia da medida nao vira zero.
 */
export interface AsrOutcome {
  text: string;
  noSpeechProbability?: number;
}

/**
 * Limiar de ausencia de fala declarada pelo proprio modelo.
 *
 * Complementa o VAD em vez de substitui-lo: o VAD olha o audio, este olha a
 * confianca da decodificacao.
 */
export const NO_SPEECH_PROBABILITY_MAX = 0.6;

/**
 * Decide se um trecho vira fala persistida.
 *
 * Quatro condicoes, e todas obrigatorias:
 *
 *  1. o VAD viu fala no trecho;
 *  2. o ASR devolveu texto;
 *  3. o modelo nao declarou ausencia de fala;
 *  4. sobra texto depois de removida a marcacao de nao-fala.
 *
 * Faltando qualquer uma, o resultado e **ausencia com motivo**, e nunca texto
 * plausivel para preencher espaco.
 */
export function acceptSegment(
  candidate: SpeechCandidate,
  outcome: AsrOutcome,
): { accepted: AcceptedSegment | null; rejection: SegmentRejection | null } {
  const span = {
    startOffsetMs: candidate.startOffsetMs,
    endOffsetMs: candidate.endOffsetMs,
  };

  if (candidate.speechProbability < VAD_SPEECH_THRESHOLD) {
    // Nao deveria chegar aqui - o orquestrador nem manda ao ASR. A guarda existe
    // porque uma chamada direta a esta funcao tambem precisa ser fail-closed.
    return { accepted: null, rejection: "vad_rejected" };
  }

  const raw = outcome.text.trim();
  if (raw === "") return { accepted: null, rejection: "empty_text" };

  /*
    `undefined` **nao** e zero: quando o runtime nao expoe a medida, este teste
    simplesmente nao opina, e as outras tres condicoes seguem valendo. Tratar
    ausencia de medida como "modelo confiante" seria inventar confianca.
  */
  if (
    outcome.noSpeechProbability !== undefined &&
    outcome.noSpeechProbability > NO_SPEECH_PROBABILITY_MAX
  ) {
    return { accepted: null, rejection: "no_speech_probability" };
  }

  const text = stripNonSpeechMarkup(raw);
  if (text === "") return { accepted: null, rejection: "non_speech_only" };

  return {
    accepted: { ...span, text, wordCount: countSpeechWords(text) },
    rejection: null,
  };
}

/**
 * Aplica a regra a uma sessao inteira, preservando a ordem dos trechos.
 *
 * A ordem vem do proprio `startOffsetMs`, e nao da ordem de chegada: o ASR pode
 * terminar trechos fora de ordem, e uma transcricao remontada por ordem de
 * conclusao contaria uma sessao que nao aconteceu.
 */
export function buildTranscription(
  pairs: readonly { candidate: SpeechCandidate; outcome: AsrOutcome }[],
): SpeechTranscription {
  const accepted: AcceptedSegment[] = [];
  const rejected: RejectedSegment[] = [];

  for (const pair of pairs) {
    const result = acceptSegment(pair.candidate, pair.outcome);
    if (result.accepted) {
      accepted.push(result.accepted);
      continue;
    }
    rejected.push({
      startOffsetMs: pair.candidate.startOffsetMs,
      endOffsetMs: pair.candidate.endOffsetMs,
      rejection: result.rejection!,
      discardedText: pair.outcome.text.trim() || undefined,
    });
  }

  accepted.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  rejected.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  return { accepted, rejected };
}

/**
 * Junta os trechos aceitos num texto unico.
 *
 * Sem sobreposicao: o VAD entrega trechos disjuntos, entao nao ha o que
 * deduplicar. Se um dia a segmentacao passar a sobrepor, a deduplicacao entra
 * **aqui** e com teste proprio - e nao por acaso na concatenacao.
 */
export function joinAccepted(transcription: SpeechTranscription): string {
  return transcription.accepted.map((segment) => segment.text).join(" ").trim();
}

/** Palavras de **todos** os trechos aceitos. Alimenta `speech_rate`. */
export function acceptedWordCount(transcription: SpeechTranscription): number {
  return transcription.accepted.reduce(
    (total, segment) => total + segment.wordCount,
    0,
  );
}
