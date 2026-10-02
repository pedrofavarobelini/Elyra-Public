import type {
  FaceGeometryResult,
  LandmarkEngine,
  PoseGeometryResult,
  PosePoint,
} from "@/lib/visual-landmarks";
import type { VisualObservationSample } from "@/lib/visual-signals";

/**
 * Fixtures deterministicas de landmarks e amostras visuais.
 *
 * ## Por que fixtures, e nao um modelo real, no QA automatizado
 *
 * Um teste que rodasse o `FaceLandmarker` de verdade dependeria de WASM, de GPU,
 * de 9,5 MB de modelo e de um `<video>` com uma pessoa dentro. Ele testaria o
 * MediaPipe — que ja e testado por quem o escreve — e nao testaria o que e
 * nosso: a reducao para escalares, os limiares, a cobertura, o consentimento e a
 * ausencia como estado.
 *
 * As fixtures produzem geometria **sintetica e exata**, entao o resultado
 * esperado de cada cenario e calculavel a mao. E por isso que a suite consegue
 * afirmar "esta serie tem frequencia 0,5" em vez de "esta serie tem algum
 * numero".
 *
 * O que elas nao provam esta dito com todas as letras em `QA.md`: que o modelo
 * real reconhece um corpo real. Isso e a validacao fisica, e nenhuma fixture
 * substitui.
 */

/** Matriz identidade 4x4, em ordem de coluna. Cabeca "parada". */
export const IDENTITY_TRANSFORM: readonly number[] = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];

/**
 * Rotacao em torno de Y (guinada), com **escala uniforme**, 4x4 em ordem de
 * coluna.
 *
 * O parametro `scale` existe porque a matriz real do `FaceLandmarker` carrega
 * escala: o rosto de alguem ocupa mais ou menos quadro conforme a distancia da
 * camera. Uma fixture sem escala testaria um caso que nao acontece em producao,
 * e foi exatamente essa lacuna que deixou passar o falso movimento de cabeca.
 *
 * Guinada e o eixo mais legivel para "virou a cabeca para o lado", e a conta de
 * `headRotationDelta` e invariante ao eixo — o angulo sai do traco da rotacao
 * relativa, entao um teste em Y prova a formula para qualquer eixo.
 */
export function yawTransform(angle: number, scale = 1): number[] {
  const c = Math.cos(angle) * scale;
  const s = Math.sin(angle) * scale;
  // Coluna 0, coluna 1, coluna 2, coluna 3 (translacao).
  return [c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}

/** Identidade com escala uniforme: mesma orientacao, distancia diferente. */
export function scaledIdentity(scale: number): number[] {
  return yawTransform(0, scale);
}

/**
 * Transformacoes que o extrator precisa recusar em vez de interpretar.
 *
 * Nenhuma delas e uma rotacao "quase certa" que da para consertar: cada uma e
 * sinal de que a transformacao nao e utilizavel, e devolver um angulo ali
 * descreveria uma conta, nao um movimento.
 */
export const DEGENERATE_TRANSFORMS: Record<string, number[]> = {
  /** Colapso total: nao ha base para extrair rotacao. */
  zeros: Array.from({ length: 16 }, () => 0),
  /** Colunas colineares: a segunda nao acrescenta direcao nenhuma. */
  collinear: [1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 1],
  /** Reflexao: base canhota, e reflexao nao e rotacao. */
  reflection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1],
  /** Valores nao finitos. */
  notFinite: [
    Number.NaN, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ],
};

/**
 * Pose sintetica com 33 pontos.
 *
 * Ombros a `±0.1` do centro em X: largura de ombro `0.2`, que e a escala. Um
 * deslocamento de `0.02` em unidades normalizadas vale, portanto, `0.1` largura
 * de ombro — acima do limiar de tronco (`0.02`) e abaixo do de mao (`0.05`).
 * Os numeros foram escolhidos para os tres limiares ficarem separaveis num
 * mesmo cenario.
 */
export function poseAt(options: {
  centerX: number;
  centerY: number;
  handOffsetX?: number;

  leftHandOffsetX?: number;
  rightHandOffsetX?: number;
  visible?: boolean;
  handsVisible?: boolean;
}): PosePoint[] {
  const {
    centerX,
    centerY,
    handOffsetX = 0,
    leftHandOffsetX,
    rightHandOffsetX,
    visible = true,
    handsVisible = true,
  } = options;
  const points: PosePoint[] = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0,
  }));

  const body = visible ? 1 : 0;
  points[11] = { x: centerX - 0.1, y: centerY, visibility: body };
  points[12] = { x: centerX + 0.1, y: centerY, visibility: body };
  points[23] = { x: centerX - 0.08, y: centerY + 0.3, visibility: body };
  points[24] = { x: centerX + 0.08, y: centerY + 0.3, visibility: body };

  const hand = handsVisible ? 1 : 0;
  // Indices pares sao o lado esquerdo do modelo (15,17,19,21); impares o direito.
  const LEFT = [15, 17, 19, 21];
  const RIGHT = [16, 18, 20, 22];
  for (const index of LEFT) {
    points[index] = {
      x: centerX - 0.15 + (leftHandOffsetX ?? handOffsetX),
      y: centerY + 0.4,
      visibility: hand,
    };
  }
  for (const index of RIGHT) {
    points[index] = {
      x: centerX + 0.15 + (rightHandOffsetX ?? handOffsetX),
      y: centerY + 0.4,
      visibility: hand,
    };
  }
  return points;
}

/** Um passo de deteccao ja pronto para o motor sintetico devolver. */
export interface LandmarkStep {
  face: FaceGeometryResult;
  pose: PoseGeometryResult;
}

export function step(
  transform: readonly number[] | null,
  points: readonly PosePoint[] | null,
): LandmarkStep {
  return { face: { transform }, pose: { points } };
}

/**
 * Motor sintetico: cada passo e um par rosto -> corpo (o coletor alterna os
 * detectores; a amostra sai no tick de corpo). Depois do ultimo, repete.
 *
 * `throwAt` faz a inferencia estourar a partir de um passo — e assim que a suite
 * prova que falha de modelo nao derruba a sessao, sem quebrar um modelo real.
 * `ready = false` simula video sem quadro (0x0, sem dados, track encerrada).
 */
export function fakeEngine(
  steps: readonly LandmarkStep[],
  options: { throwAt?: number; throwOn?: "face" | "pose"; ready?: boolean } = {},
): LandmarkEngine & {
  detections: number;
  faceCalls: number;
  poseCalls: number;
  closed: number;
  timestamps: { face: number[]; pose: number[] };
  maxConcurrent: number;
  setReady(ready: boolean): void;
} {
  let inFlight = 0;
  let ready = options.ready ?? true;
  const pick = (index: number) =>
    steps[index] ?? steps[steps.length - 1] ?? { face: { transform: null }, pose: { points: null } };
  const guard = <T,>(kind: "face" | "pose", body: () => T): T => {
    inFlight += 1;
    engine.maxConcurrent = Math.max(engine.maxConcurrent, inFlight);
    try {
      if (
        options.throwAt !== undefined &&
        engine.detections >= options.throwAt &&
        (options.throwOn === undefined || options.throwOn === kind)
      ) {
        throw new Error("landmark_inference_failed");
      }
      return body();
    } finally {
      inFlight -= 1;
    }
  };
  const engine = {
    detections: 0,
    faceCalls: 0,
    poseCalls: 0,
    closed: 0,
    maxConcurrent: 0,
    timestamps: { face: [] as number[], pose: [] as number[] },
    setReady(next: boolean) {
      ready = next;
    },
    ready: () => ready,
    detectFace(timestampMs: number) {
      return guard("face", () => {
        engine.faceCalls += 1;
        engine.timestamps.face.push(timestampMs);
        return pick(engine.detections).face;
      });
    },
    detectPose(timestampMs: number) {
      return guard("pose", () => {
        engine.poseCalls += 1;
        engine.timestamps.pose.push(timestampMs);
        const result = pick(engine.detections).pose;
        engine.detections += 1;
        return result;
      });
    },
    close() {
      engine.closed += 1;
    },
  };
  return engine;
}

/** Amostra ja minimizada, para os testes de aritmetica pura. */
export function sampleAt(
  atMs: number,
  overrides: Partial<VisualObservationSample> = {},
): VisualObservationSample {
  return {
    atMs,
    facePresent: true,
    headRotationDeltaRad: 0,
    bodyPresent: true,
    torsoDelta: 0,
    handsPresent: true,
    handDelta: 0,
    ...overrides,
  };
}

/**
 * Cenarios nomeados, na mesma ordem em que o mandato os pediu.
 *
 * Cada um e uma serie de amostras cujo resultado esperado se calcula a mao — e
 * e isso que permite a suite discriminar. Um cenario "movimento de cabeca" que
 * produzisse o mesmo numero que "cabeca estavel" seria um extrator quebrado, e
 * o teste falha em vez de registrar a coincidencia.
 */
export const VISUAL_SCENARIOS = {
  /** Nenhum rosto, nenhum corpo. Ausencia, e nao imobilidade. */
  zeroFace: (): VisualObservationSample[] =>
    Array.from({ length: 10 }, (_, index) =>
      sampleAt(index * 160, {
        facePresent: false,
        headRotationDeltaRad: null,
        bodyPresent: false,
        torsoDelta: null,
        handsPresent: false,
        handDelta: null,
      }),
    ),

  /** Rosto presente, sem rotacao acima do ruido. */
  stableFace: (): VisualObservationSample[] =>
    Array.from({ length: 10 }, (_, index) =>
      sampleAt(index * 160, { headRotationDeltaRad: 0.005 }),
    ),

  /** Cabeca girando em toda amostra, bem acima do limiar. */
  movingHead: (): VisualObservationSample[] =>
    Array.from({ length: 10 }, (_, index) =>
      sampleAt(index * 160, { headRotationDeltaRad: 0.25 }),
    ),

  stableBody: (): VisualObservationSample[] =>
    Array.from({ length: 10 }, (_, index) =>
      sampleAt(index * 160, { torsoDelta: 0.005 }),
    ),

  movingBody: (): VisualObservationSample[] =>
    Array.from({ length: 10 }, (_, index) =>
      sampleAt(index * 160, { torsoDelta: 0.25 }),
    ),

  /** Maos fora do quadro: presenca falsa e delta ausente. */
  handsAbsent: (): VisualObservationSample[] =>
    Array.from({ length: 10 }, (_, index) =>
      sampleAt(index * 160, { handsPresent: false, handDelta: null }),
    ),

  movingHands: (): VisualObservationSample[] =>
    Array.from({ length: 10 }, (_, index) =>
      sampleAt(index * 160, { handDelta: 0.3 }),
    ),

  /** Rosto some na metade: cobertura parcial por enquadramento. */
  partialCapture: (): VisualObservationSample[] =>
    Array.from({ length: 10 }, (_, index) =>
      index < 5
        ? sampleAt(index * 160, { headRotationDeltaRad: 0.1 })
        : sampleAt(index * 160, {
            facePresent: false,
            headRotationDeltaRad: null,
          }),
    ),
} as const;
