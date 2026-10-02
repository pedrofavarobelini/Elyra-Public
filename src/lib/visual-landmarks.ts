import type { VisualObservationSample } from "@/lib/visual-signals";

/**
 * Adapter do motor de landmarks — a fronteira onde geometria vira escalar.
 *
 * ## O contrato de privacidade deste arquivo
 *
 * Tudo que este modulo recebe do motor (matriz de rotacao facial, pontos de
 * pose) **morre dentro do tick que o produziu**. O que sai daqui e uma
 * `VisualObservationSample`: sete campos, nenhum deles coordenada.
 *
 * A reducao acontece aqui, e nao depois, porque 468 pontos de um rosto sao um
 * template biometrico. Deixar a lista subir "so ate o estado do componente"
 * criaria uma copia identificavel na memoria da pagina, num objeto que qualquer
 * refatoracao futura poderia serializar sem perceber. A unica versao segura da
 * regra e a que nao depende de ninguem lembrar dela.
 *
 * ```
 * RAW_VISUAL_FRAMES_PERSISTED       = FALSE
 * RAW_VISUAL_FRAMES_SENT_TO_VELTRIX = FALSE
 * LANDMARK_FRAME_STREAM_PERSISTED   = FALSE
 * ```
 *
 * ## Isolamento de falha
 *
 * ```
 * VISUAL ANALYSIS FAILURE != CAMERA FAILURE != SESSION FAILURE
 * ```
 *
 * Nada aqui lanca para fora. Todo caminho de erro termina num estado nomeado, e
 * a sessao segue com camera, gravacao, microfone, transcricao e sinais de audio
 * intactos. Uma analise visual que derruba a sessao teria custado a pessoa a
 * sessao inteira para nao entregar cinco indices.
 */

/**
 * Estado da analise visual. Cinco valores, e nenhum deles e zero.
 *
 * `unavailable` e `unsupported` sao diferentes de proposito: a primeira e "nao
 * foi pedida" (sem consentimento, sem camera), a segunda e "foi pedida e este
 * navegador nao consegue". Fundi-las diria a pessoa que ela escolheu algo que
 * na verdade o aparelho dela recusou.
 */
export const VISUAL_ANALYSIS_STATES = [
  "available",
  "partial",
  "unavailable",
  "unsupported",
  "failed",
] as const;
export type VisualAnalysisState = (typeof VISUAL_ANALYSIS_STATES)[number];

export const VISUAL_ANALYSIS_STATE_LABEL: Record<VisualAnalysisState, string> = {
  available: "Análise visual ativa",
  partial: "Análise visual interrompida",
  unavailable: "Análise visual não ativada",
  unsupported: "Análise visual indisponível neste navegador",
  failed: "Análise visual não pôde iniciar",
};


export const VISUAL_SAMPLE_INTERVAL_MS = 160;

/**
 * Teto do intervalo sob degradacao adaptativa.
 *
 * Quando a inferencia custa mais que o intervalo, a resposta e **espacar**, e
 * nao enfileirar: fila cresceria sem limite e a memoria junto. Acima deste teto
 * a amostragem fica esparsa demais para a janela significar alguma coisa, e o
 * adapter prefere degradar para `partial` a produzir uma serie que finge
 * resolucao que nao tem.
 */
export const VISUAL_SAMPLE_INTERVAL_CEILING_MS = 2400;

/**
 * Fracao do tempo que a inferencia pode ocupar o main thread. Com 0.4, depois
 * de uma inferencia de `c` ms o coletor espera ao menos `c * 1.5` ms: a pagina
 * fica com 60% do tempo para toque, rolagem, audio e encerramento.
 */
export const VISUAL_INFERENCE_BUDGET_RATIO = 0.4;

/**
 * Limite seguro de uma inferencia unica. Acima disso a pagina fica travada por
 * tempo perceptivel a cada tick, mesmo espacada.
 */
export const VISUAL_INFERENCE_HARD_LIMIT_MS = 900;

/** Ticks seguidos acima do limite seguro (depois do aquecimento) que pausam a analise. */
export const VISUAL_OVER_LIMIT_STRIKES = 4;

/** Primeiras inferencias compilam shaders e sao lentas: nao contam para desistir. */
export const VISUAL_WARMUP_TICKS = 3;

// ---------------------------------------------------------------------------
// Fronteira do motor.
//
// Tipos estruturais minimos, e nao os tipos do MediaPipe: isto mantem o modulo
// testavel sem WASM, sem modelo e sem navegador, e deixa a troca de motor ser
// uma decisao de um arquivo so.
// ---------------------------------------------------------------------------

/** Matriz de transformacao facial 4x4, em ordem de coluna (16 floats). */
export interface FaceGeometryResult {
  /** `null` quando nenhum rosto foi encontrado nesta amostra. */
  transform: readonly number[] | null;
}

export interface PosePoint {
  x: number;
  y: number;
  /** Confianca de visibilidade, 0-1, quando o motor a fornece. */
  visibility?: number;
}

export interface PoseGeometryResult {
  /** `null` quando nenhuma pose foi encontrada nesta amostra. */
  points: readonly PosePoint[] | null;
}

/**
 * Motor com um detector por chamada (L-396). Rosto e corpo nunca rodam no mesmo
 * turno do main thread: somados custavam ~1 s por tick e travavam a sessao.
 */
export interface LandmarkEngine {
  /** Ha quadro de video valido para inferir agora? Sem quadro, o tick e pulado. */
  ready(): boolean;
  detectFace(timestampMs: number): FaceGeometryResult;
  detectPose(timestampMs: number): PoseGeometryResult;
  /** Idempotente: a segunda chamada nao faz nada. */
  close(): void;
}

/**
 * Indices de pose usados, e so eles.
 *
 * O modelo devolve 33 pontos; estes nove sao os que alimentam sinal. Os outros
 * — rosto, pes, joelhos — sao descartados sem serem lidos. Um adapter que
 * copiasse os 33 "por conveniencia" estaria guardando a silhueta da pessoa.
 */
export const POSE_LEFT_SHOULDER = 11;
export const POSE_RIGHT_SHOULDER = 12;
export const POSE_LEFT_HIP = 23;
export const POSE_RIGHT_HIP = 24;
/** Pulso, polegar, indicador e mindinho de cada lado. */
export const POSE_HAND_INDICES = [15, 16, 17, 18, 19, 20, 21, 22] as const;

/** Confianca minima para um ponto contar como observado. */
export const POSE_MIN_VISIBILITY = 0.5;

function visible(point: PosePoint | undefined): point is PosePoint {
  if (!point) return false;
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  return (point.visibility ?? 1) >= POSE_MIN_VISIBILITY;
}

/**
 * Extrai a rotacao pura de uma transformacao facial 4x4.
 *
 * ## O defeito que esta funcao existe para nao repetir
 *
 * A primeira versao aplicava `acos((tr(A^T·B) − 1) / 2)` direto sobre o bloco
 * 3x3 da matriz do `FaceLandmarker`. Essa formula so vale para matrizes de
 * **rotacao pura**, e a matriz do MediaPipe nao e: ela mapeia a face canonica
 * para o espaco da camera e carrega **escala uniforme**, porque o rosto de
 * alguem ocupa mais ou menos quadro conforme a distancia.
 *
 * Com o bloco valendo `s·R`, o traco vira `s_ant·s_atual·tr(R_ant^T·R_atual)`.
 * O estrago nao depende de a escala **mudar**: com escala constante `s = 0.8` e
 * a cabeca completamente parada, o traco da `3·0.64 = 1.92`, e
 * `acos((1.92−1)/2) ≈ 1.09 rad` — mais de 60 graus de movimento inventado, toda
 * amostra, numa pessoa imovel.
 *
 * ## Como a rotacao e recuperada
 *
 * Gram-Schmidt sobre as colunas: normaliza a primeira, ortogonaliza a segunda
 * contra ela, e obtem a terceira pelo produto vetorial. O resultado e
 * ortonormal por construcao, e a escala uniforme desaparece na normalizacao.
 *
 * ## Onde ela desiste, e por que desistir e a resposta certa
 *
 * Coluna degenerada, valor nao finito, ou reflexao (terceira coluna apontando
 * contra o produto vetorial) devolvem `null`. Uma reflexao nao e uma rotacao
 * "quase certa" que da para consertar: e sinal de que a transformacao nao e
 * utilizavel, e corrigi-la em silencio produziria um angulo que descreve uma
 * conta, nao um movimento. `null` sobe como ausencia — que e o unico valor
 * honesto quando nao se mediu.
 */
export function extractRotation(
  transform: readonly number[] | null,
): number[] | null {
  if (!transform || transform.length < 16) return null;

  // Bloco 3x3 superior-esquerdo de uma matriz 4x4 em ordem de coluna.
  const column = (index: number): [number, number, number] => [
    transform[index * 4] ?? Number.NaN,
    transform[index * 4 + 1] ?? Number.NaN,
    transform[index * 4 + 2] ?? Number.NaN,
  ];

  const c0 = column(0);
  const c1 = column(1);
  const c2 = column(2);
  if (![...c0, ...c1, ...c2].every(Number.isFinite)) return null;

  const dot = (a: readonly number[], b: readonly number[]) =>
    (a[0] ?? 0) * (b[0] ?? 0) + (a[1] ?? 0) * (b[1] ?? 0) + (a[2] ?? 0) * (b[2] ?? 0);
  const norm = (a: readonly number[]) => Math.sqrt(dot(a, a));
  const scale = (a: readonly number[], k: number): [number, number, number] => [
    (a[0] ?? 0) * k,
    (a[1] ?? 0) * k,
    (a[2] ?? 0) * k,
  ];
  const sub = (
    a: readonly number[],
    b: readonly number[],
  ): [number, number, number] => [
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0),
  ];
  const cross = (
    a: readonly number[],
    b: readonly number[],
  ): [number, number, number] => [
    (a[1] ?? 0) * (b[2] ?? 0) - (a[2] ?? 0) * (b[1] ?? 0),
    (a[2] ?? 0) * (b[0] ?? 0) - (a[0] ?? 0) * (b[2] ?? 0),
    (a[0] ?? 0) * (b[1] ?? 0) - (a[1] ?? 0) * (b[0] ?? 0),
  ];

  const EPSILON = 1e-6;

  const n0 = norm(c0);
  if (!(n0 > EPSILON)) return null;
  const u0 = scale(c0, 1 / n0);

  const projected = sub(c1, scale(u0, dot(c1, u0)));
  const n1 = norm(projected);
  // Colunas colineares: a transformacao colapsou e nao ha base para uma rotacao.
  if (!(n1 > EPSILON)) return null;
  const u1 = scale(projected, 1 / n1);

  const u2 = cross(u0, u1);
  // Reflexao: a terceira coluna original aponta contra a base destra. Nao e
  // rotacao, e nao vira rotacao por correcao de sinal.
  if (dot(u2, c2) <= 0) return null;

  // Ordem de coluna, como a entrada: [c0, c1, c2].
  return [...u0, ...u1, ...u2];
}


export function headRotationDelta(
  previous: readonly number[] | null,
  current: readonly number[] | null,
): number | null {
  const a = extractRotation(previous);
  const b = extractRotation(current);
  if (!a || !b) return null;

  // tr(A^T·B) somando so a diagonal: linha k de A^T e coluna k de A.
  let trace = 0;
  for (let i = 0; i < 3; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      trace += (a[i * 3 + k] ?? 0) * (b[i * 3 + k] ?? 0);
    }
  }

  const cosine = Math.min(1, Math.max(-1, (trace - 1) / 2));
  const angle = Math.acos(cosine);
  return Number.isFinite(angle) ? angle : null;
}

interface TorsoFrame {
  centroidX: number;
  centroidY: number;
  /** Largura de ombro, usada como escala. */
  scale: number;
}


export function torsoFrame(
  points: readonly PosePoint[] | null,
): TorsoFrame | null {
  if (!points) return null;
  const left = points[POSE_LEFT_SHOULDER];
  const right = points[POSE_RIGHT_SHOULDER];
  if (!visible(left) || !visible(right)) return null;

  const shoulderWidth = Math.hypot(left.x - right.x, left.y - right.y);
  const hipLeft = points[POSE_LEFT_HIP];
  const hipRight = points[POSE_RIGHT_HIP];

  const anchors: PosePoint[] = [left, right];
  if (visible(hipLeft)) anchors.push(hipLeft);
  if (visible(hipRight)) anchors.push(hipRight);

  // Ombros colados na projecao (pessoa de perfil) tornam a escala instavel; sem
  // escala confiavel a amostra vale mais como ausencia do que como numero.
  if (!(shoulderWidth > 1e-3)) return null;

  return {
    centroidX: anchors.reduce((sum, p) => sum + p.x, 0) / anchors.length,
    centroidY: anchors.reduce((sum, p) => sum + p.y, 0) / anchors.length,
    scale: shoulderWidth,
  };
}

export function torsoDisplacement(
  previous: TorsoFrame | null,
  current: TorsoFrame | null,
): number | null {
  if (!previous || !current) return null;
  const distance = Math.hypot(
    current.centroidX - previous.centroidX,
    current.centroidY - previous.centroidY,
  );
  // Escala da amostra atual: a anterior pode ter vindo de outro enquadramento.
  return current.scale > 0 ? distance / current.scale : null;
}


export function handPoints(
  points: readonly PosePoint[] | null,
): (PosePoint | null)[] {
  if (!points) return POSE_HAND_INDICES.map(() => null);
  return POSE_HAND_INDICES.map((index) => {
    const point = points[index];
    return visible(point) ? point : null;
  });
}

/** Ha ao menos um keypoint de mao observavel. */
export function handsObserved(hands: readonly (PosePoint | null)[]): boolean {
  return hands.some((point) => point !== null);
}

/**
 * Deslocamento medio das maos, em larguras de ombro.
 *
 * A magnitude e calculada **por keypoint** e so depois promediada: um keypoint
 * que anda para a esquerda e outro que anda para a direita somam movimento em
 * vez de se anularem.
 *
 * Media das magnitudes, e nao magnitude da media. A diferenca e a inteira razao
 * de esta funcao existir.
 */
export function handDisplacement(
  previous: readonly (PosePoint | null)[] | null,
  current: readonly (PosePoint | null)[] | null,
  scale: number | null,
): number | null {
  if (!previous || !current || !scale || scale <= 0) return null;

  const magnitudes: number[] = [];
  for (let index = 0; index < POSE_HAND_INDICES.length; index += 1) {
    const before = previous[index];
    const after = current[index];
    // So conta o keypoint observavel nas duas amostras: um que aparece agora e
    // nao aparecia antes nao percorreu distancia nenhuma, ele so passou a ser
    // visto.
    if (!before || !after) continue;
    magnitudes.push(Math.hypot(after.x - before.x, after.y - before.y) / scale);
  }

  if (magnitudes.length === 0) return null;
  return magnitudes.reduce((sum, value) => sum + value, 0) / magnitudes.length;
}

// ---------------------------------------------------------------------------
// Coletor.
// ---------------------------------------------------------------------------

export interface VisualObservationResult {
  state: VisualAnalysisState;
  samples: VisualObservationSample[];

  observationStartMs: number | null;
  /** Instante de sessao em que a observacao terminou, em ms. */
  observationEndMs: number | null;
  /** Intervalo praticado ao final, apos degradacao adaptativa. Diagnostico. */
  sampleIntervalMs: number;
  /** Tempo medio por inferencia (um detector), em ms. Medido, nao estimado. */
  meanInferenceMs: number | null;
  /** Vezes que o intervalo foi alargado porque a inferencia estourou o orcamento. */
  degradations: number;
  /** A analise foi pausada para manter a sessao responsiva (L-396). */
  pausedForPerformance: boolean;
}

/**
 * Status ao vivo, so para a tela (nao vai para o servidor).
 *
 * `preparing` ate a primeira amostra valida: a tela nunca diz "ativa" antes de
 * uma inferencia de verdade ter produzido algo.
 */
export type VisualLiveStatus =
  | "preparing"
  | "waiting_video"
  | "active"
  | "reduced"
  | "paused_performance"
  | "failed"
  | "stopped";

/** Rotulos do status ao vivo (sem precisao clinica; so o que o motor esta fazendo). */
export const VISUAL_LIVE_STATUS_LABEL: Record<VisualLiveStatus, string> = {
  preparing: "Análise visual: preparando",
  waiting_video: "Análise visual: aguardando a imagem da câmera",
  active: "Análise visual ativa",
  reduced: "Análise visual reduzida para manter a sessão leve",
  paused_performance: "Análise visual pausada para manter a sessão responsiva",
  failed: "Análise visual interrompida",
  stopped: "Análise visual encerrada",
};

/** Aviso nao bloqueante quando a analise para por desempenho. */
export const VISUAL_PAUSED_NOTICE =
  "A análise visual foi pausada neste dispositivo para manter a sessão responsiva.";

export interface VisualObservationCollector {
  stop(): VisualObservationResult;
  /** Estado para a cobertura (contrato com o servidor). */
  state(): VisualAnalysisState;
  /** Status ao vivo para a tela. */
  status(): VisualLiveStatus;
}

export interface VisualObservationOptions {
  engine: LandmarkEngine;
  /** Offset de sessao, em ms, no instante de cada amostra (relogio monotonico). */
  now: () => number;
  intervalMs?: number;
  setTimeout?: (handler: () => void, ms: number) => number;
  clearTimeout?: (handle: number) => void;
  /** Mede o custo de cada inferencia (injetavel em teste). */
  clock?: () => number;
  onStatus?: (status: VisualLiveStatus) => void;
}

/**
 * Inicia a amostragem visual.
 *
 * ## Agendamento serial (L-396)
 *
 * O modelo anterior usava `setInterval`: com inferencia de ~1 s e intervalo de
 * no maximo 600 ms, o proximo tick ja estava na fila quando o atual terminava,
 * e o main thread ficava ocupado por ate 9 s seguidos. Agora:
 *
 * ```
 * quadro valido? -> UM detector (rosto OU corpo) -> mede o custo
 *   -> espera max(intervalo, custo * 1.5) -> proximo tick
 * ```
 *
 * Nunca ha duas inferencias ao mesmo tempo nem fila de atraso. Rosto e corpo se
 * alternam; a amostra sai no tick de corpo e combina a medida de rosto do tick
 * anterior (um intervalo antes) — os dois foram medidos, nada e inventado, e a
 * taxa de amostras cai pela metade.
 *
 * Se uma inferencia continuar acima do limite seguro depois do aquecimento, a
 * analise visual **para** (`paused_performance`, estado `partial`) e a sessao
 * segue inteira.
 *
 * **Nunca lanca.** Se o motor quebrar no meio, o coletor para de amostrar,
 * guarda o que ja media e passa a `partial` ou `failed`.
 */
export function startVisualObservation(
  options: VisualObservationOptions,
): VisualObservationCollector {
  const {
    engine,
    now,
    intervalMs = VISUAL_SAMPLE_INTERVAL_MS,
    setTimeout: schedule = (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
    clearTimeout: unschedule = (handle) => globalThis.clearTimeout(handle),
    clock = performanceNow,
    onStatus,
  } = options;

  const samples: VisualObservationSample[] = [];
  const inferenceDurations: number[] = [];
  let observationStartMs: number | null = null;
  let observationEndMs: number | null = null;

  let currentInterval = intervalMs;
  let degradations = 0;
  let produced = false;
  let broken = false;
  let paused = false;
  let stopped = false;
  let timer: number | null = null;
  let ticks = 0;
  let strikes = 0;
  let running = false;
  let phase: "face" | "pose" = "face";
  let status: VisualLiveStatus = "preparing";

  const setStatus = (next: VisualLiveStatus) => {
    if (next === status) return;
    status = next;
    onStatus?.(next);
  };

  /*
    Geometria da amostra anterior — o unico estado que sobrevive ao tick, e o
    unico ponto do sistema em que geometria existe fora de um tick. Mais a medida
    de rosto do tick de rosto, que vive ate o tick de corpo seguinte e some.
  */
  let previousTransform: readonly number[] | null = null;
  let previousTorso: TorsoFrame | null = null;
  let previousHand: (PosePoint | null)[] | null = null;
  let pendingFace: FaceGeometryResult | null = null;

  const scheduleNext = (ms: number) => {
    if (stopped || broken || paused) return;
    timer = schedule(tick, ms);
  };

  function tick() {
    timer = null;
    if (stopped || broken || paused || running) return;

    // Sem quadro valido (0x0, sem dados, track encerrada): nao chama o motor.
    let ready = false;
    try {
      ready = engine.ready();
    } catch {
      ready = false;
    }
    if (!ready) {
      if (!produced) setStatus("waiting_video");
      scheduleNext(currentInterval);
      return;
    }

    running = true;
    const atMs = now();
    const startedAt = clock();
    let pose: PoseGeometryResult | null = null;
    try {
      if (phase === "face") pendingFace = engine.detectFace(atMs);
      else pose = engine.detectPose(atMs);
    } catch {
      /*
        Uma inferencia que estoura nao encerra a sessao, nao encerra a camera e
        nao apaga o que ja foi medido. Ela encerra **a analise visual**, que e a
        unica coisa que quebrou.
      */
      running = false;
      broken = true;
      if (observationStartMs !== null) observationEndMs = atMs;
      stopSampling();
      setStatus("failed");
      return;
    }
    const cost = clock() - startedAt;
    running = false;
    ticks += 1;
    inferenceDurations.push(cost);

    if (phase === "pose" && pose && pendingFace) {
      const face = pendingFace;
      pendingFace = null;
      const torso = torsoFrame(pose.points);
      const hands = handPoints(pose.points);
      if (observationStartMs === null) observationStartMs = atMs;
      observationEndMs = atMs;
      samples.push({
        atMs,
        facePresent: face.transform !== null,
        headRotationDeltaRad: headRotationDelta(previousTransform, face.transform),
        bodyPresent: torso !== null,
        torsoDelta: torsoDisplacement(previousTorso, torso),
        handsPresent: handsObserved(hands),
        handDelta: handDisplacement(previousHand, hands, torso?.scale ?? null),
      });
      produced = true;
      // Geometria da amostra sobrescreve a anterior e some. Nada e acumulado.
      previousTransform = face.transform;
      previousTorso = torso;
      previousHand = hands;
    }
    phase = phase === "face" ? "pose" : "face";

    // Limite seguro: depois do aquecimento, ticks seguidos acima dele pausam a analise.
    if (ticks > VISUAL_WARMUP_TICKS && cost > VISUAL_INFERENCE_HARD_LIMIT_MS) strikes += 1;
    else if (cost <= VISUAL_INFERENCE_HARD_LIMIT_MS) strikes = 0;
    if (strikes >= VISUAL_OVER_LIMIT_STRIKES) {
      paused = true;
      observationEndMs = observationStartMs === null ? null : atMs;
      stopSampling();
      setStatus("paused_performance");
      return;
    }

    /*
      Orcamento: a inferencia ocupa no maximo 40% do tempo. Custo alto alarga o
      intervalo (ate o teto); custo baixo o devolve devagar ao alvo.
    */
    const desired = Math.max(intervalMs, Math.round(cost * (1 / VISUAL_INFERENCE_BUDGET_RATIO - 1)));
    if (desired > currentInterval) {
      const widened = Math.min(VISUAL_SAMPLE_INTERVAL_CEILING_MS, desired);
      if (widened !== currentInterval) degradations += 1;
      currentInterval = widened;
    } else if (currentInterval > intervalMs) {
      currentInterval = Math.max(intervalMs, desired, Math.round(currentInterval * 0.85));
    }

    if (produced) setStatus(currentInterval >= intervalMs * 3 ? "reduced" : "active");
    scheduleNext(currentInterval);
  }

  function stopSampling() {
    if (timer !== null) {
      unschedule(timer);
      timer = null;
    }
    previousTransform = null;
    previousTorso = null;
    previousHand = null;
    pendingFace = null;
  }

  const currentState = (): VisualAnalysisState =>
    broken || paused ? (produced ? "partial" : "failed") : produced ? "available" : "unavailable";

  scheduleNext(currentInterval);

  return {
    state: currentState,
    status: () => status,
    stop() {
      if (stopped) {
        return result();
      }
      stopped = true;
      /*
        A observacao vai ate agora, e nao ate a ultima amostra. Entre a ultima
        amostra e o encerramento pode ter passado um intervalo inteiro, e contar
        so ate a amostra encolheria a janela observada de um jeito que nao
        aconteceu.
      */
      if (!broken && !paused && observationStartMs !== null) observationEndMs = now();
      stopSampling();
      try {
        engine.close();
      } catch {
        // Fechar o motor nao pode ser a coisa que derruba o fim da sessao.
      }
      if (!broken && !paused) setStatus("stopped");
      return result();
    },
  };

  function result(): VisualObservationResult {
    return {
      state: currentState(),
      samples,
      observationStartMs,
      observationEndMs,
      sampleIntervalMs: currentInterval,
      meanInferenceMs:
        inferenceDurations.length === 0
          ? null
          : inferenceDurations.reduce((sum, value) => sum + value, 0) / inferenceDurations.length,
      degradations,
      pausedForPerformance: paused,
    };
  }
}

function performanceNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
