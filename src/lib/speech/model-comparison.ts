import {
  ASR_QUANTIZATION,
  ASR_RUNTIME,
  ASR_RUNTIME_VERSION,
  VAD_MODEL_VERSION,
} from "@/lib/speech/browser-runtime";
import { buildTranscription, type AsrOutcome } from "@/lib/speech/segment-acceptance";
import type { AsrSession } from "@/lib/speech/local-model-engine";
import type { SpeechCandidate, SpeechTranscription } from "@/lib/speech/types";
import { detectSpeechSegments, toCandidates, type VadSession } from "@/lib/speech/vad";
import {
  classifyBrokenLink,
  sampleMemory,
  type BrokenLink,
  type LoadEvent,
} from "@/lib/qa/asr-load-forensics";




export interface AsrLoadAttempt {
  session: AsrSession | null;
  /** Rotulo do loader: `assets_missing`, `load_failed`, `integrity_failed`... */
  failure: string | null;
  errorName: string | null;
  errorMessage: string | null;
  /** Eventos de progresso, com caminho logico. Dizem ONDE parou. */
  events: LoadEvent[];
}

/** Como carregar um modelo. Injetavel para o teste nao precisar do Whisper. */
export type AsrLoader = (modelId: string) => Promise<AsrLoadAttempt>;

export interface AsrModelVariant {
  /** Identidade do modelo, como o `pipeline()` o resolve. */
  id: string;
  /** Rotulo curto de tela: "Base q8", "Small q8". */
  label: string;
  /** Bytes aproximados do conjunto, para a tela avisar antes do download. */
  approxBytes: number;
}

/**
 * Um trecho candidato, **sem o PCM**.
 *
 * O que sai deste modulo pode ser lido, copiado e colado num relatorio. O PCM
 * nao pode: ele e a voz do Demo. Ficar so com os limites e a probabilidade
 * mantem a evidencia auditavel — da para provar que os dois modelos receberam
 * os mesmos trechos — sem carregar audio junto.
 */
export interface CandidateShape {
  startOffsetMs: number;
  endOffsetMs: number;
  durationMs: number;
  speechProbability: number;
  samples: number;
}

/** Metricas de runtime de um modelo. `null` e ausencia medida, nunca zero. */
export interface AsrRunMetrics {
  loadMs: number;
  inferenceMs: number;
  totalMs: number;
  /**
   * Pico de heap JS observado, quando o navegador expoe `performance.memory`.
   *
   * `null` quando a API nao existe — e `null` **nao e zero**. Um numero
   * inventado aqui viraria "o Small cabe no aparelho" num relatorio, que e
   * exatamente a afirmacao que este experimento existe para medir.
   */
  peakHeapBytes: number | null;
}

export interface AsrModelRun {
  modelId: string;
  label: string;
  quantization: string;
  runtime: string;
  runtimeVersion: string;
  vad: string;
  /** O modelo subiu? `false` com `failure` preenchido nao contamina o outro lado. */
  loaded: boolean;
  failure: "load_failed" | "transcribe_failed" | null;
  /**
   * Onde a carga quebrou, quando quebrou.
   *
   * `null` quando o modelo subiu. Vocabulario fechado — ver
   * `asr-load-forensics`. Sem isto, `failure: "load_failed"` e tudo o que
   * sobra, e nao da para corrigir o que nao da para nomear.
   */
  brokenLink: BrokenLink | null;
  loadFailure: string | null;
  loadErrorName: string | null;
  loadErrorMessage: string | null;
  /** Ultimo arquivo que desceu inteiro antes da falha. */
  lastCompletedFile: string | null;
  transcription: SpeechTranscription | null;
  /** Texto corrido dos trechos aceitos, na ordem. */
  text: string;
  metrics: AsrRunMetrics;
  /** Trechos em que o modelo devolveu texto, mas a aceitacao recusou. */
  rejectedCount: number;
}

export interface AsrModelComparison {
  /** Prova de que o VAD rodou uma vez so. Qualquer valor != 1 invalida o teste. */
  vadRuns: number;
  candidates: CandidateShape[];
  /**
   * Impressao digital dos candidates.
   *
   * Deriva dos limites, do tamanho e da probabilidade de cada trecho. Os dois
   * modelos recebem o **mesmo array**, entao a impressao e trivialmente igual —
   * e e justamente por isso que ela vale: se algum dia alguem recortar de novo
   * para o segundo modelo, ela muda, e o teste morre.
   */
  candidateFingerprint: string;
  runs: AsrModelRun[];
  /** Sempre `false`. Existe para o teste poder afirmar isso sobre o resultado. */
  pcmPersisted: false;
  /** Quantos modelos estiveram carregados ao mesmo tempo, no pico. */
  peakConcurrentModels: number;
}

export interface CompareOptions {
  /** PCM mono 16 kHz da sessao inteira. Capturado uma vez, em memoria. */
  pcm: Float32Array;
  vad: VadSession;
  variants: readonly AsrModelVariant[];
  load: AsrLoader;
  audioStartOffsetMs?: number;
  /** Progresso legivel para a tela: qual modelo, e em que etapa. */
  onStage?: (stage: { modelId: string; phase: "loading" | "transcribing" | "done" }) => void;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Heap JS, quando o navegador conta.
 *
 * `performance.memory` e nao-padrao e so existe em navegadores Chromium — que e
 * exatamente o alvo desta rodada (Chrome no Android). Onde nao existe, a
 * resposta e `null`.
 */
function heapBytes(): number | null {
  const memory = (
    performance as unknown as { memory?: { usedJSHeapSize?: number } }
  )?.memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
}

export function fingerprintCandidates(candidates: readonly SpeechCandidate[]): string {
  return candidates
    .map(
      (candidate) =>
        `${candidate.startOffsetMs}-${candidate.endOffsetMs}-${candidate.pcm.length}-${candidate.speechProbability.toFixed(4)}`,
    )
    .join("|");
}

function shape(candidates: readonly SpeechCandidate[]): CandidateShape[] {
  return candidates.map((candidate) => ({
    startOffsetMs: candidate.startOffsetMs,
    endOffsetMs: candidate.endOffsetMs,
    durationMs: candidate.endOffsetMs - candidate.startOffsetMs,
    speechProbability: candidate.speechProbability,
    samples: candidate.pcm.length,
  }));
}

/**
 * Roda a comparacao.
 *
 * Nao lanca. Um modelo que nao sobe vira `loaded: false` com motivo, e o outro
 * lado continua valido — meia comparacao e informacao; uma excecao no meio e
 * uma tela em branco.
 */
export async function compareAsrModels(
  options: CompareOptions,
): Promise<AsrModelComparison> {
  let vadRuns = 0;
  const segments = await (async () => {
    vadRuns += 1;
    return detectSpeechSegments(options.pcm, options.vad);
  })();

  /*
    Congelado de proposito.

    `Object.freeze` no array impede que um caminho futuro reordene, filtre ou
    acrescente trechos entre um modelo e outro. Nao e paranoia: a diferenca
    entre "os dois modelos viram os mesmos trechos" e "quase os mesmos" e a
    diferenca entre um experimento e uma anedota.
  */
  const candidates: readonly SpeechCandidate[] = Object.freeze(
    toCandidates(options.pcm, segments, options.audioStartOffsetMs ?? 0),
  );
  const candidateFingerprint = fingerprintCandidates(candidates);

  const runs: AsrModelRun[] = [];
  let concurrent = 0;
  let peakConcurrentModels = 0;

  for (const variant of options.variants) {
    const identity = {
      modelId: variant.id,
      label: variant.label,
      quantization: ASR_QUANTIZATION,
      runtime: ASR_RUNTIME,
      runtimeVersion: ASR_RUNTIME_VERSION,
      vad: VAD_MODEL_VERSION,
    };

    options.onStage?.({ modelId: variant.id, phase: "loading" });
    const loadStarted = now();
    let attempt: AsrLoadAttempt;
    try {
      attempt = await options.load(variant.id);
    } catch (error) {
      attempt = {
        session: null,
        failure: "load_threw",
        errorName: error instanceof Error ? error.name : null,
        errorMessage: error instanceof Error ? error.message : String(error),
        events: [],
      };
    }
    const session = attempt.session;
    const loadMs = now() - loadStarted;
    const completed = attempt.events.filter((event) => event.status === "done");
    const lastCompletedFile = completed.length > 0 ? completed[completed.length - 1]!.file : null;

    if (!session) {
      /*
        Small que nao carrega **nao** vira "o Base ganhou".

        Cair em silencio para o modelo padrao e chamar isso de comparacao seria
        produzir um resultado com o nome errado em cima. O lado falho aparece
        como falho.
      */
      runs.push({
        ...identity,
        loaded: false,
        failure: "load_failed",
        brokenLink: classifyBrokenLink({
          events: attempt.events,
          errorName: attempt.errorName,
          errorMessage: attempt.errorMessage,
        }),
        loadFailure: attempt.failure,
        loadErrorName: attempt.errorName,
        loadErrorMessage: attempt.errorMessage,
        lastCompletedFile,
        transcription: null,
        text: "",
        metrics: { loadMs, inferenceMs: 0, totalMs: loadMs, peakHeapBytes: sampleMemory().usedHeapBytes },
        rejectedCount: 0,
      });
      options.onStage?.({ modelId: variant.id, phase: "done" });
      continue;
    }

    concurrent += 1;
    peakConcurrentModels = Math.max(peakConcurrentModels, concurrent);

    options.onStage?.({ modelId: variant.id, phase: "transcribing" });
    const inferenceStarted = now();
    let peak = heapBytes();
    let failure: AsrModelRun["failure"] = null;
    const pairs: { candidate: SpeechCandidate; outcome: AsrOutcome }[] = [];

    for (const candidate of candidates) {
      try {
        const outcome = await session.transcribe(candidate.pcm);
        pairs.push({ candidate, outcome });
      } catch {
        /*
          Um trecho que estourou nao derruba os outros — mesma regra do motor
          de producao. O trecho vira ausencia, e a comparacao registra que
          houve falha em vez de fingir que o modelo achou silencio ali.
        */
        failure = "transcribe_failed";
        pairs.push({ candidate, outcome: { text: "" } });
      }
      const sample = heapBytes();
      if (sample !== null) peak = peak === null ? sample : Math.max(peak, sample);
    }

    const inferenceMs = now() - inferenceStarted;
    const transcription = buildTranscription(pairs);

    try {
      await session.dispose?.();
    } catch {
      /* Descarte que falha nao invalida a medicao ja feita. */
    }
    concurrent -= 1;

    runs.push({
      ...identity,
      loaded: true,
      failure,
      brokenLink: null,
      loadFailure: null,
      loadErrorName: null,
      loadErrorMessage: null,
      lastCompletedFile,
      transcription,
      text: transcription.accepted.map((segment) => segment.text).join(" ").trim(),
      metrics: {
        loadMs,
        inferenceMs,
        totalMs: loadMs + inferenceMs,
        peakHeapBytes: peak,
      },
      rejectedCount: transcription.rejected.length,
    });
    options.onStage?.({ modelId: variant.id, phase: "done" });
  }

  return {
    vadRuns,
    candidates: shape(candidates),
    candidateFingerprint,
    runs,
    pcmPersisted: false,
    peakConcurrentModels,
  };
}
