import type { AsrSession } from "@/lib/speech/local-model-engine";
import { VAD_WINDOW_SAMPLES, type VadSession } from "@/lib/speech/vad";
import type { AsrProvenance } from "@/lib/contracts/asr-provenance";
import { logicalPath, sanitizeMessage } from "@/lib/qa/asr-load-forensics";

/** OnnxWrapper oficial, 16 kHz: 64 de contexto + janela publica de 512. */
export const SILERO_CONTEXT_SAMPLES = 64;

/**
 * Fiacao com os runtimes reais — o unico arquivo que conhece ONNX e Whisper.
 *
 * Tudo abaixo dele (VAD, aceitacao, orquestracao) fala com interfaces de dois ou
 * tres metodos e por isso e testavel sem WASM, sem modelo e sem navegador. Tudo
 * acima dele (a tela de captura) fala com `LocalSpeechEngine`. Esta camada e a
 * unica que carrega dependencia pesada, e ela entra por `import()` dinamico.
 *
 * ## Nenhum caminho remoto
 *
 * ```
 * allowRemoteModels = false
 * localModelPath    = /asr/models/
 * wasmPaths         = /asr/runtime/
 * ```
 *
 * Se algo tentar buscar o modelo no Hub, **falha** em vez de vazar - e a CSP
 * deste repositorio recusaria a conexao de qualquer forma, porque `connect-src`
 * e `'self'` mais o Supabase.
 */

/**
 * Os modelos que este repositorio conhece.
 *
 * Vocabulario fechado de proposito: com uma uniao de literais, `ASR_MODEL_BYTES`
 * deixa de ser um mapa de `string` e passa a ter chaves conhecidas. A diferenca
 * nao e estetica — e o que faz `ASR_MODEL_BYTES[ASR_MODEL_ID]` devolver um
 * `number`, e nao um `number | undefined` que alguem resolveria com `?? 0`.
 *
 * Um `?? 0` ali produziria "~2 MB" numa tela que pede autorizacao para baixar
 * 254 MB. Ausencia de dado viraria um numero pequeno e plausivel.
 */
export const ASR_MODEL_IDS = [
  "onnx-community/whisper-base",
  "onnx-community/whisper-small",
] as const;
export type AsrModelId = (typeof ASR_MODEL_IDS)[number];


export const ASR_MODEL_ID: AsrModelId = "onnx-community/whisper-small";


export const ASR_QA_COMPARATOR_MODEL_ID: AsrModelId = "onnx-community/whisper-base";

/**
 * Bytes aproximados de cada conjunto, para a tela avisar ANTES do download.
 *
 * Escritos por **modelo**, e nao por papel. Indexar por `ASR_MODEL_ID` de um
 * lado e por `ASR_QA_COMPARATOR_MODEL_ID` do outro sobreviveu a esta troca de
 * default por acidente: os valores teriam sido trocados junto com os papeis, e
 * a tela passaria a anunciar 79,7 MB para um download de 251,8 MB.
 */
export const ASR_MODEL_BYTES: Readonly<Record<AsrModelId, number>> = {
  "onnx-community/whisper-base": 79_664_191,
  "onnx-community/whisper-small": 251_846_613,
};

export const ASR_MODEL_PATH = "/asr/models/";
/** A quantizacao realmente pedida ao `pipeline()` abaixo. Ver `ASR_DTYPE`. */
export const ASR_QUANTIZATION = "q8";
export const ASR_RUNTIME = "transformers.js";
/**
 * Versao do runtime que executa o Whisper.
 *
 * Constante literal, e nao `import` de `package.json`: o manifesto inteiro
 * entraria no bundle do cliente so para carregar um numero. O preco disso e que
 * ela poderia envelhecer sozinha no primeiro `npm update` — passar a dizer
 * 3.7.6 enquanto outro runtime produz o texto. Por isso existe um teste que le
 * `package.json` e falha quando os dois divergem: a garantia esta la, e nao na
 * disciplina de quem atualiza a dependencia.
 */
export const ASR_RUNTIME_VERSION = "3.7.6";
/** Identificador do VAD que recorta os candidatos antes do Whisper. */
export const VAD_MODEL_VERSION = "silero_vad_v5";
export const ASR_RUNTIME_PATH = "/asr/runtime/";
export const VAD_MODEL_URL = "/asr/vad/silero_vad.onnx";
export const VAD_MODEL_SHA256 =
  "1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3";

/** Tamanho exato do Silero, conferido contra o digest acima no provisionamento. */
export const VAD_MODEL_BYTES = 2_327_524;


export const ASR_DOWNLOAD_BYTES = ASR_MODEL_BYTES[ASR_MODEL_ID] + VAD_MODEL_BYTES;

export type RuntimeFailure =
  | "unsupported"
  | "assets_missing"
  | "integrity_failed"
  | "load_failed"
  | "cancelled";

export interface RuntimeLoad<T> {
  value: T | null;
  failure: RuntimeFailure | null;
  /**
   * Detalhe do erro, **sanitizado**, para o QA poder discriminar a causa.
   *
   * `failure` e um rotulo de cinco valores; ele responde "deu errado" e nao
   * "onde". A H1-B fisica devolveu `load_failed` para o `small`, o que cabe em
   * quatro causas com quatro correcoes diferentes.
   *
   * Ausente em todo caminho de produto: quem chama sem pedir instrumentacao
   * recebe exatamente o que recebia antes.
   */
  detail?: { errorName: string | null; errorMessage: string | null } | null;
}

/** Le o corpo relatando bytes recebidos. Sem stream, cai no `arrayBuffer()` e relata uma vez. */
async function readBody(response: Response, onBytes?: (loaded: number) => void): Promise<ArrayBuffer> {
  if (!onBytes || !response.body) {
    const buffer = await response.arrayBuffer();
    onBytes?.(buffer.byteLength);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onBytes(loaded);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function isModelRequest(input: RequestInfo | URL): boolean {
  try {
    const base = globalThis.location?.href ?? "http://localhost/";
    const raw = typeof Request !== "undefined" && input instanceof Request ? input.url : String(input);
    const url = new URL(raw, base);
    return url.origin === new URL(base).origin && url.pathname.startsWith(ASR_MODEL_PATH);
  } catch {
    return false;
  }
}

/**
 * Amarra o `AbortSignal` do preparo aos downloads do Whisper.
 *
 * O `transformers.js` 3.7.6 chama `fetch(url)` sem sinal, e `pipeline()` nao
 * aceita um. Sem isto, cancelar — ou o watchdog de stall — so mudava a tela: os
 * ~250 MB continuavam descendo e o slot ficava em "cancelando" ate o download
 * acabar. Pelo Quick Tunnel (~0,35 MB/s) isso sao minutos.
 *
 * Vale so durante o carregamento, so para `/asr/models/` da propria origem e so
 * quando a chamada nao trouxe sinal proprio. Um escopo encerrado vira passagem
 * pura, mesmo que outro o tenha embrulhado por cima. O cache do runtime nao muda.
 */
function scopeModelFetch(signal: AbortSignal | undefined): () => void {
  const previous = globalThis.fetch;
  if (!signal || typeof previous !== "function") return () => {};
  let active = true;
  const scoped: typeof fetch = (input, init) =>
    active && !init?.signal && isModelRequest(input)
      ? previous(input, { ...init, signal })
      : previous(input, init);
  globalThis.fetch = scoped;
  return () => {
    active = false;
    if (globalThis.fetch === scoped) globalThis.fetch = previous;
  };
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ---------------------------------------------------------------------------
// VAD
// ---------------------------------------------------------------------------

/** Superficie minima do ONNX Runtime Web que usamos. */
interface OrtLike {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (
    type: string,
    data: Float32Array | BigInt64Array,
    dims: number[],
  ) => unknown;
  InferenceSession: {
    create(buffer: ArrayBuffer): Promise<{
      release(): Promise<void>;
      run(feeds: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number> }>>;
    }>;
  };
}

/**
 * Carrega o Silero VAD, **verificando o digest antes de instanciar**.
 *
 * O modelo define quando o Whisper e chamado. Um arquivo trocado mudaria essa
 * decisao em silencio, e a camada que existe para impedir fabricacao passaria a
 * decidir por outro criterio sem que nada no codigo mudasse.
 */
export async function loadVadSession(
  signal?: AbortSignal,
  onBytes?: (loaded: number) => void,
): Promise<RuntimeLoad<VadSession>> {
  if (typeof crypto?.subtle?.digest !== "function") {
    return { value: null, failure: "unsupported" };
  }

  let buffer: ArrayBuffer;
  try {
    const response = await fetch(VAD_MODEL_URL, { signal });
    if (!response.ok) return { value: null, failure: "assets_missing" };
    buffer = await readBody(response, onBytes);
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return { value: null, failure: "cancelled" };
    }
    return { value: null, failure: "assets_missing" };
  }

  if ((await sha256Hex(buffer)) !== VAD_MODEL_SHA256) {
    return { value: null, failure: "integrity_failed" };
  }

  try {
    const ort = (await import("onnxruntime-web")) as unknown as OrtLike;
    ort.env.wasm.wasmPaths = ASR_RUNTIME_PATH;
    // Sem cross-origin isolation nao ha `SharedArrayBuffer`: uma thread.
    ort.env.wasm.numThreads = 1;

    const session = await ort.InferenceSession.create(buffer);
    if (signal?.aborted) {
      await session.release();
      return { value: null, failure: "cancelled" };
    }

    /*
      Estado recorrente do Silero v5: `[2, 1, 128]`.

      Ele **e** a memoria do detector entre janelas, e por isso vive aqui e nao
      no chamador. `reset()` cria um estado novo - reaproveitar o anterior faria
      uma sessao herdar o contexto acustico da anterior, e a decisao sobre a fala
      de alguem passaria a depender de quem falou antes.
    */
    let state = new Float32Array(2 * 128);
    let context = new Float32Array(SILERO_CONTEXT_SAMPLES);

    return {
      value: {
        dispose: () => session.release(),
        reset() {
          state = new Float32Array(2 * 128);
          context = new Float32Array(SILERO_CONTEXT_SAMPLES);
        },
        async process(window: Float32Array) {
          if (window.length !== VAD_WINDOW_SAMPLES) throw new Error("silero_window_must_be_512");
          const modelInput = new Float32Array(SILERO_CONTEXT_SAMPLES + VAD_WINDOW_SAMPLES);
          modelInput.set(context, 0);
          modelInput.set(window, SILERO_CONTEXT_SAMPLES);
          const feeds = {
            input: new ort.Tensor("float32", modelInput, [1, modelInput.length]),
            state: new ort.Tensor("float32", state, [2, 1, 128]),
            sr: new ort.Tensor("int64", BigInt64Array.from([BigInt(16000)]), []),
          };
          const output = await session.run(feeds);
          const next = output.stateN?.data;
          if (next) state = Float32Array.from(next as ArrayLike<number>);
          context = modelInput.slice(-SILERO_CONTEXT_SAMPLES);
          return Number(output.output?.data?.[0] ?? 0);
        },
      },
      failure: null,
    };
  } catch {
    return { value: null, failure: "load_failed" };
  }
}

// ---------------------------------------------------------------------------
// Whisper
// ---------------------------------------------------------------------------

export interface AsrLoadOptions {
  signal?: AbortSignal;
  /** Progresso agregado do download, em 0-1. `null` quando indeterminado. */
  onProgress?: (fraction: number | null) => void;
  /**
   * Recebe cada evento de progresso do runtime, ja com caminho logico.
   *
   * O preparo usa isto para somar bytes por arquivo e alimentar o watchdog de
   * stall; o modo de QA, para saber **em que arquivo** o carregamento parou — o
   * erro final do `transformers.js` nao diz.
   */
  onLoadEvent?: (event: { status: string; file: string; loaded?: number; total?: number }) => void;
  /**
   * Qual modelo carregar. Ausente significa o padrao — e e assim que fica em
   * todo caminho de produto.
   *
   * O parametro existe **so** para a comparacao de QA. Ele nao muda
   * `ASR_MODEL_ID`, nao muda a proveniencia gravada nas sessoes reais, e nao
   * tem caminho de UI fora do modo de QA.
   */
  modelId?: string;
}

interface TransformersLike {
  env: {
    allowRemoteModels: boolean;
    allowLocalModels: boolean;
    localModelPath: string;
    backends: { onnx: { wasm: { wasmPaths: string; numThreads: number } } };
  };
  pipeline: (
    task: string,
    model: string,
    options: Record<string, unknown>,
  ) => Promise<
    ((audio: Float32Array, options: Record<string, unknown>) => Promise<{ text?: string }>) & { dispose(): Promise<void> }
  >;
}

/**
 * Carrega o Whisper local.
 *
 * `import()` dinamico: o pacote nao entra no first load, e so desce para quem
 * realmente inicia uma sessao com transcricao autorizada **e** sem
 * reconhecimento nativo local disponivel.
 */
export async function loadAsrSession(
  options: AsrLoadOptions = {},
): Promise<RuntimeLoad<AsrSession>> {
  const releaseFetch = scopeModelFetch(options.signal);
  try {
    const transformers = (await import(
      "@huggingface/transformers"
    )) as unknown as TransformersLike;
    const { env, pipeline } = transformers;

    // Fail-closed de rede: nenhum caminho busca o modelo fora daqui.
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = ASR_MODEL_PATH;
    env.backends.onnx.wasm.wasmPaths = ASR_RUNTIME_PATH;
    env.backends.onnx.wasm.numThreads = 1;

    const transcriber = await pipeline(
      "automatic-speech-recognition",
      options.modelId ?? ASR_MODEL_ID,
      {
        dtype: {
          encoder_model: ASR_QUANTIZATION,
          decoder_model_merged: ASR_QUANTIZATION,
        },
        device: "wasm",
        progress_callback: (event: {
          status?: string;
          progress?: number;
          file?: string;
          loaded?: number;
          total?: number;
        }) => {
          options.onLoadEvent?.({
            status: event?.status ?? "",
            file: logicalPath(event?.file),
            loaded: event?.loaded,
            total: event?.total,
          });
          if (!options.onProgress) return;
          options.onProgress(
            typeof event?.progress === "number" ? event.progress / 100 : null,
          );
        },
      },
    );

    if (options.signal?.aborted) {
      await transcriber.dispose();
      return { value: null, failure: "cancelled" };
    }

    return {
      value: {
        dispose: () => transcriber.dispose(),
        async transcribe(pcm: Float32Array) {
          const output = await transcriber(pcm, {
            language: "portuguese",
            task: "transcribe",
            /*
              Os trechos ja chegam com no maximo 30 s - o teto e aplicado no VAD,
              onde o corte pode cair numa pausa. `chunk_length_s` fica aqui como
              rede: se algum dia um trecho maior escapar, o pipeline reparte em
              vez de truncar em silencio.
            */
            chunk_length_s: 30,
            return_timestamps: false,
          });
          /*
            `no_speech_prob` **nao** e exposta pelo pipeline do transformers.js
            3.7.6 - o termo nao aparece uma vez sequer no bundle. O campo fica
            ausente de proposito: `acceptSegment` trata `undefined` como "sem
            opiniao" em vez de tratar como zero, e a documentacao registra
            `NO_SPEECH_MODEL_GATE = UNAVAILABLE_IN_RUNTIME` em vez de afirmar uma
            barreira que nao existe.
          */
          return { text: output?.text ?? "" };
        },
      },
      failure: null,
    };
  } catch (error) {
    if (options.signal?.aborted || (error as Error)?.name === "AbortError") {
      return { value: null, failure: "cancelled" };
    }
    const message = error instanceof Error ? error.message : String(error);
    const missing =
      message.includes("404") ||
      message.toLowerCase().includes("failed to fetch") ||
      message.toLowerCase().includes("not found");
    return {
      value: null,
      failure: missing ? "assets_missing" : "load_failed",
      /*
        O detalhe sobe junto. Antes ele morria aqui, e quem chamava so via
        `load_failed` - inclusive a comparacao A/B, que por isso nao conseguiu
        dizer nada sobre o `small` no Android.
      */
      detail: {
        errorName: error instanceof Error ? error.name : null,
        errorMessage: sanitizeMessage(message),
      },
    };
  } finally {
    releaseFetch();
  }
}

/**
 * Os ativos do ASR estao no servidor?
 *
 * Um `HEAD` barato, para a tela poder oferecer o download em vez de comecar a
 * carregar e falhar. `false` nao e erro: e `download_required`.
 */
export async function asrAssetsPresent(
  modelId: string = ASR_MODEL_ID,
): Promise<boolean> {
  try {
    const response = await fetch(
      `${ASR_MODEL_PATH}${modelId}/config.json`,
      { method: "HEAD" },
    );
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * A proveniencia do Whisper local, montada a partir das constantes que este
 * arquivo realmente usa para carregar o modelo.
 *
 * Ela e derivada, e nao digitada de novo: um objeto literal repetindo
 * "whisper-base" e "q8" continuaria dizendo isso depois de alguem trocar o
 * modelo tres linhas acima, e a transcricao passaria a ser gravada sob o nome
 * do modelo anterior.
 *
 * Isso deixou de ser hipotese em 2026-09-10, quando o default virou `small`:
 * um literal aqui teria gravado `whisper-base` em toda transcricao feita pelo
 * `small`, e o dossie inteiro atribuiria o texto ao modelo errado.
 */
export const LOCAL_WHISPER_PROVENANCE: AsrProvenance = {
  engine: "local_whisper",
  model: ASR_MODEL_ID,
  quantization: ASR_QUANTIZATION,
  runtime: ASR_RUNTIME,
  runtimeVersion: ASR_RUNTIME_VERSION,
  vad: VAD_MODEL_VERSION,
};

/**
 * Proveniencia de um modelo arbitrario, para a comparacao poder rotular cada
 * lado com a identidade certa.
 *
 * Deriva das mesmas constantes que o `pipeline()` usa. Um objeto montado a mao
 * na tela de QA diria "q8" para sempre, inclusive depois de alguem mudar o
 * `dtype` — e a comparacao passaria a atribuir um resultado a uma quantizacao
 * que nao produziu aquele texto.
 */
export function localWhisperProvenance(modelId: string): AsrProvenance {
  return { ...LOCAL_WHISPER_PROVENANCE, model: modelId };
}
