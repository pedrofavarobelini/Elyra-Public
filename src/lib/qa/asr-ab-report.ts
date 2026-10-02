import { measureQuality, type QualityMeasurement } from "@/lib/qa/asr-quality";
import { ASR_AB_SILENCE_MIN_MS } from "@/lib/qa/asr-ab-fixture";
import type { AsrModelComparison, AsrModelRun } from "@/lib/speech/model-comparison";

/**
 * Leitura do resultado da comparacao A/B.
 *
 * Modulo puro: recebe o que a sessao mediu e a referencia, devolve numeros.
 * Nao carrega modelo, nao toca rede, nao persiste. Isso e o que torna cada
 * afirmacao abaixo testavel sem um Whisper por perto.
 *
 * ## O que ele NAO faz
 *
 * Nao escolhe vencedor. `MORE_ACCURATE != AUTOMATICALLY_BETTER`: um modelo com
 * WER melhor que triplica a latencia e o consumo de memoria pode ser a escolha
 * errada para um celular, e essa conta e do Demo, com latencia e memoria na
 * frente — nao deste arquivo.
 *
 * Nao classifica erro semantico. `lost_negation` e `fabricated_phrase` sao
 * julgamentos, e um julgador automatico que errasse entraria no dossie como
 * fato medido. A tela lista as categorias; quem marca e a pessoa.
 */

/**
 * O gate do silencio.
 *
 * `indeterminate` existe e nao e um detalhe: quando a janela de silencio nao
 * pode ser localizada, a resposta honesta e "nao medi", e nao "passou".
 * `NULL is not zero`, e um gate que passa por falta de evidencia e pior que um
 * gate ausente — ele afirma.
 */
export type SilenceGate = "pass" | "fail" | "indeterminate";

export interface ModelQualityReport {
  modelId: string;
  label: string;
  loaded: boolean;
  failure: AsrModelRun["failure"];
  /**
   * O primeiro elo quebrado, quando o modelo nao subiu.
   *
   * Sobe ate aqui de proposito: um relatorio que diz "nao carregou" sem dizer
   * onde obriga a proxima pessoa a repetir o teste fisico para descobrir o que
   * ja tinha sido observado uma vez.
   */
  brokenLink: AsrModelRun["brokenLink"];
  loadFailure: string | null;
  loadErrorName: string | null;
  loadErrorMessage: string | null;
  lastCompletedFile: string | null;
  text: string;
  quality: QualityMeasurement | null;
  metrics: AsrModelRun["metrics"];
  rejectedCount: number;
  silenceGate: SilenceGate;
  /** Trechos aceitos que caem dentro da janela de silencio. Devem ser zero. */
  fabricatedDuringSilence: { startOffsetMs: number; endOffsetMs: number; text: string }[];
}

export interface AsrAbReport {
  fixtureVersion: string;
  reference: string;
  /** A janela de silencio localizada entre os dois trechos de fala. */
  silenceWindow: { startOffsetMs: number; endOffsetMs: number } | null;
  vadRuns: number;
  candidateCount: number;
  candidateFingerprint: string;
  peakConcurrentModels: number;
  models: ModelQualityReport[];
  /** Sempre `null`. A escolha e humana, e o campo existe para receber a dela. */
  winner: null;
}

/**
 * Localiza o silencio entre os dois trechos de fala.
 *
 * O VAD nao emite candidato onde nao ha fala, entao o silencio aparece como um
 * **buraco** entre candidatos. O maior buraco de pelo menos 8 s e a janela.
 *
 * Devolve `null` quando nenhum buraco desse tamanho existe — o que acontece se
 * a pessoa nao fez a pausa, ou se o VAD encheu o intervalo de candidatos. Nos
 * dois casos o gate do silencio fica `indeterminate`, e nao `pass`.
 */
export function findSilenceWindow(
  candidates: readonly { startOffsetMs: number; endOffsetMs: number }[],
  minimumMs: number = ASR_AB_SILENCE_MIN_MS,
): { startOffsetMs: number; endOffsetMs: number } | null {
  const ordered = [...candidates].sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  let widest: { startOffsetMs: number; endOffsetMs: number } | null = null;
  for (let index = 1; index < ordered.length; index += 1) {
    const start = ordered[index - 1]!.endOffsetMs;
    const end = ordered[index]!.startOffsetMs;
    if (end - start < minimumMs) continue;
    if (widest === null || end - start > widest.endOffsetMs - widest.startOffsetMs) {
      widest = { startOffsetMs: start, endOffsetMs: end };
    }
  }
  return widest;
}

function overlaps(
  segment: { startOffsetMs: number; endOffsetMs: number },
  window: { startOffsetMs: number; endOffsetMs: number },
): boolean {
  return (
    segment.startOffsetMs < window.endOffsetMs &&
    segment.endOffsetMs > window.startOffsetMs
  );
}

/**
 * Monta o relatorio.
 *
 * `reference` e **uma so** para todos os modelos — o parametro e unico de
 * proposito. Medir dois modelos contra referencias diferentes produziria dois
 * numeros incomparaveis com a mesma unidade, que e o jeito mais silencioso de
 * errar uma comparacao.
 */
export function buildAsrAbReport(
  comparison: AsrModelComparison,
  reference: string,
  fixtureVersion: string,
): AsrAbReport {
  const silenceWindow = findSilenceWindow(comparison.candidates);

  const models = comparison.runs.map((run): ModelQualityReport => {
    const accepted = run.transcription?.accepted ?? [];
    const fabricated =
      silenceWindow === null
        ? []
        : accepted
            .filter((segment) => overlaps(segment, silenceWindow))
            .map((segment) => ({
              startOffsetMs: segment.startOffsetMs,
              endOffsetMs: segment.endOffsetMs,
              text: segment.text,
            }));

    let silenceGate: SilenceGate;
    if (!run.loaded) silenceGate = "indeterminate";
    else if (silenceWindow === null) silenceGate = "indeterminate";
    else silenceGate = fabricated.length === 0 ? "pass" : "fail";

    return {
      modelId: run.modelId,
      label: run.label,
      loaded: run.loaded,
      failure: run.failure,
      brokenLink: run.brokenLink,
      loadFailure: run.loadFailure,
      loadErrorName: run.loadErrorName,
      loadErrorMessage: run.loadErrorMessage,
      lastCompletedFile: run.lastCompletedFile,
      text: run.text,
      /*
        Modelo que nao carregou nao recebe WER.

        Medir "" contra a referencia daria uma taxa de 1.0 — um numero que
        parece medicao e nao e. `SMALL_LOAD_FAILED` precisa aparecer como falha
        de carga, e nao como um modelo que se saiu muito mal.
      */
      quality: run.loaded ? measureQuality(reference, run.text) : null,
      metrics: run.metrics,
      rejectedCount: run.rejectedCount,
      silenceGate,
      fabricatedDuringSilence: fabricated,
    };
  });

  return {
    fixtureVersion,
    reference,
    silenceWindow,
    vadRuns: comparison.vadRuns,
    candidateCount: comparison.candidates.length,
    candidateFingerprint: comparison.candidateFingerprint,
    peakConcurrentModels: comparison.peakConcurrentModels,
    models,
    winner: null,
  };
}
