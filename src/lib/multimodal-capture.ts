import {
  MAX_MEDIA_BYTES,
  MAX_SESSION_MS,
  type CaptureResource,
  type CaptureStateMap,
  type SessionCaptureState,
} from "@/lib/contracts/session";

export interface CaptureCapabilities {
  screen: boolean;
  camera: boolean;
  microphone: boolean;
  mediaRecorder: boolean;
  secureContext: boolean;
}

interface CapabilityEnvironment {
  mediaDevices?: Partial<
    Pick<MediaDevices, "getUserMedia" | "getDisplayMedia">
  >;
  mediaRecorder?: typeof MediaRecorder;
  secureContext: boolean;
}

export function detectCaptureCapabilities(
  environment: CapabilityEnvironment = {
    mediaDevices: typeof navigator === "undefined"
      ? undefined
      : navigator.mediaDevices,
    mediaRecorder: typeof MediaRecorder === "undefined" ? undefined : MediaRecorder,
    secureContext: typeof window === "undefined" ? false : window.isSecureContext,
  },
): CaptureCapabilities {
  const recorder = typeof environment.mediaRecorder === "function";
  const userMedia = typeof environment.mediaDevices?.getUserMedia === "function";
  const displayMedia = typeof environment.mediaDevices?.getDisplayMedia === "function";
  return {
    screen: environment.secureContext && recorder && displayMedia,
    camera: environment.secureContext && recorder && userMedia,
    microphone: environment.secureContext && recorder && userMedia,
    mediaRecorder: recorder,
    secureContext: environment.secureContext,
  };
}

export function initialCaptureStates(
  capabilities: CaptureCapabilities,
): CaptureStateMap {
  return {
    screen: capabilities.screen ? "supported" : "unsupported",
    camera: capabilities.camera ? "supported" : "unsupported",
    microphone: capabilities.microphone ? "supported" : "unsupported",
  };
}

export function captureErrorState(
  resource: CaptureResource,
  error: unknown,
): SessionCaptureState {
  const name = error instanceof DOMException
    ? error.name
    : typeof error === "object" && error && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "unsupported";
  }
  if (name === "AbortError") return "cancelled";
  if (name === "NotAllowedError") {
    return resource === "screen" ? "cancelled" : "denied";
  }
  return "error";
}

export async function requestCaptureStream(
  resource: CaptureResource,
  mediaDevices: MediaDevices = navigator.mediaDevices,
): Promise<MediaStream> {
  if (resource === "screen") {
    if (typeof mediaDevices.getDisplayMedia !== "function") {
      throw new DOMException("Screen capture unsupported", "NotFoundError");
    }
    return mediaDevices.getDisplayMedia({ video: true, audio: false });
  }
  return mediaDevices.getUserMedia(
    resource === "camera"
      ? { video: true, audio: false }
      : { video: false, audio: true },
  );
}

/**
 * Bitrate declarado por modalidade.
 *
 * Sem isto o `MediaRecorder` escolhe sozinho, e o tamanho do arquivo vira
 * resultado do aparelho em vez de decisao do produto - o que torna impossivel
 * dizer de antemao quanto tempo cabe. Declarar o bitrate e o que transforma o
 * teto de bytes num **teto de tempo previsivel**.
 *
 * 32 kbps de Opus e fala inteligivel com folga; 300 kbps de video e suficiente
 * para uma pessoa se rever, que e para o que a gravacao serve. Nenhum dos dois
 * alimenta analise: envoltoria RMS e diferenca de quadro nao passam pelo
 * `MediaRecorder`.
 */
export const MEDIA_BITS_PER_SECOND: Record<CaptureResource, number> = {
  microphone: 32_000,
  camera: 300_000,
  screen: 300_000,
};

/**
 * Folga para o overhead de container.
 *
 * WebM/MP4 acrescentam cabecalho, cues e alinhamento de cluster ao fluxo
 * codificado, e o bitrate nominal e alvo, nao garantia. Sem margem, uma gravacao
 * calculada para bater exatamente no teto o ultrapassaria - e seria recusada
 * justamente por ter sido calculada.
 */
export const MEDIA_SIZE_HEADROOM = 0.85;

/**
 * Ate quando cada modalidade pode **gravar**, derivado e nunca escrito a mao.
 *
 * Mudar um bitrate muda o teto junto. Um numero digitado ao lado do bitrate
 * ficaria mentindo no dia em que alguem ajustasse o outro - foi assim que 5 MB e
 * 60 minutos passaram a se contradizer.
 *
 * O que este teto **nao** limita: a sessao e a analise. Os coletores de sinal sao
 * independentes do `MediaRecorder`, entao a envoltoria e a diferenca de quadro
 * continuam cobrindo a sessao inteira depois que a gravacao para. A gravacao
 * interrompida vira cobertura declarada (`recording_capped`), nao falha.
 */
export const MEDIA_RECORDING_MAX_MS: Record<CaptureResource, number> =
  Object.fromEntries(
    (["screen", "camera", "microphone"] as const).map((resource) => [
      resource,
      Math.min(
        MAX_SESSION_MS,
        Math.floor(
          ((MAX_MEDIA_BYTES * MEDIA_SIZE_HEADROOM) /
            (MEDIA_BITS_PER_SECOND[resource] / 8)) *
            1000,
        ),
      ),
    ]),
  ) as Record<CaptureResource, number>;

const MIME_CANDIDATES: Record<CaptureResource, readonly string[]> = {
  screen: ["video/webm;codecs=vp8", "video/webm", "video/mp4"],
  camera: ["video/webm;codecs=vp8", "video/webm", "video/mp4"],
  microphone: [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ],
};

export interface CaptureRecorder {
  resource: CaptureResource;
  stream: MediaStream;
  recorder: MediaRecorder;
  chunks: Blob[];
  startedAt: number;
  /**
   * Instante em que a gravacao parou por ter atingido o teto de tamanho.
   *
   * `null` enquanto a gravacao acompanha a sessao. Preenchido, ele e a prova de
   * que a cobertura desta modalidade e **parcial por limite declarado** - e nao
   * por perda, que e `interrupted`. As duas coisas produzem cobertura parcial e
   * tem causas opostas.
   */
  cappedAt: number | null;
}

export function createCaptureRecorder(
  resource: CaptureResource,
  stream: MediaStream,
  Recorder: typeof MediaRecorder = MediaRecorder,
  onCapped?: (resource: CaptureResource) => void,
): CaptureRecorder {
  const mimeType = MIME_CANDIDATES[resource].find((candidate) =>
    Recorder.isTypeSupported(candidate),
  );
  /*
    Bitrate declarado, e nao escolhido pelo aparelho. E o que torna o teto de
    bytes um teto de **tempo** previsivel - ver `MEDIA_RECORDING_MAX_MS`.
  */
  const bitrate = MEDIA_BITS_PER_SECOND[resource];
  const options: MediaRecorderOptions =
    resource === "microphone"
      ? { audioBitsPerSecond: bitrate }
      : { videoBitsPerSecond: bitrate };
  if (mimeType) options.mimeType = mimeType;
  const recorder = new Recorder(stream, options);
  const handle: CaptureRecorder = {
    resource,
    stream,
    recorder,
    chunks: [],
    startedAt: Date.now(),
    cappedAt: null,
  };
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) handle.chunks.push(event.data);
  });
  recorder.start(1000);

  /*
    O teto para a **gravacao**, nunca a sessao nem a analise. A envoltoria RMS e a
    diferenca de quadro nao passam pelo `MediaRecorder`, entao seguem cobrindo a
    sessao inteira depois deste ponto.
  */
  const limit = MEDIA_RECORDING_MAX_MS[resource];
  if (limit < MAX_SESSION_MS) {
    globalThis.setTimeout(() => {
      if (handle.recorder.state === "inactive" || handle.cappedAt !== null) return;
      handle.cappedAt = Date.now();
      try {
        handle.recorder.stop();
      } catch {
        // Recorder ja encerrado por outro caminho: o marcador acima ja registrou
        // o motivo, e insistir no `stop` nao acrescenta nada.
      }
      onCapped?.(resource);
    }, limit);
  }

  return handle;
}

export function pauseCaptureRecorder(handle: CaptureRecorder) {
  if (handle.recorder.state === "recording") handle.recorder.pause();
}

export function resumeCaptureRecorder(handle: CaptureRecorder) {
  if (handle.recorder.state === "paused") handle.recorder.resume();
}

export async function stopCaptureRecorder(handle: CaptureRecorder) {
  const stopped = new Promise<void>((resolve) => {
    handle.recorder.addEventListener("stop", () => resolve(), { once: true });
  });
  if (handle.recorder.state !== "inactive") handle.recorder.stop();
  else return {
    blob: new Blob(handle.chunks, { type: handle.recorder.mimeType }),
    durationMs: Math.max(0, Date.now() - handle.startedAt),
  };
  await stopped;
  return {
    blob: new Blob(handle.chunks, { type: handle.recorder.mimeType }),
    durationMs: Math.max(0, Date.now() - handle.startedAt),
  };
}

export function stopCaptureTracks(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * A sessao pode comecar com o que este navegador realmente suporta?
 *
 * Regra do finding de iPhone: **`SCREEN_UNSUPPORTED` nao pode tornar a sessao
 * indisponivel.** O Safari do iPhone nao expoe `getDisplayMedia`, mas expoe
 * camera e microfone - e uma sessao com camera e microfone e uma sessao
 * legitima. Bloquear o inicio porque um terceiro recurso nao existe seria punir
 * a pessoa pela limitacao do navegador dela.
 *
 * A pergunta certa nao e "tudo que foi autorizado e suportado?" e sim
 * "**alguma coisa** autorizada e suportada?". Recurso autorizado mas nao
 * suportado simplesmente nao entra na captura; ele nao veta o resto.
 *
 * Esta regra vive aqui, e nao no JSX, porque e invariante de produto: escondida
 * dentro de uma expressao de render, ela voltaria a quebrar sem teste que
 * percebesse.
 */
export function canStartSession(
  authorized: Pick<Record<CaptureResource, boolean>, CaptureResource>,
  states: CaptureStateMap,
): boolean {
  const resources: CaptureResource[] = ["screen", "camera", "microphone"];
  return resources.some(
    (resource) => authorized[resource] && states[resource] !== "unsupported",
  );
}
