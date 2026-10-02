import type { CaptureCoverage } from "@/lib/contracts/capture-coverage";
import {
  AUDIO_SIGNALS,
  VISUAL_SIGNALS,
  SIGNAL_MAXIMUM,
  SIGNAL_UNIT,
  observableSignalSchema,
  type ObservableSignalContract,
  type ObservableSignalName,
} from "@/lib/contracts/multimodal-signals";
import {
  computeVisualSignals,
  type VisualObservationSample,
} from "@/lib/visual-signals";

/**
 * Extracao de sinais observaveis — aritmetica pura, sem modelo (ADR-0005).
 *
 * A captura acontece no navegador; **o calculo mora aqui**, em funcoes puras,
 * justamente para que cada sinal seja testavel sem microfone, sem camera e sem
 * aparelho fisico. Nenhuma funcao deste arquivo infere emocao: elas medem
 * ritmo, silencio, variacao de energia e mudanca de pixel.
 */

/** Duracao minima de silencio para contar como pausa deliberada. */
export const PAUSE_MINIMUM_MS = 400;

/**
 * Fracao da energia mediana abaixo da qual o quadro e considerado silencio.
 * Relativo, nao absoluto: microfones e ambientes tem ganhos diferentes, e um
 * limiar fixo classificaria a sala silenciosa de uma pessoa como "fala".
 */
export const SILENCE_RELATIVE_THRESHOLD = 0.15;

export interface PauseSignals {
  pauseCount: number;
  pauseTotalMs: number;
  pauseMeanMs: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

/**
 * Segmentos contiguos de silencio na envoltoria RMS.
 *
 * `envelope` e uma amostra de energia por quadro; `frameMs` e a duracao de cada
 * quadro. Silencio so vira pausa quando dura pelo menos `PAUSE_MINIMUM_MS` —
 * respiros e cortes de quadro nao sao pausas.
 */
export function computePauseSignals(
  envelope: readonly number[],
  frameMs: number,
): PauseSignals {
  const empty: PauseSignals = { pauseCount: 0, pauseTotalMs: 0, pauseMeanMs: 0 };
  if (envelope.length === 0 || frameMs <= 0) return empty;

  const threshold = median(envelope) * SILENCE_RELATIVE_THRESHOLD;
  const durations: number[] = [];
  let run = 0;

  const flush = () => {
    const duration = run * frameMs;
    if (duration >= PAUSE_MINIMUM_MS) durations.push(duration);
    run = 0;
  };

  for (const frame of envelope) {
    if (frame <= threshold) run += 1;
    else flush();
  }
  flush();

  if (durations.length === 0) return empty;

  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    pauseCount: durations.length,
    pauseTotalMs: total,
    pauseMeanMs: total / durations.length,
  };
}


export function computeVoicedDurationMs(
  envelope: readonly number[],
  frameMs: number,
): number {
  if (envelope.length === 0 || frameMs <= 0) return 0;
  const threshold = median(envelope) * SILENCE_RELATIVE_THRESHOLD;
  const voiced = envelope.filter((frame) => frame > threshold).length;
  return voiced * frameMs;
}

/**
 * Coeficiente de variacao da envoltoria, normalizado em 0-1.
 *
 * Mede o quanto a energia da voz oscilou ao longo da sessao. **Nao mede
 * emocao**: uma variacao alta pode vir de entusiasmo, de leitura em voz alta,
 * de um ambiente ruidoso ou do proprio microfone.
 */
export function computeVocalVariation(envelope: readonly number[]): number | null {
  if (envelope.length < 2) return null;

  const mean = envelope.reduce((sum, value) => sum + value, 0) / envelope.length;
  if (mean <= 0) return null;

  const variance =
    envelope.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    envelope.length;
  const coefficient = Math.sqrt(variance) / mean;

  return Math.min(1, Math.max(0, coefficient));
}

/** Palavras por minuto sobre o tempo realmente falado, nao sobre a sessao. */
export function computeSpeechRate(
  wordCount: number,
  voicedDurationMs: number,
): number | null {
  if (wordCount < 0 || voicedDurationMs <= 0) return null;
  const rate = wordCount / (voicedDurationMs / 60_000);
  return Number.isFinite(rate) ? Math.min(rate, SIGNAL_MAXIMUM.speech_rate) : null;
}

/**
 * Media das diferencas absolutas entre quadros consecutivos, normalizada 0-1.
 *
 * Mede **mudanca de pixel**, nao postura, nao intencao e nao emocao. Uma pessoa
 * parada com a camera tremendo produz movimento alto; uma pessoa gesticulando
 * fora do enquadramento produz movimento baixo.
 */
export function computeMovementFrequency(
  frameDifferences: readonly number[],
): number | null {
  if (frameDifferences.length === 0) return null;
  const mean =
    frameDifferences.reduce((sum, value) => sum + value, 0) /
    frameDifferences.length;
  if (!Number.isFinite(mean)) return null;
  return Math.min(1, Math.max(0, mean));
}

export interface PersonalBaseline {
  mean: number;
  samples: number;
}

/**
 * Baseline pessoal a partir do historico do proprio usuario.
 *
 * Retorna `null` quando nao ha amostra. **Ausencia de historico nao e zero** —
 * e ausencia de comparacao, e o sinal viaja como `insufficient_baseline`.
 */
export function personalBaseline(
  history: readonly number[],
): PersonalBaseline | null {
  const usable = history.filter((value) => Number.isFinite(value));
  if (usable.length === 0) return null;
  return {
    mean: usable.reduce((sum, value) => sum + value, 0) / usable.length,
    samples: Math.min(usable.length, 90),
  };
}

/**
 * Monta um sinal ja no formato do contrato, decidindo o `status`.
 *
 * Tres casos, e so tres:
 *   - `not_captured`: a captura correspondente nao aconteceu. Sem valor.
 *   - `insufficient_baseline`: ha valor, mas nao ha historico para comparar.
 *   - `available`: ha valor e ha historico. So aqui existe delta.
 */
export function buildObservableSignal(
  name: ObservableSignalName,
  value: number | null,
  baseline: PersonalBaseline | null,
  /**
   * Cobertura da modalidade que produziu o valor.
   *
   * Parametro proprio, e nao derivado aqui dentro, porque quem sabe quanto tempo
   * a camera esteve ligada e quem capturou - nao quem calcula. `null` e
   * aceitavel e significa "sem cobertura registrada", nunca "cobertura
   * completa".
   */
  coverage: CaptureCoverage | null = null,
): ObservableSignalContract {
  const unit = SIGNAL_UNIT[name];

  if (value === null) {
    return observableSignalSchema.parse({
      name,
      value: null,
      unit,
      personalBaselineMean: null,
      personalBaselineSamples: 0,
      deltaVsPersonalBaseline: null,
      status: "not_captured",
      coverage,
    });
  }

  const bounded = Math.min(Math.max(value, 0), SIGNAL_MAXIMUM[name]);

  if (baseline === null || baseline.samples < 1) {
    return observableSignalSchema.parse({
      name,
      value: bounded,
      unit,
      personalBaselineMean: null,
      personalBaselineSamples: 0,
      deltaVsPersonalBaseline: null,
      status: "insufficient_baseline",
      coverage,
    });
  }

  const baselineMean = Math.min(Math.max(baseline.mean, 0), SIGNAL_MAXIMUM[name]);
  return observableSignalSchema.parse({
    name,
    value: bounded,
    unit,
    personalBaselineMean: baselineMean,
    personalBaselineSamples: baseline.samples,
    deltaVsPersonalBaseline: bounded - baselineMean,
    status: "available",
    coverage,
  });
}

export interface SignalExtractionInput {
  capturedResources: readonly ("screen" | "camera" | "microphone")[];
  /**
   * A analise visual foi autorizada **e** rodou.
   *
   * Separado de `capturedResources`: camera ligada sem analise visual continua
   * produzindo `movement_frequency`, que nao usa landmark nenhum. Derivar um do
   * outro transformaria ligar a camera em consentimento presumido para extrair
   * geometria corporal.
   */
  visualAnalysis?: boolean;
  /** Amostras visuais ja minimizadas. Vazio quando nao houve analise visual. */
  visualSamples?: readonly VisualObservationSample[];
  /** Envoltoria RMS por quadro, capturada on-device. */
  audioEnvelope: readonly number[];
  audioFrameMs: number;
  /** Diferenca media entre quadros consecutivos, normalizada 0-1. */
  frameDifferences: readonly number[];
  wordCount: number | null;
  voicedDurationMs: number | null;
  /** Historico do proprio usuario por sinal, para a baseline pessoal. */
  history: Partial<Record<ObservableSignalName, readonly number[]>>;
  /**
   * PRO-7R: captura durante chamada profissional. O silencio da propria
   * pessoa inclui o tempo em que ela escuta o outro lado; contar isso como
   * "pausa" seria medir a conversa, nao a fala. Pausas saem `not_captured`
   * (NULL, nunca zero). Ritmo de fala usa so tempo com voz e fica valido.
   */
  excludePauses?: boolean;
}

/**
 * Deriva o conjunto de sinais de uma sessao.
 *
 * Sinal cuja captura nao aconteceu sai como `not_captured` em vez de sumir: o
 * consumidor precisa distinguir "nao medimos" de "medimos e deu zero".
 */
export function extractSessionSignals(
  input: SignalExtractionInput,
): ObservableSignalContract[] {
  const captured = new Set(input.capturedResources);
  const hasMicrophone = captured.has("microphone");
  const hasCamera = captured.has("camera");
  const hasVisual = hasCamera && input.visualAnalysis === true;

  const visual = hasVisual
    ? computeVisualSignals(input.visualSamples ?? [])
    : null;

  const pauses = hasMicrophone && !input.excludePauses
    ? computePauseSignals(input.audioEnvelope, input.audioFrameMs)
    : null;

  const rawValues: Record<ObservableSignalName, number | null> = {
    speech_rate:
      hasMicrophone && input.wordCount !== null && input.voicedDurationMs !== null
        ? computeSpeechRate(input.wordCount, input.voicedDurationMs)
        : null,
    pause_count: pauses?.pauseCount ?? null,
    pause_total_duration: pauses?.pauseTotalMs ?? null,
    pause_mean_duration: pauses?.pauseMeanMs ?? null,
    vocal_variation: hasMicrophone
      ? computeVocalVariation(input.audioEnvelope)
      : null,
    movement_frequency: hasCamera
      ? computeMovementFrequency(input.frameDifferences)
      : null,
    head_movement_frequency: visual?.head_movement_frequency ?? null,
    head_motion_amplitude: visual?.head_motion_amplitude ?? null,
    body_movement_frequency: visual?.body_movement_frequency ?? null,
    body_motion_amplitude: visual?.body_motion_amplitude ?? null,
    hand_movement_frequency: visual?.hand_movement_frequency ?? null,
  };

  return (Object.keys(rawValues) as ObservableSignalName[])
    .filter((name) => {

      // contrario ele nem e mencionado, em vez de aparecer como "nao capturado"
      // para uma sessao que nunca poderia te-lo medido.
      if (AUDIO_SIGNALS.has(name)) return hasMicrophone;
      /*
        Sinal visual so e mencionado quando a analise visual foi autorizada.
        Sem autorizacao ele nao aparece nem como `not_captured`: listar
        `head_movement_frequency: nao capturado` numa sessao sem consentimento
        ja seria dizer que se cogitou medir a cabeca da pessoa.
      */
      if (VISUAL_SIGNALS.has(name)) return hasVisual;
      return hasCamera;
    })
    .map((name) =>
      buildObservableSignal(
        name,
        rawValues[name],
        personalBaseline(input.history[name] ?? []),
      ),
    );
}
