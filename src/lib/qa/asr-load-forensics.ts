/**
 * Onde exatamente o carregamento do modelo quebrou.
 *
 * ## Por que este modulo existe
 *
 * A H1-B fisica no Android devolveu `load_failed` para o `whisper-small` q8.
 * Isso nao e um diagnostico: e a ausencia de um. `load_failed` cabe em
 * "faltou arquivo", "o WASM nao subiu", "o ONNX nao parseou" e "acabou a
 * memoria" — quatro causas com quatro correcoes diferentes, e nenhuma delas
 * dedutivel do rotulo.
 *
 * Pior: parte dessa perda foi minha. A comparacao A/B chamava
 * `loadAsrSession()` e devolvia so `session.value`, jogando fora o campo
 * `failure` que o loader ja produzia. O primeiro elo quebrado nao foi perdido
 * pelo navegador — foi descartado pelo instrumento.
 *
 * ## O que se pode afirmar, e o que nao
 *
 * A camada de assets ja foi eliminada por medicao: os sete arquivos do `small`
 * baixaram pelo mesmo HTTPS do aparelho com bytes e sha256 corretos, o decoder
 * de 157 MB incluido. Entao o elo quebrado esta no cliente.
 *
 * Este modulo **nao** adivinha qual. Ele registra o que o runtime deixou ver —
 * os eventos de progresso, o ultimo arquivo concluido, a classe e a mensagem do
 * erro — e classifica com regras explicitas. Onde as regras nao alcancam, a
 * resposta e `unknown`, e nao um palpite plausivel.
 *
 * `LOAD_FAILED != MODEL_BAD`, e `PLAUSIBLE != MEASURED`.
 */

/**
 * Vocabulario fechado do primeiro elo quebrado.
 *
 * Fechado de proposito: um campo de texto livre aqui viraria trinta grafias da
 * mesma causa, e a proxima pessoa a ler o dossie nao conseguiria agrupar nada.
 */
export const BROKEN_LINKS = [
  "asset_fetch",
  "asset_integrity",
  "runtime_init",
  "encoder_load",
  "decoder_load",
  "memory_allocation",
  "unknown",
] as const;
export type BrokenLink = (typeof BROKEN_LINKS)[number];

/** Um evento de progresso do `transformers.js`, ja sem nada sensivel. */
export interface LoadEvent {
  status: string;
  /** Caminho **logico** do arquivo. Nunca URL completa, nunca query. */
  file: string;
  loaded?: number;
  total?: number;
}

export interface LoadFailureInput {
  events: readonly LoadEvent[];
  errorName: string | null;
  errorMessage: string | null;
}

const ENCODER = "encoder_model";
const DECODER = "decoder_model_merged";

/**
 * Assinaturas de falta de memoria.
 *
 * Sao mensagens reais do V8 e do Emscripten/ONNX Runtime. A lista e explicita
 * porque "memoria" e a conclusao mais facil de chutar e a mais cara de errar:
 * se o diagnostico disser OOM e a causa for outra, a correcao vai ser reduzir
 * o modelo — e o problema continua la.
 */
const MEMORY_SIGNATURES = [
  "array buffer allocation failed",
  "out of memory",
  "oom",
  "cannot enlarge memory",
  "memory access out of bounds",
  "failed to allocate",
  "allocation failed",
  "invalid array buffer length",
  "resizablearraybuffer",
];

/** Assinaturas de runtime WASM que nem chegou a existir. */
const RUNTIME_SIGNATURES = [
  "no available backend",
  "backend not found",
  "wasm",
  "webassembly",
  "instantiate",
  "compileerror",
  "linkerror",
];

/** Assinaturas de rede/arquivo ausente. */
const FETCH_SIGNATURES = [
  "failed to fetch",
  "networkerror",
  "404",
  "not found",
  "unexpected token",
  "load model",
];

function matches(message: string, signatures: readonly string[]): boolean {
  return signatures.some((signature) => message.includes(signature));
}

function sawFile(events: readonly LoadEvent[], needle: string): boolean {
  return events.some((event) => event.file?.includes(needle));
}

function completedFile(events: readonly LoadEvent[], needle: string): boolean {
  return events.some((event) => event.status === "done" && event.file?.includes(needle));
}

/**
 * Classifica o primeiro elo quebrado.
 *
 * A ordem das regras **e** a decisao, e ela nao e arbitraria:
 *
 *  1. memoria vem primeiro porque uma falha de alocacao no meio do decoder
 *     tambem produz uma mensagem de "falhou ao carregar o modelo" — classificar
 *     por posicao antes de olhar a mensagem esconderia a causa real;
 *  2. runtime vem antes de encoder/decoder porque, sem WASM, nenhum dos dois
 *     chega a ser tentado;
 *  3. so depois a posicao no fluxo decide entre encoder e decoder.
 */
export function classifyBrokenLink(input: LoadFailureInput): BrokenLink {
  const message = (input.errorMessage ?? "").toLowerCase();
  const name = (input.errorName ?? "").toLowerCase();

  if (name === "rangeerror" || matches(message, MEMORY_SIGNATURES)) {
    return "memory_allocation";
  }

  /*
    Nenhum evento e mensagem de WASM: o runtime nao subiu.

    A checagem de eventos importa. `wasm` tambem aparece em mensagens de erro
    de sessao ONNX, e sem ela um decoder que estourou seria classificado como
    runtime que nem comecou.
  */
  if (input.events.length === 0 && matches(message, RUNTIME_SIGNATURES)) {
    return "runtime_init";
  }

  if (completedFile(input.events, DECODER)) {
    // Os dois arquivos desceram inteiros; o que quebrou foi depois deles.
    return matches(message, RUNTIME_SIGNATURES) ? "runtime_init" : "unknown";
  }

  if (sawFile(input.events, DECODER) || completedFile(input.events, ENCODER)) {
    return "decoder_load";
  }

  if (sawFile(input.events, ENCODER)) {
    return "encoder_load";
  }

  if (input.events.length > 0) {
    // Comecou a buscar arquivos e parou antes do encoder: e busca de asset.
    return matches(message, FETCH_SIGNATURES) ? "asset_fetch" : "unknown";
  }

  if (matches(message, RUNTIME_SIGNATURES)) return "runtime_init";
  if (matches(message, FETCH_SIGNATURES)) return "asset_fetch";
  return "unknown";
}

/**
 * Mensagem de erro sem nada que nao possa ser lido num relatorio.
 *
 * Remove URLs inteiras (podem carregar host e query), corta o comprimento e
 * normaliza espaco. Nao existe fala, PCM, token ou cookie num erro de
 * carregamento de modelo — mas o corte e barato e a alternativa e confiar.
 */
export function sanitizeMessage(message: string | null | undefined): string | null {
  if (!message) return null;
  return message
    .replace(/https?:\/\/\S+/gu, "[url]")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Caminho logico de um arquivo, a partir do que o runtime informou.
 *
 * Guarda `onnx/encoder_model_quantized.onnx`, e nao a URL. O host do tunel
 * muda a cada rodada e nao ajuda ninguem a entender o que quebrou.
 */
export function logicalPath(file: string | null | undefined): string {
  if (!file) return "";
  const withoutQuery = file.split("?")[0] ?? "";
  const marker = "/asr/models/";
  const index = withoutQuery.indexOf(marker);
  const path = index >= 0 ? withoutQuery.slice(index + marker.length) : withoutQuery;
  return path.replace(/^https?:\/\/[^/]+\//u, "");
}

export interface MemorySample {
  /** `null` quando o navegador nao expoe `performance.memory`. */
  usedHeapBytes: number | null;
  /** Quanto o navegador ja reservou para o heap. */
  totalHeapBytes: number | null;
  /**
   * O **teto** do heap JS neste aparelho.
   *
   * E o numero que falta para transformar "provavelmente memoria" em medicao.
   * Sozinho, um `usedHeapBytes` de 400 MB nao diz nada; ao lado de um teto de
   * 512 MB, diz tudo.
   *
   * A H1-B mediu o `base` com pico de 149,2 MB de heap para 77 MB de pesos - o
   * `transformers.js` mantem os bytes do modelo no heap JS antes de entregar ao
   * ONNX, entao o pico fica em torno do dobro. Se a mesma proporcao valer para
   * o `small`, sao ~500 MB. Se e ou nao acima do teto **deste** aparelho, so o
   * aparelho responde.
   */
  heapLimitBytes: number | null;
  /** RAM do aparelho em GB, quando o navegador informa. */
  deviceMemoryGb: number | null;
}

/**
 * Heap JS, quando existe.
 *
 * `performance.memory` e nao-padrao, so existe em Chromium, e mesmo la conta
 * **so o heap de JavaScript** — os pesos do ONNX vivem na memoria linear do
 * WASM, que ela nao enxerga. Por isso um `usedHeapBytes` modesto nao prova que
 * havia memoria sobrando, e o relatorio nao deve deixar ninguem concluir isso.
 */
export function sampleMemory(): MemorySample {
  const memory = (
    globalThis.performance as unknown as {
      memory?: {
        usedJSHeapSize?: number;
        totalJSHeapSize?: number;
        jsHeapSizeLimit?: number;
      };
    }
  )?.memory;
  const device = (globalThis.navigator as unknown as { deviceMemory?: number })
    ?.deviceMemory;
  const numeric = (value: unknown): number | null =>
    typeof value === "number" ? value : null;
  return {
    usedHeapBytes: numeric(memory?.usedJSHeapSize),
    totalHeapBytes: numeric(memory?.totalJSHeapSize),
    heapLimitBytes: numeric(memory?.jsHeapSizeLimit),
    deviceMemoryGb: numeric(device),
  };
}

export function memoryMeasurementAvailable(): boolean {
  return sampleMemory().usedHeapBytes !== null;
}
