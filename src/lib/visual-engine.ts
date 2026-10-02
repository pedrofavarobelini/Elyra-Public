import type { LandmarkEngine } from "@/lib/visual-landmarks";

/**
 * Carregamento do motor real — o unico arquivo que sabe que MediaPipe existe.
 *
 * Isolado de proposito. `visual-landmarks.ts` fala com uma interface de tres
 * metodos e por isso e testavel sem WASM, sem modelo e sem navegador; a
 * dependencia concreta mora aqui, atras de `import()` dinamico, e so entra no
 * bundle de quem realmente inicia uma sessao com analise visual autorizada.
 *
 * ## Ativos servidos por `'self'`
 *
 * O caminho padrao da biblioteca busca WASM e modelo num CDN do Google **em
 * tempo de sessao**. Recusado por tres consequencias, e a terceira e a que mais
 * importa: um terceiro saberia **quando** cada pessoa comeca uma sessao, pelo
 * proprio padrao de download — metadado de comportamento vazando sem que um
 * unico byte de imagem saia do aparelho.
 *
 * Os quatro arquivos sao vendorizados por `npm run vision:assets`. Ver
 * `ADR-0011`.
 *
 * ## Ausencia de ativo nao e falha de sessao
 *
 * Sem os arquivos, `loadLandmarkEngine` devolve `null` e a sessao segue com
 * camera, gravacao, microfone, transcricao e sinais de audio. Um ambiente recem
 * clonado, sem `vision:assets` rodado, tem uma sessao **valida** sem analise
 * visual — e nao uma sessao quebrada.
 */

export const VISION_WASM_PATH = "/vision/wasm";
export const FACE_MODEL_PATH = "/vision/models/face_landmarker.task";
export const POSE_MODEL_PATH = "/vision/models/pose_landmarker_lite.task";
/** Ver o comentario em `loadLandmarkEngine` (medicao de 28/09). */
export const VISION_DELEGATE = "CPU" as const;

/**
 * Por que o motor nao pode ser usado, quando nao pode.
 *
 * Nomes distintos porque as respostas ao usuario sao distintas: `unsupported`
 * nao muda se ele tentar de novo, `assets_missing` e problema do ambiente, e
 * `load_failed` pode ser transitorio.
 */
export type VisualEngineFailure =
  | "unsupported"
  | "assets_missing"
  | "load_failed"
  /** Sessao encerrada ou tela desmontada antes de o motor terminar de carregar. */
  | "cancelled";

export interface VisualEngineLoad {
  engine: LandmarkEngine | null;
  failure: VisualEngineFailure | null;
}

/**
 * Modulo WebAssembly minimo que **so valida com SIMD**.
 *
 * `() -> void` com corpo `i32.const 0; i8x16.splat; drop; end`. O opcode
 * `0xfd 0x0f` (`i8x16.splat`) e o discriminante: um motor sem SIMD nao o
 * reconhece e `WebAssembly.validate` devolve `false`. Verificado nos dois
 * sentidos - trocar `0x0f` por um opcode SIMD inexistente tambem devolve
 * `false`, o que confirma que o `true` vem do opcode e nao do acaso.
 */
const SIMD_PROBE = Uint8Array.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
  0x03, 0x02, 0x01, 0x00,
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x1a, 0x0b,
]);

interface WasmScope {
  WebAssembly?: { validate?: (bytes: BufferSource) => boolean };
}

/**
 * O runtime vendorizado exige SIMD.
 *
 * `vision-assets.mjs` copia **somente** `vision_wasm_internal` - a variante
 * SIMD. As outras duas somam mais 22 MB e servem alvos em que o custo por
 * inferencia inviabilizaria a amostragem de qualquer forma.
 *
 * Consequencia: um navegador com WebAssembly e **sem** SIMD nao consegue rodar
 * este motor. Perguntar so por `WebAssembly` classificaria esse navegador como
 * suportado e o mandaria falhar la na frente, com `load_failed` generico - uma
 * incompatibilidade **conhecida** vestida de erro de execucao, que manda a
 * pessoa (e quem depura) procurar um bug onde ha um requisito.
 */
export function supportsSimd(scope: WasmScope = globalThis): boolean {
  const validate = scope.WebAssembly?.validate;
  if (typeof validate !== "function") return false;
  try {
    return validate(SIMD_PROBE) === true;
  } catch {
    // Um `validate` que lanca nao e um `validate` utilizavel.
    return false;
  }
}

/**
 * O navegador consegue rodar o motor?
 *
 * WebAssembly e o piso; SIMD e o requisito real do runtime que este repositorio
 * serve. Os dois, e nao so o primeiro.
 */
export function supportsLandmarkEngine(scope: WasmScope = globalThis): boolean {
  const wasm = scope.WebAssembly;
  if (typeof wasm !== "object" && typeof wasm !== "function") return false;
  return supportsSimd(scope);
}

/**
 * Tipos estruturais minimos do MediaPipe.
 *
 * Declarados aqui em vez de importados do pacote para que **nenhum modulo de
 * tipo do MediaPipe entre no grafo estatico**: o `import()` abaixo e a unica
 * referencia, e ela e dinamica.
 */
interface FaceLandmarkerLike {
  detectForVideo(
    video: unknown,
    timestampMs: number,
  ): { facialTransformationMatrixes?: { data: number[] }[] };
  close(): void;
}

interface PoseLandmarkerLike {
  detectForVideo(
    video: unknown,
    timestampMs: number,
  ): { landmarks?: { x: number; y: number; visibility?: number }[][] };
  close(): void;
}

/**
 * Log informativo conhecido do TensorFlow Lite (incidente de 28/09, L-395).
 *
 * O runtime Emscripten do MediaPipe grava na *stderr*, e o Emscripten liga a
 * stderr a `console.error` **no momento em que o script do WASM e avaliado**
 * (`var err = console.error.bind(console)`). O Next dev mostra todo
 * `console.error` como "Console Error" no overlay — um falso erro vermelho numa
 * sessao que funciona.
 *
 * Tratamento de menor escopo possivel: so esta string exata vira `console.info`,
 * e so para o runtime do MediaPipe (o filtro e instalado durante a criacao dos
 * landmarkers, quando o runtime prende a referencia, e o `console.error` global
 * volta ao original logo depois). Qualquer outra mensagem — inclusive erro real
 * do MediaPipe — passa intacta.
 */
export const KNOWN_RUNTIME_INFO_LINES: readonly string[] = [
  "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.",
];

export function routeKnownRuntimeInfo(
  original: (...args: unknown[]) => void,
  info: (...args: unknown[]) => void,
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    if (args.length === 1 && typeof args[0] === "string" && KNOWN_RUNTIME_INFO_LINES.includes(args[0].trim())) {
      info(args[0]);
      return;
    }
    original(...args);
  };
}

async function withRuntimeLogRouting<T>(body: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = routeKnownRuntimeInfo(original.bind(console), console.info.bind(console));
  try {
    return await body();
  } finally {
    console.error = original;
  }
}

/**
 * O quadro do `<video>` pode ir para a inferencia?
 *
 * `detectForVideo` com video sem dados (0x0, sem quadro atual, track encerrada)
 * nao e usado: o coletor pula o tick e tenta no proximo, sem erro.
 */
export function isVideoFrameReady(video: unknown): boolean {
  const v = video as Partial<HTMLVideoElement> | null;
  if (!v || typeof v !== "object") return false;
  if ((v.readyState ?? 0) < 2 || !v.videoWidth || !v.videoHeight || v.ended) return false;
  const stream = v.srcObject as MediaStream | null | undefined;
  if (stream && typeof stream.getVideoTracks === "function") {
    if (stream.active === false) return false;
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return false;
  }
  return true;
}

export interface LoadOptions {
  /** Sessao encerrada, tela desmontada ou consentimento revogado durante a carga. */
  cancelled?: () => boolean;
}

/**
 * Carrega o motor, ou explica por que nao.
 *
 * **Nunca lanca.** Toda falha vira um `failure` nomeado, porque quem chama esta
 * no meio de iniciar uma sessao e nao pode perder a sessao por causa de um
 * modelo que nao baixou. Se `cancelled()` virar verdade durante a carga, o que
 * ja foi criado e fechado e nada comeca a processar.
 */
export async function loadLandmarkEngine(
  video: unknown,
  options: LoadOptions = {},
): Promise<VisualEngineLoad> {
  const cancelled = options.cancelled ?? (() => false);
  if (!supportsLandmarkEngine()) {
    return { engine: null, failure: "unsupported" };
  }

  let face: FaceLandmarkerLike | null = null;
  let pose: PoseLandmarkerLike | null = null;
  const discard = () => {
    try {
      face?.close();
    } catch {
      // fechar nao pode lancar para fora
    }
    try {
      pose?.close();
    } catch {
      // idem
    }
    return { engine: null, failure: "cancelled" as const };
  };

  try {
    const vision = await import("@mediapipe/tasks-vision");
    if (cancelled()) return discard();
    const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM_PATH);
    if (cancelled()) return discard();

    /*
      Delegate CPU (XNNPACK), e nao GPU (L-396, medido em 28/09 com motor real):
      o delegate GPU do navegador compila shaders e le de volta o WebGL, e sem
      GPU de verdade vira WebGL por software — a primeira inferencia bloqueou o
      main thread por 5,8 s. Com CPU, no mesmo aparelho: bloqueio maximo 431 ms,
      nenhum atraso acima de 500 ms, analise "ativa" (nao reduzida). Os modelos
      sao as variantes lite/float16, feitas para CPU.
    */
    await withRuntimeLogRouting(async () => {
      face = (await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL_PATH, delegate: VISION_DELEGATE },
        runningMode: "VIDEO",
        numFaces: 1,
        /*
          A matriz de transformacao e o unico produto facial que este sistema
          consome. `outputFaceBlendshapes` fica **desligado** de proposito: as
          blendshapes descrevem expressao facial, e expressao facial nao e emocao
          objetiva. Liga-las colocaria a materia-prima de um classificador afetivo
          dentro do processo, disponivel para o primeiro atalho que alguem
          quisesse tomar.
        */
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
      })) as unknown as FaceLandmarkerLike;
      if (cancelled()) return;
      pose = (await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate: VISION_DELEGATE },
        runningMode: "VIDEO",
        numPoses: 1,
        // Mascara de segmentacao e uma silhueta da pessoa. Nenhum sinal a usa.
        outputSegmentationMasks: false,
      })) as unknown as PoseLandmarkerLike;
    });
    if (cancelled() || !face || !pose) return discard();

    return { engine: adapt(video, face, pose), failure: null };
  } catch (error) {
    discard();
    /*
      404 dos ativos e a falha mais provavel e a mais benigna: ambiente sem
      `npm run vision:assets`. Distingui-la de um erro real evita mandar alguem
      investigar um bug que e uma etapa de setup nao executada.
    */
    const message = error instanceof Error ? error.message : String(error);
    const missing =
      message.includes("404") ||
      message.toLowerCase().includes("failed to fetch") ||
      message.toLowerCase().includes("not found");
    return { engine: null, failure: missing ? "assets_missing" : "load_failed" };
  }
}

/**
 * MediaPipe exige timestamps estritamente crescentes **por landmarker**. Cada
 * detector tem o seu ultimo instante; o mesmo valor (ou um valor menor) vira
 * `ultimo + 1`. Finito e nao negativo sempre.
 */
export function nextTimestamp(last: number, requested: number): number {
  const base = Number.isFinite(requested) && requested >= 0 ? Math.floor(requested) : 0;
  return base > last ? base : last + 1;
}

function adapt(
  video: unknown,
  face: FaceLandmarkerLike,
  pose: PoseLandmarkerLike,
): LandmarkEngine {
  let lastFace = -1;
  let lastPose = -1;
  let closed = false;
  return {
    ready: () => !closed && isVideoFrameReady(video),
    detectFace(timestampMs) {
      if (closed) throw new Error("engine_closed");
      lastFace = nextTimestamp(lastFace, timestampMs);
      const result = face.detectForVideo(video, lastFace);
      // A matriz 4x4 atravessa ate o coletor, que a reduz a escalar e descarta.
      return { transform: result.facialTransformationMatrixes?.[0]?.data ?? null };
    },
    detectPose(timestampMs) {
      if (closed) throw new Error("engine_closed");
      lastPose = nextTimestamp(lastPose, timestampMs);
      const result = pose.detectForVideo(video, lastPose);
      return { points: result.landmarks?.[0] ?? null };
    },
    close() {
      // Uma vez so: fechar duas vezes um landmarker do MediaPipe nao e seguro.
      if (closed) return;
      closed = true;
      try {
        face.close();
      } finally {
        pose.close();
      }
    },
  };
}
