import { VAD_SPEECH_THRESHOLD } from "@/lib/speech/segment-acceptance";
import type { SpeechCandidate } from "@/lib/speech/types";



/** Janela do Silero v5 a 16 kHz. Nao e escolha nossa: e a entrada que o modelo aceita. */
export const VAD_WINDOW_SAMPLES = 512;
export const VAD_SAMPLE_RATE = 16_000;

/**
 * Duracao minima de um trecho de fala.
 *
 * Abaixo disso, um pico isolado de probabilidade viraria "trecho" e o ASR
 * receberia um fragmento sem contexto - que e justamente onde ele mais inventa.
 */
export const VAD_MIN_SPEECH_MS = 250;

/**
 * Silencio necessario para **fechar** um trecho.
 *
 * Uma pausa curta dentro de uma frase nao encerra a frase. Fechar cedo demais
 * picotaria a fala em pedacos que o ASR transcreveria pior, e as pausas ja sao
 * medidas por outra fonte - a envoltoria RMS - que continua existindo.
 */
export const VAD_MIN_SILENCE_MS = 500;

/**
 * Margem antes e depois do trecho.
 *
 * O VAD marca onde a energia de fala esta claramente presente, e consoantes
 * iniciais e finais ficam de fora. Sem a margem, o ASR recebe palavras
 * decapitadas.
 */
export const VAD_PAD_MS = 100;


export const MAX_SPEECH_SEGMENT_MS = 30_000;

/**
 * Raio de busca em torno de cada corte, como fracao do tamanho do pedaco.
 *
 * O corte ideal e uniforme; dentro deste raio ele procura o ponto mais
 * silencioso, para cair numa pausa em vez do meio de uma palavra.
 */
export const SPLIT_SEARCH_TAIL = 0.2;

/** A sessao de inferencia do VAD, vista de fora. */
export interface VadSession {
  dispose?(): Promise<void> | void;
  /** Probabilidade de fala para uma janela de `VAD_WINDOW_SAMPLES` amostras. */
  process(window: Float32Array): Promise<number> | number;
  /** Zera o estado recorrente. Chamado antes de cada sessao. */
  reset(): void;
}

function msToSamples(ms: number): number {
  return Math.round((ms / 1000) * VAD_SAMPLE_RATE);
}

function samplesToMs(samples: number): number {
  return Math.round((samples / VAD_SAMPLE_RATE) * 1000);
}

export interface VadSegment {
  startSample: number;
  endSample: number;
  speechProbability: number;
}

/**
 * Reparte um trecho longo em pedacos de no maximo `MAX_SPEECH_SEGMENT_MS`.
 *
 * ## Onde o corte cai
 *
 * O trecho e dividido em `ceil(duracao / teto)` pedacos **uniformes**, e cada
 * fronteira procura, num raio em volta do ponto ideal, a janela de **menor
 * probabilidade de fala** - o ponto mais proximo de uma pausa que existe ali.
 *
 * ## Sem sobreposicao, e por que
 *
 * Pedacos sobrepostos exigiriam deduplicar texto, e deduplicar texto e adivinhar
 * o que o modelo repetiu: duas transcricoes do mesmo audio raramente sao iguais
 * palavra a palavra. A alternativa - cortar na pausa mais provavel - troca esse
 * palpite por uma decisao explicavel, e o custo residual (uma palavra na
 * fronteira) fica visivel em teste em vez de escondido numa heuristica de
 * merge.
 */
export function splitLongSegment(
  segment: VadSegment,
  probabilities: readonly number[],
  windowStartSample: number,
  maxSamples: number,
): VadSegment[] {
  const length = segment.endSample - segment.startSample;
  if (length <= maxSamples) return [segment];

  /*
    Distribuicao **uniforme**, e nao corte guloso.

    O corte guloso - fatiar no teto ate sobrar - produzia um rabo minusculo
    sempre que o trecho passava pouco do limite: 30,2 s viravam 30 s + 0,2 s, e
    um fragmento de 200 ms e exatamente o caso sem contexto em que o ASR mais
    inventa. Distribuir em N pedacos iguais garante que nenhum pedaco fique
    abaixo de `length / N`.
  */
  const pieces = Math.ceil(length / maxSamples);
  const target = Math.ceil(length / pieces);
  const searchRadius = Math.floor(target * SPLIT_SEARCH_TAIL);

  const probabilityAt = (sample: number) =>
    probabilities[Math.floor((sample - windowStartSample) / VAD_WINDOW_SAMPLES)];

  const cuts: number[] = [];
  let previous = segment.startSample;
  for (let index = 1; index < pieces; index += 1) {
    const ideal = segment.startSample + index * target;

    /*
      A busca e **limitada nos dois lados**, e nao so pelo raio.

      Deslocar o corte para tras alonga o pedaco seguinte: numa primeira versao,
      60 s com teto de 30 s produziram um pedaco de 36 s porque o corte migrou
      24 s para tras e o resto cresceu. Os limites garantem que nenhum pedaco -
      nem o atual, nem o que sobra - passe do teto.
    */
    const lower = Math.max(
      ideal - searchRadius,
      previous + VAD_WINDOW_SAMPLES,
      segment.endSample - (pieces - index) * maxSamples,
    );
    const upper = Math.min(
      ideal + searchRadius,
      previous + maxSamples,
      segment.endSample - VAD_WINDOW_SAMPLES,
    );

    /*
      Comeca **no ponto ideal**, e nao no primeiro candidato: com
      probabilidades uniformes o corte fica onde a distribuicao uniforme o
      colocou, e so um ponto estritamente mais silencioso o move.
    */
    let cut = Math.min(Math.max(ideal, lower), upper);
    let quietest = probabilityAt(cut) ?? Number.POSITIVE_INFINITY;

    for (let sample = lower; sample <= upper; sample += VAD_WINDOW_SAMPLES) {
      const probability = probabilityAt(sample);
      if (probability !== undefined && probability < quietest) {
        quietest = probability;
        cut = sample;
      }
    }

    cuts.push(cut);
    previous = cut;
  }

  const bounds = [segment.startSample, ...cuts, segment.endSample];
  const out: VadSegment[] = [];
  for (let index = 0; index < bounds.length - 1; index += 1) {
    out.push({
      startSample: bounds[index]!,
      endSample: bounds[index + 1]!,
      speechProbability: segment.speechProbability,
    });
  }
  return out;
}

/**
 * Percorre o audio e devolve os trechos em que **ha fala**.
 *
 * A maquina de estados e deliberadamente simples e explicavel: acumula janelas
 * acima do limiar, exige `VAD_MIN_SPEECH_MS` para o trecho existir, e so fecha
 * depois de `VAD_MIN_SILENCE_MS` de janelas abaixo do limiar.
 *
 * Trechos saem **disjuntos e em ordem**. Sem sobreposicao nao ha o que
 * deduplicar depois - a alternativa (janelas sobrepostas) exigiria deduplicacao
 * de texto, que e adivinhacao sobre o que o modelo repetiu.
 */
export async function detectSpeechSegments(
  audio: Float32Array,
  session: VadSession,
  threshold: number = VAD_SPEECH_THRESHOLD,
  diagnostic?: import("./physical-diagnostic").AsrPhysicalDiagnostic,
): Promise<VadSegment[]> {
  if (diagnostic) diagnostic.vadCalled = true;
  session.reset();

  const minSpeech = msToSamples(VAD_MIN_SPEECH_MS);
  const minSilence = msToSamples(VAD_MIN_SILENCE_MS);
  const pad = msToSamples(VAD_PAD_MS);

  const maxSamples = msToSamples(MAX_SPEECH_SEGMENT_MS);

  const segments: VadSegment[] = [];
  const probabilities: number[] = [];
  let speechStart: number | null = null;
  let silenceRun = 0;
  let peak = 0;

  const close = (endSample: number) => {
    if (speechStart === null) return;
    const start = Math.max(0, speechStart - pad);
    const end = Math.min(audio.length, endSample + pad);
    if (end - start >= minSpeech) {
      // Teto aplicado **aqui**, e nao no consumidor: nenhuma chamada ao ASR pode
      // receber mais que a janela nativa do modelo.
      segments.push(
        ...splitLongSegment(
          { startSample: start, endSample: end, speechProbability: peak },
          probabilities,
          0,
          maxSamples,
        ),
      );
    }
    speechStart = null;
    peak = 0;
  };

  for (
    let offset = 0;
    offset + VAD_WINDOW_SAMPLES <= audio.length;
    offset += VAD_WINDOW_SAMPLES
  ) {
    const window = audio.subarray(offset, offset + VAD_WINDOW_SAMPLES);
    const probability = await session.process(window);
    probabilities.push(probability);
    if (diagnostic) {
      diagnostic.vadWindowsTotal++;
      if (Number.isFinite(probability)) {
        diagnostic.vadMaxSpeechProbability = Math.max(diagnostic.vadMaxSpeechProbability ?? 0, probability);
      }
      if (probability >= threshold) diagnostic.vadWindowsAboveThreshold++;
    }

    if (probability >= threshold) {
      if (speechStart === null) speechStart = offset;
      silenceRun = 0;
      if (probability > peak) peak = probability;
      continue;
    }

    if (speechStart !== null) {
      silenceRun += VAD_WINDOW_SAMPLES;
      if (silenceRun >= minSilence) close(offset - silenceRun + VAD_WINDOW_SAMPLES);
    }
  }

  // Fala que ia ate o fim do audio: fecha no fim, e nao se perde.
  close(audio.length);
  if (diagnostic) {
    diagnostic.vadCompleted = true;
    diagnostic.vadSegmentsCount = segments.length;
    diagnostic.vadSegmentDurationMs = segments.map((segment) =>
      (segment.endSample - segment.startSample) / VAD_SAMPLE_RATE * 1000);
    diagnostic.vadTotalSpeechMs = diagnostic.vadSegmentDurationMs.reduce((sum, ms) => sum + ms, 0);
  }
  return segments;
}

/**
 * Converte trechos do VAD em candidatos com PCM e offset de sessao.
 *
 * `sessionStartOffsetMs` existe porque o audio pode nao comecar junto com a
 * sessao - o microfone e autorizado depois do inicio, como a camera.
 */
export function toCandidates(
  audio: Float32Array,
  segments: readonly VadSegment[],
  sessionStartOffsetMs = 0,
): SpeechCandidate[] {
  return segments.map((segment) => ({
    startOffsetMs: sessionStartOffsetMs + samplesToMs(segment.startSample),
    endOffsetMs: sessionStartOffsetMs + samplesToMs(segment.endSample),
    // `slice` e nao `subarray`: o candidato precisa sobreviver ao buffer de
    // captura ser liberado, e uma view manteria o buffer inteiro vivo.
    pcm: audio.slice(segment.startSample, segment.endSample),
    speechProbability: segment.speechProbability,
  }));
}
