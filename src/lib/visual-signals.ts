import {
  captureCoverageSchema,
  notRequestedCoverage,
  type CaptureCoverage,
  type VisualModality,
} from "@/lib/contracts/capture-coverage";
import {
  SIGNAL_MAXIMUM,
  type ObservableSignalName,
} from "@/lib/contracts/multimodal-signals";
import type { VisualAnalysisState } from "@/lib/visual-landmarks";



/**
 * Uma amostra de observacao visual, ja minimizada.
 *
 * `null` num delta significa **nao havia com o que comparar** — primeira
 * amostra da serie, ou a modalidade reapareceu depois de sumir. Nao significa
 * zero: zero afirmaria imobilidade observada, e ninguem observou nada.
 */
export interface VisualObservationSample {
  /** Offset desde o inicio da sessao, em ms. */
  atMs: number;
  /** Havia rosto no enquadramento nesta amostra. */
  facePresent: boolean;
  /**
   * Angulo de rotacao da cabeca em relacao a amostra anterior, em radianos.
   *
   * Angulo **relativo**, e nao orientacao absoluta. A diferenca importa: a
   * orientacao absoluta descreveria como a pessoa estava posicionada em relacao
   * a camera, o que e informacao sobre o ambiente dela. O angulo relativo
   * descreve so o quanto mudou.
   */
  headRotationDeltaRad: number | null;
  /** Havia tronco identificavel no enquadramento. */
  bodyPresent: boolean;
  /** Deslocamento do tronco desde a amostra anterior, em larguras de ombro. */
  torsoDelta: number | null;
  /** Havia keypoints de mao no enquadramento. */
  handsPresent: boolean;
  /** Deslocamento medio das maos desde a amostra anterior, em larguras de ombro. */
  handDelta: number | null;
}

/**
 * Limiar acima do qual uma amostra conta como "houve movimento".
 *
 * Existem para separar movimento de **ruido de estimativa**: o landmarker
 * devolve posicoes ligeiramente diferentes a cada inferencia mesmo com a cena
 * parada, e sem limiar toda sessao teria frequencia de movimento perto de 1 —
 * um numero que nao distinguiria ninguem de ninguem.
 *
 * Os tres sao diferentes porque as tres coisas se movem em escalas diferentes.
 * Mao gesticulando percorre varias vezes o que um tronco percorre no mesmo
 * intervalo; um limiar unico chamaria de "parada" uma mao que se move ou de
 * "agitado" um tronco que respira.
 *
 * Versionados junto de `elyra-visual/v1`: mudar qualquer um deles muda o
 * significado de toda serie ja gravada, e por isso exige versao nova de
 * extrator, e nao um ajuste.
 */
export const HEAD_MOVEMENT_THRESHOLD_RAD = 0.02;
export const TORSO_MOVEMENT_THRESHOLD = 0.02;
export const HAND_MOVEMENT_THRESHOLD = 0.05;

/**
 * Referencia de normalizacao para a amplitude, por unidade de amostra.
 *
 * A amplitude precisa sair em 0-1 (`index`, por contrato) e a medida bruta nao
 * tem teto natural. Estes numeros dizem **o que conta como amplitude maxima**:
 * 0,5 rad (~29 graus) de rotacao de cabeca entre duas amostras consecutivas, ou
 * meia largura de ombro de deslocamento.
 *
 * Sao tetos de saturacao, e nao de dominio: um movimento maior nao e recusado,
 * ele satura em 1. O contrario — deixar a escala aberta — faria um unico gesto
 * brusco comprimir toda a sessao contra o zero.
 */
export const HEAD_AMPLITUDE_REFERENCE_RAD = 0.5;
export const TORSO_AMPLITUDE_REFERENCE = 0.5;

/** Minimo de amostras comparaveis para um sinal existir. */
export const MIN_COMPARABLE_SAMPLES = 2;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Fracao das amostras comparaveis em que a medida passou do limiar.
 *
 * Devolve `null` quando nao ha amostras comparaveis suficientes. **Ausencia de
 * amostra nao e ausencia de movimento**: uma sessao em que o rosto nunca
 * apareceu tem frequencia `null`, e nao `0`. Zero afirmaria que se olhou e nao
 * havia movimento.
 */
export function movementFrequency(
  deltas: readonly (number | null)[],
  threshold: number,
): number | null {
  const comparable = deltas.filter(
    (delta): delta is number => delta !== null && Number.isFinite(delta),
  );
  if (comparable.length < MIN_COMPARABLE_SAMPLES) return null;
  const moved = comparable.filter((delta) => delta > threshold).length;
  return clamp01(moved / comparable.length);
}

/**
 * Amplitude media, normalizada pela referencia e saturada em 1.
 *
 * Media de **todas** as amostras comparaveis, e nao so das que passaram do
 * limiar: a media dos movimentos grandes seria alta em qualquer sessao que
 * tivesse um, e apagaria a diferenca entre alguem que se move o tempo todo e
 * alguem que se moveu uma vez.
 */
export function motionAmplitude(
  deltas: readonly (number | null)[],
  reference: number,
): number | null {
  const comparable = deltas.filter(
    (delta): delta is number => delta !== null && Number.isFinite(delta),
  );
  if (comparable.length < MIN_COMPARABLE_SAMPLES) return null;
  if (reference <= 0) return null;
  const mean =
    comparable.reduce((sum, delta) => sum + delta, 0) / comparable.length;
  return clamp01(mean / reference);
}

/** Quanto tempo uma modalidade esteve observavel, em ms. */
export interface VisualPresence {
  /** Amostras em que a modalidade apareceu. */
  observedSamples: number;
  /** Total de amostras processadas. */
  totalSamples: number;
  /** Tempo observavel, em ms, somado a partir dos instantes reais. */
  observedMs: number;
  /** Duracao da janela em que houve observacao, em ms. */
  observationWindowMs: number;
}


export function visualPresence(
  samples: readonly VisualObservationSample[],
  present: (sample: VisualObservationSample) => boolean,
  observationEndMs: number,
): VisualPresence {
  if (samples.length === 0) {
    return {
      observedSamples: 0,
      totalSamples: 0,
      observedMs: 0,
      observationWindowMs: 0,
    };
  }

  let observedMs = 0;
  let observedSamples = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const nextAtMs = samples[index + 1]?.atMs ?? observationEndMs;
    // Amostra fora de ordem ou depois do fim da observacao nao contribui tempo
    // negativo: ela contribui zero, e o defeito aparece na cobertura menor em
    // vez de sumir numa subtracao.
    const span = Math.max(0, nextAtMs - sample.atMs);
    if (present(sample)) {
      observedSamples += 1;
      observedMs += span;
    }
  }

  const first = samples[0]!.atMs;
  return {
    observedSamples,
    totalSamples: samples.length,
    observedMs: Math.max(0, Math.round(observedMs)),
    observationWindowMs: Math.max(0, Math.round(observationEndMs - first)),
  };
}

/** Os cinco sinais visuais de um conjunto de amostras. */
export type VisualSignalValues = Record<
  Extract<
    ObservableSignalName,
    | "head_movement_frequency"
    | "head_motion_amplitude"
    | "body_movement_frequency"
    | "body_motion_amplitude"
    | "hand_movement_frequency"
  >,
  number | null
>;


export function computeVisualSignals(
  samples: readonly VisualObservationSample[],
): VisualSignalValues {
  const headDeltas = samples.map((sample) => sample.headRotationDeltaRad);
  const torsoDeltas = samples.map((sample) => sample.torsoDelta);
  const handDeltas = samples.map((sample) => sample.handDelta);

  return {
    head_movement_frequency: movementFrequency(
      headDeltas,
      HEAD_MOVEMENT_THRESHOLD_RAD,
    ),
    head_motion_amplitude: motionAmplitude(
      headDeltas,
      HEAD_AMPLITUDE_REFERENCE_RAD,
    ),
    body_movement_frequency: movementFrequency(
      torsoDeltas,
      TORSO_MOVEMENT_THRESHOLD,
    ),
    body_motion_amplitude: motionAmplitude(torsoDeltas, TORSO_AMPLITUDE_REFERENCE),
    hand_movement_frequency: movementFrequency(handDeltas, HAND_MOVEMENT_THRESHOLD),
  };
}

/**
 * Recorta as amostras de um intervalo de tempo.
 *
 * Por `atMs`, e nao por indice derivado como no audio: a amostragem visual e
 * **adaptativa** por decisao de performance, entao o intervalo entre amostras
 * varia dentro da mesma sessao e o indice deixa de ser proporcional ao tempo.
 * Derivar tempo de indice aqui produziria janelas deslocadas exatamente nas
 * sessoes em que o aparelho engasgou.
 */
export function sliceVisualSamples(
  samples: readonly VisualObservationSample[],
  startMs: number,
  endMs: number,
): VisualObservationSample[] {
  return samples.filter(
    (sample) => sample.atMs >= startMs && sample.atMs < endMs,
  );
}

/**
 * Teto de dominio, para o valor nunca sair fora do contrato.
 *
 * Redundante com o `clamp01` de cada funcao, e mantido de proposito: o contrato
 * define o teto por sinal, e depender do acaso de todos serem `index` seria
 * amarrar duas decisoes que podem divergir.
 */
export function boundVisualSignal(
  name: keyof VisualSignalValues,
  value: number | null,
): number | null {
  if (value === null) return null;
  return Math.min(Math.max(value, 0), SIGNAL_MAXIMUM[name]);
}


export function buildVisualCoverage(
  input: {
    state: VisualAnalysisState;
    samples: readonly VisualObservationSample[];
    /** Instante de sessao em que a observacao comecou. `null` = nao comecou. */
    observationStartMs: number | null;
    /** Instante de sessao em que a observacao terminou. */
    observationEndMs: number | null;
  },
  durationMs: number,
): CaptureCoverage[] {
  const modalities: {
    modality: VisualModality;
    present: (sample: VisualObservationSample) => boolean;
  }[] = [
    { modality: "visual_face", present: (sample) => sample.facePresent },
    { modality: "visual_body", present: (sample) => sample.bodyPresent },
    { modality: "visual_hands", present: (sample) => sample.handsPresent },
  ];

  const startMs = input.observationStartMs;
  const endMs = input.observationEndMs;

  /*
    Tempo da sessao que a analise **nao cobriu**, por ciclo de vida: o que passou
    antes de ela subir, mais o que passou depois de ela parar. Nada disso e
    conteudo - e janela em que nao havia observador.
  */
  const lifecycleGapMs =
    startMs === null || endMs === null
      ? durationMs
      : Math.max(0, startMs) + Math.max(0, durationMs - endMs);

  return modalities.map(({ modality, present }) => {
    if (input.state === "unavailable") {
      return notRequestedCoverage(modality, durationMs);
    }

    if (input.state === "unsupported" || input.state === "failed") {
      return captureCoverageSchema.parse({
        modality,
        outcome: "absent",
        reason: input.state === "unsupported" ? "unsupported" : "error",
        coverageMs: 0,
        sessionDurationMs: durationMs,
      });
    }

    const presence = visualPresence(input.samples, present, endMs ?? 0);
    const observedMs = Math.min(presence.observedMs, durationMs);

    if (observedMs === 0) {
      return captureCoverageSchema.parse({
        modality,
        outcome: "absent",
        reason: "not_observed",
        coverageMs: 0,
        sessionDurationMs: durationMs,
      });
    }

    /*
      `full` exige as duas coisas: a analise cobriu a sessao inteira **e** a
      modalidade apareceu em todo o tempo observado. Faltando qualquer uma, a
      cobertura e parcial - e o motivo declarado e o da maior lacuna.
    */
    if (observedMs >= durationMs && input.state === "available") {
      return captureCoverageSchema.parse({
        modality,
        outcome: "full",
        reason: null,
        coverageMs: durationMs,
        sessionDurationMs: durationMs,
      });
    }

    const outOfFrameMs = Math.max(
      0,
      presence.observationWindowMs - presence.observedMs,
    );

    const reason =
      input.state === "partial"
        ? "interrupted"
        : lifecycleGapMs > outOfFrameMs
          ? "analysis_started_late"
          : "out_of_frame";

    return captureCoverageSchema.parse({
      modality,
      outcome: "partial",
      reason,
      coverageMs: observedMs,
      sessionDurationMs: durationMs,
    });
  });
}
