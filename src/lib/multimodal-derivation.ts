import type { AsrProvenance } from "@/lib/contracts/asr-provenance";
import {
  type TranscriptSubmission,
  type TranscriptUnavailableReason,
} from "@/lib/contracts/session-analysis";



// ---------------------------------------------------------------------------
// Web Speech API — tipos estruturais minimos.
//
// `SpeechRecognition` nao esta em `lib.dom` de forma estavel e ainda vive atras
// de prefixo em varios navegadores. Declaramos so a superficie que usamos: isso
// mantem o codigo tipado sem fingir que a API e universal.
// ---------------------------------------------------------------------------

interface SpeechAlternativeLike {
  readonly transcript: string;
}

interface SpeechResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: SpeechAlternativeLike;
}

export interface SpeechResultEventLike {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechResultLike>;
}

export interface SpeechErrorEventLike {
  readonly error: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  /**
   * Exige que o reconhecimento aconteca **no aparelho**.
   *
   * Ausente nos navegadores mais antigos, e por isso opcional no tipo. A
   * ausencia nao e detalhe: sem esta propriedade nao ha como pedir
   * processamento local, e a Web Speech API do Chrome pode mandar o audio para
   * um servico de reconhecimento remoto.
   */
  processLocally?: boolean;
  onresult: ((event: SpeechResultEventLike) => void) | null;
  onerror: ((event: SpeechErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/**
 * Disponibilidade do reconhecimento local, conforme o navegador responde.
 *
 * `downloadable` e `downloading` sao estados reais do Chrome: o pacote de
 * idioma existe e ainda nao esta no aparelho. Fundi-los com `unavailable`
 * esconderia que basta instalar.
 */
export const LOCAL_SPEECH_AVAILABILITIES = [
  "available",
  "downloadable",
  "downloading",
  "unavailable",
  "unsupported",
] as const;
export type LocalSpeechAvailability =
  (typeof LOCAL_SPEECH_AVAILABILITIES)[number];


export const SPEECH_QUALITY = "dictation" as const;
export type SpeechQuality = typeof SPEECH_QUALITY;

export interface SpeechAvailabilityQuery {
  langs: string[];
  processLocally: boolean;
  quality: SpeechQuality;
}

export type SpeechRecognitionConstructor = (new () => SpeechRecognitionLike) & {
  /** Chrome 138+. Ausente nos demais. */
  available?: (
    query: SpeechAvailabilityQuery,
  ) => Promise<string> | string;
  /**
   * Baixa o pacote de idioma para uso local. Chrome 138+.
   *
   * **Nunca chamada automaticamente.** Ver `installLocalSpeech`.
   */
  install?: (query: SpeechAvailabilityQuery) => Promise<boolean> | boolean;
};

export interface SpeechEnvironment {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

function speechEnvironment(): SpeechEnvironment {
  return typeof window === "undefined"
    ? {}
    : (window as unknown as SpeechEnvironment);
}

/**
 * Devolve o construtor real, ou `null`.
 *
 * `null` e uma resposta de primeira classe: Safari/iOS e navegadores sem a API
 * seguem com a sessao valida e transcricao `unavailable`, exatamente como a
 * ADR-0005 previu.
 */
export function detectSpeechRecognition(
  environment: SpeechEnvironment = speechEnvironment(),
): SpeechRecognitionConstructor | null {
  const candidate =
    environment.SpeechRecognition ?? environment.webkitSpeechRecognition;
  return typeof candidate === "function" ? candidate : null;
}


export interface TranscriptSegmentCapture {
  text: string;
  startOffsetMs: number;
  endOffsetMs: number;
}

export type TranscriptCapture =
  | {
      status: "available";
      text: string;
      truncated: boolean;
      segments: TranscriptSegmentCapture[];
    }
  | { status: "unavailable" | "failed"; reason: TranscriptUnavailableReason };

/** Idioma unico desta capability. A V1 nao oferece outro. */
export const TRANSCRIPT_LANG = "pt-BR" as const;

/**
 * O navegador reconhece pt-BR **no proprio aparelho**?
 *
 * ## Por que esta pergunta passou a existir
 *
 * A implementacao anterior chamava a si mesma de "transcricao on-device" e
 * usava `SpeechRecognition` sem pedir processamento local. Isso **nao garante
 * nada**: no Chrome, a Web Speech API pode mandar o audio para um servico de
 * reconhecimento remoto, e a pessoa nao teria como saber. A afirmacao estava no
 * comentario e nao no runtime.
 *
 * A regra passou a ser explicita:
 *
 * ```
 * TRANSCRIPTION_REMOTE_FALLBACK = FORBIDDEN_BY_DEFAULT
 * ```
 *
 * A consulta declara `quality: "dictation"` explicitamente. Sem isso a resposta
 * dependia do default da API - fora do nosso controle, e capaz de mudar entre
 * versoes do navegador - e podia descrever um perfil ajustado para turnos curtos
 * entre varios interlocutores, que nao e o que esta sessao e.
 *
 * **Nunca lanca.** Navegador sem a API estatica devolve `unsupported`, e quem
 * chama decide - o que nao pode acontecer e a duvida virar um envio silencioso.
 */
export async function probeLocalSpeechAvailability(
  environment: SpeechEnvironment = speechEnvironment(),
  lang: string = TRANSCRIPT_LANG,
): Promise<LocalSpeechAvailability> {
  const Recognition =
    environment.SpeechRecognition ?? environment.webkitSpeechRecognition;
  if (typeof Recognition !== "function") return "unsupported";
  if (typeof Recognition.available !== "function") return "unsupported";

  try {
    const answer = await Recognition.available(speechQuery(lang));
    return (LOCAL_SPEECH_AVAILABILITIES as readonly string[]).includes(answer)
      ? (answer as LocalSpeechAvailability)
      : "unavailable";
  } catch {
    // Uma sonda que estoura nao autoriza o caminho remoto.
    return "unsupported";
  }
}

/** A mesma consulta para sondar e para instalar. Divergir aqui seria instalar o
 * pacote de um perfil e reconhecer com outro. */
export function speechQuery(lang: string = TRANSCRIPT_LANG): SpeechAvailabilityQuery {
  return { langs: [lang], processLocally: true, quality: SPEECH_QUALITY };
}

/** O que a instalacao do pacote de idioma produziu. */
export type LocalSpeechInstallOutcome =
  | { status: "installed"; availability: LocalSpeechAvailability }
  | { status: "refused"; reason: "not_downloadable" | "unsupported" | "failed" };

/**
 * Instala o pacote de reconhecimento local, **a pedido explicito da pessoa**.
 *
 * ## Por que nunca automatico
 *
 * `install()` baixa dezenas de MB e escreve no aparelho de alguem. Disparar isso
 * porque a sonda respondeu `downloadable` transformaria "abrir a tela de sessao"
 * em consentimento para consumir a rede e o disco de quem abriu. A oferta e da
 * Elyra; a decisao e da pessoa.
 *
 * ## Por que so em `downloadable`
 *
 * `unavailable` significa que **nao ha pacote** para este idioma neste
 * navegador. Chamar `install()` ali fingiria a existencia de algo instalavel, e
 * a falha voltaria como erro tecnico em vez de como a resposta que ja se tinha.
 *
 * Depois de instalar, a disponibilidade e **consultada de novo**. Instalacao
 * bem-sucedida nao e prova de que o reconhecimento sera local: quem prova isso e
 * a sonda, e por isso ela roda outra vez.
 */
export async function installLocalSpeech(
  environment: SpeechEnvironment = speechEnvironment(),
  lang: string = TRANSCRIPT_LANG,
): Promise<LocalSpeechInstallOutcome> {
  const Recognition =
    environment.SpeechRecognition ?? environment.webkitSpeechRecognition;
  if (typeof Recognition !== "function" || typeof Recognition.install !== "function") {
    return { status: "refused", reason: "unsupported" };
  }

  const before = await probeLocalSpeechAvailability(environment, lang);
  if (before !== "downloadable") {
    // Nao ha o que instalar, e fingir que ha trocaria uma resposta clara por um
    // erro tecnico.
    return { status: "refused", reason: "not_downloadable" };
  }

  try {
    const installed = await Recognition.install(speechQuery(lang));
    if (installed === false) return { status: "refused", reason: "failed" };
  } catch {
    return { status: "refused", reason: "failed" };
  }

  /*
    Re-sonda obrigatoria. O reconhecimento so pode comecar se **esta** chamada
    responder `available` - a instalacao pode ter ficado em `downloading`, e
    tratar isso como pronto reabriria o caminho que a trava fecha.
  */
  return {
    status: "installed",
    availability: await probeLocalSpeechAvailability(environment, lang),
  };
}

export interface SessionTranscriber {
  /** Encerra o reconhecimento e resolve com o que realmente foi reconhecido. */
  stop(): Promise<TranscriptCapture>;
}

/** Teto do contrato. Acima disso o texto e cortado e marcado como truncado. */
export const TRANSCRIPT_MAX_CHARS = 20_000;

/**
 * Voz medida acima da qual "nenhuma fala" deixa de ser uma explicacao aceitavel.
 *
 * Dois segundos. Abaixo disso, um tossido, um clique de mouse ou um ruido de
 * fundo poderiam sustentar a contradicao sozinhos, e trocar o motivo seria
 * afirmar fala onde houve ruido. Acima, a envoltoria mediu voz por tempo
 * suficiente para que o silencio do reconhecedor seja fato sobre **ele**.
 */
export const VOICED_CONTRADICTION_MIN_MS = 2_000;

const SPEECH_DENIED_ERRORS = new Set(["not-allowed", "service-not-allowed"]);

/**
 * Inicia a transcricao on-device.
 *
 * `null` quando a API nao existe — quem chama traduz isso em
 * `speech_api_unsupported` e segue. O texto acumulado vem **somente** de
 * resultados finais: interim results mudam sozinhos e persistir um deles seria
 * guardar uma frase que a pessoa nunca disse.
 */
/**
 * Quantas vezes o reconhecimento pode ser reiniciado numa sessao.
 *
 * O `onend` do Chrome dispara sozinho depois de um trecho de silencio, mesmo com
 * `continuous = true`. Sem reinicio, uma sessao de tres minutos perdia a
 * transcricao inteira porque o navegador encerrou a instancia nos primeiros
 * segundos - foi exatamente o que a validacao fisica #1 mostrou.
 *
 * O teto existe para o outro lado do erro: um `onend` imediato e repetido viraria
 * laco de reinicio, queimando CPU e microfone. Vinte reinicios cobrem uma sessao
 * longa com silencios; alem disso, algo esta errado e a resposta certa e parar.
 */
export const SPEECH_MAX_RESTARTS = 20;

/**
 * Intervalo minimo entre reinicios, em ms.
 *
 * Protege contra o caso em que `start()` termina imediatamente em `onend`: sem
 * este piso, o teto de reinicios seria consumido em milissegundos.
 */
export const SPEECH_RESTART_DEBOUNCE_MS = 250;

export interface StartTranscriptionOptions {
  environment?: SpeechEnvironment;
  /** Relogio da sessao, em ms desde o inicio. */
  elapsedMs?: () => number;
  /**
   * Disponibilidade local ja verificada por quem chama.
   *
   * Passada de fora porque a sonda e assincrona e o inicio da captura nao pode
   * esperar por ela dentro deste construtor.
   */
  localAvailability?: LocalSpeechAvailability;
  /** Agendador do reinicio. Injetavel para o teste nao depender de tempo real. */
  schedule?: (handler: () => void, ms: number) => void;
}

/**
 * Inicia o reconhecimento de fala da sessao.
 *
 * `null` quando a API nao existe - quem chama traduz isso em
 * `speech_api_unsupported` e segue. O texto acumulado vem **somente** de
 * resultados finais: interim results mudam sozinhos, e persistir um deles seria
 * guardar uma frase que a pessoa nunca disse.
 *
 * ## Processamento local: cinco condicoes, e todas obrigatorias
 *
 * O reconhecimento so comeca quando **todas** valem:
 *
 * 1. `SpeechRecognition` existe;
 * 2. a capability local foi sondada;
 * 3. a sonda respondeu `"available"`;
 * 4. a instancia expoe `processLocally`;
 * 5. `processLocally = true` pegou, verificado apos a atribuicao.
 *
 * Qualquer outro estado devolve um transcritor que ja nasce indisponivel:
 * `local_speech_unavailable` quando o navegador respondeu que nao consegue, e
 * `local_speech_unverifiable` quando nao houve resposta que pudesse provar.
 *
 * ```
 * TRANSCRIPTION_REMOTE_FALLBACK = FORBIDDEN
 * UNPROVEN_LOCAL_PROCESSING     = UNAVAILABLE
 * ```
 *
 * Recusar e a decisao, e ausencia de prova nao e prova de ausencia de risco.
 * Nao ha caminho aqui que envie audio para fora sem que a arquitetura tenha
 * sido mudada de proposito.
 */
export function startSessionTranscription(
  environmentOrOptions: SpeechEnvironment | StartTranscriptionOptions = {},
  elapsedMsArg: () => number = () => 0,
): SessionTranscriber | null {
  const options: StartTranscriptionOptions =
    "environment" in environmentOrOptions ||
    "elapsedMs" in environmentOrOptions ||
    "localAvailability" in environmentOrOptions ||
    "schedule" in environmentOrOptions
      ? (environmentOrOptions as StartTranscriptionOptions)
      : { environment: environmentOrOptions as SpeechEnvironment };

  const environment = options.environment ?? speechEnvironment();
  const elapsedMs = options.elapsedMs ?? elapsedMsArg;
  const schedule =
    options.schedule ??
    ((handler: () => void, ms: number) => {
      globalThis.setTimeout(handler, ms);
    });

  const Recognition = detectSpeechRecognition(environment);
  if (!Recognition) return null;

  /*
    Sem reconhecimento local de pt-BR, o transcritor nasce indisponivel.

    Nao e degradacao: e a recusa do unico caminho alternativo, que seria mandar a
    voz da pessoa para um servico remoto sem que ela soubesse.
  */

  if (options.localAvailability !== "available") {
    const reason: TranscriptUnavailableReason =
      options.localAvailability === undefined ||
      options.localAvailability === "unsupported"
        ? // Nao houve resposta: nao da para provar processamento local.
          "local_speech_unverifiable"
        : // Houve resposta, e ela foi negativa.
          "local_speech_unavailable";
    return {
      async stop() {
        return { status: "unavailable", reason };
      },
    };
  }

  let recognition: SpeechRecognitionLike;
  try {
    recognition = new Recognition();
  } catch {
    return null;
  }

  /*
    Segunda trava, na instancia.

    A sonda estatica diz o que o **navegador** consegue; esta diz o que **esta
    instancia** aceita. Sem `processLocally` na instancia nao ha como pedir
    processamento local, e "o browser provavelmente respeita" nao e uma garantia
    de privacidade - e uma esperanca.

    Capability de privacidade precisa ser observavel no runtime, e por isso o
    valor e conferido depois de atribuido: um getter sem setter aceitaria a
    atribuicao em silencio e continuaria falso.
  */
  if (!("processLocally" in recognition)) {
    return {
      async stop() {
        return { status: "unavailable", reason: "local_speech_unverifiable" };
      },
    };
  }

  recognition.processLocally = true;
  if (recognition.processLocally !== true) {
    return {
      async stop() {
        return { status: "unavailable", reason: "local_speech_unverifiable" };
      },
    };
  }

  recognition.lang = TRANSCRIPT_LANG;
  recognition.continuous = true;
  recognition.interimResults = false;

  const finals: string[] = [];
  const segments: TranscriptSegmentCapture[] = [];
  // Fim do segmento anterior. O inicio de um segmento e o fim do anterior: e a
  // aproximacao mais honesta possivel sem timestamp de fala, e ela nao afirma
  // nada sobre silencio dentro do intervalo.
  let previousEndMs = 0;
  let failure: TranscriptUnavailableReason | null = null;
  let ended = false;
  let stopRequested = false;
  let restarts = 0;
  let notifyEnd: (() => void) | null = null;

  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result?.isFinal && result.length > 0) {
        const text = result[0]?.transcript?.trim();
        if (text) {
          finals.push(text);
          const endOffsetMs = Math.max(0, Math.round(elapsedMs()));
          segments.push({
            text,
            startOffsetMs: Math.min(previousEndMs, endOffsetMs),
            endOffsetMs,
          });
          previousEndMs = endOffsetMs;
        }
      }
    }
  };

  recognition.onerror = (event) => {
    // `no-speech` e `aborted` sao encerramentos normais de um trecho em que a
    // pessoa nao falou: nao sao falha de reconhecimento, e nao impedem reinicio.
    if (event.error === "no-speech" || event.error === "aborted") return;
    failure = SPEECH_DENIED_ERRORS.has(event.error)
      ? "speech_api_denied"
      : "recognition_failed";
  };

  recognition.onend = () => {
    /*
      O reinicio e o coracao desta correcao.

      `onend` dispara sozinho depois de silencio, mesmo com `continuous = true`.
      Antes, isso encerrava o reconhecimento pelo resto da sessao: tres minutos
      de fala viravam zero palavras porque o navegador desistiu no primeiro
      silencio.

      Reinicia **so** enquanto: ninguem pediu para parar, nenhum erro fatal
      aconteceu, e o teto de reinicios nao foi atingido. Os resultados ja
      obtidos vivem em `finals` e `segments`, que sobrevivem ao reinicio - o
      reconhecedor recomeca, a transcricao nao.
    */
    if (!stopRequested && failure === null && restarts < SPEECH_MAX_RESTARTS) {
      restarts += 1;
      schedule(() => {
        if (stopRequested || failure !== null) {
          ended = true;
          notifyEnd?.();
          return;
        }
        try {
          recognition.start();
        } catch {
          // Reinicio recusado encerra o reconhecimento, e nao a sessao.
          ended = true;
          notifyEnd?.();
        }
      }, SPEECH_RESTART_DEBOUNCE_MS);
      return;
    }

    ended = true;
    notifyEnd?.();
  };

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    async stop() {
      // Pedido explicito de parada: a partir daqui `onend` nao reinicia mais.
      stopRequested = true;

      if (!ended) {
        const finished = new Promise<void>((resolve) => {
          notifyEnd = resolve;
        });
        try {
          recognition.stop();
        } catch {
          recognition.onend = null;
          return { status: "failed", reason: "recognition_failed" };
        }
        await finished;
      }
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;

      if (failure) return { status: "failed", reason: failure };

      const joined = finals.join(" ").trim();
      if (!joined) {
        /*
          Sem texto, e sem saber ainda se houve voz. Quem decide entre
          "nao houve fala" e "houve fala e o reconhecedor nao a transcreveu" e
          `buildTranscriptSubmission`, que tem acesso a envoltoria de audio - a
          segunda fonte, independente deste reconhecedor.
        */
        return { status: "unavailable", reason: "no_speech_detected" };
      }
      return {
        status: "available",
        text: joined.slice(0, TRANSCRIPT_MAX_CHARS),
        truncated: joined.length > TRANSCRIPT_MAX_CHARS,
        segments,
      };
    },
  };
}

/** Palavras por espaco em branco. Simples, e igual dos dois lados da fronteira. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/u).length;
}

/**
 * Junta o texto reconhecido com o tempo falado medido pela envoltoria.
 *
 * As duas metades vem de fontes diferentes de proposito: o texto vem do
 * reconhecimento, o denominador de `speech_rate` vem do audio. Sem tempo falado
 * medido nao ha ritmo de fala honesto, entao a transcricao **desce** para
 * indisponivel em vez de viajar com um denominador inventado.
 */
export function buildTranscriptSubmission(
  capture: TranscriptCapture | null,
  voicedDurationMs: number,
  durationMs: number,
  /**
   * Qual motor produziu o texto.
   *
   * Opcional e `null` por omissao para nao quebrar chamadores historicos, e
   * porque `null` ja tem significado proprio no contrato: **nao registrado**.
   * Um `default` que dissesse "nativo" faria toda submissao sem proveniencia
   * declarar um motor que pode nao ter sido o que rodou.
   */
  provenance: AsrProvenance | null = null,
): TranscriptSubmission | null {
  if (capture === null) return null;

  if (capture.status !== "available") {
    /*
      A correcao que a validacao fisica #1 obrigou.

      `no_speech_detected` afirma que **nao houve fala** - uma afirmacao sobre a
      pessoa, feita a partir de uma unica fonte. Mas a Elyra tem uma segunda,
      independente do reconhecedor: a envoltoria RMS do audio.

      Quando ela mede voz e o reconhecedor volta vazio, quem falhou foi o
      reconhecedor. Dizer "nenhuma fala foi reconhecida" seria transformar uma
      falha de ferramenta em constatacao sobre o silencio de alguem.

      A troca so vale para `no_speech_detected`: `speech_api_denied`,
      `recognition_failed` e `local_speech_unavailable` ja nomeiam a causa certa,
      e sobrescreve-las apagaria informacao.
    */
    if (
      capture.reason === "no_speech_detected" &&
      voicedDurationMs >= VOICED_CONTRADICTION_MIN_MS
    ) {
      return {
        status: "unavailable",
        reason: "speech_detected_but_not_transcribed",
      };
    }
    return { status: capture.status, reason: capture.reason };
  }

  const words = countWords(capture.text);
  const voiced = Math.min(
    Math.round(Math.max(0, voicedDurationMs)),
    Math.round(Math.max(0, durationMs)),
  );
  if (words < 1 || voiced < 1) {
    return { status: "unavailable", reason: "no_speech_detected" };
  }

  return {
    status: "available",
    text: capture.text,
    wordCount: words,
    voicedDurationMs: voiced,
    truncated: capture.truncated,
    provenance,
  };
}

// ---------------------------------------------------------------------------
// Envoltoria RMS de audio (Web Audio API).
// ---------------------------------------------------------------------------

export interface AudioAnalyserLike {
  fftSize: number;
  readonly frequencyBinCount: number;
  getByteTimeDomainData(array: Uint8Array): void;
}

export interface AudioContextLike {
  createAnalyser(): AudioAnalyserLike;
  createMediaStreamSource(stream: MediaStream): { connect(node: AudioAnalyserLike): void };
  close(): Promise<void> | void;
}

export interface AudioEnvironment {
  AudioContext?: new () => AudioContextLike;
  webkitAudioContext?: new () => AudioContextLike;
}

function audioEnvironment(): AudioEnvironment {
  return typeof window === "undefined"
    ? {}
    : (window as unknown as AudioEnvironment);
}

/** Intervalo de amostragem da envoltoria. Casa com `PAUSE_MINIMUM_MS`/4. */
export const ENVELOPE_FRAME_MS = 100;

export interface AudioEnvelopeCollector {
  readonly frameMs: number;
  stop(): { envelope: number[]; frameMs: number };
}

/**
 * Amostra a energia RMS do microfone durante a sessao.
 *
 * Guarda **energia por quadro**, nunca audio: o buffer de amostras e lido,
 * reduzido a um unico numero e descartado no mesmo tick. Nao existe ponto neste
 * coletor em que a fala fique retida em memoria.
 */
export function startAudioEnvelopeCollection(
  stream: MediaStream,
  environment: AudioEnvironment = audioEnvironment(),
  frameMs: number = ENVELOPE_FRAME_MS,
): AudioEnvelopeCollector | null {
  const Context = environment.AudioContext ?? environment.webkitAudioContext;
  if (typeof Context !== "function") return null;

  let context: AudioContextLike;
  let analyser: AudioAnalyserLike;
  try {
    context = new Context();
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    context.createMediaStreamSource(stream).connect(analyser);
  } catch {
    return null;
  }

  const envelope: number[] = [];
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  const timer = globalThis.setInterval(() => {
    try {
      analyser.getByteTimeDomainData(buffer);
    } catch {
      return;
    }
    let sum = 0;
    for (const sample of buffer) {
      // 128 e o zero do dominio de tempo em 8 bits; o desvio dele e a amplitude.
      const centered = (sample - 128) / 128;
      sum += centered * centered;
    }
    envelope.push(Math.sqrt(sum / buffer.length));
  }, frameMs);

  return {
    frameMs,
    stop() {
      globalThis.clearInterval(timer);
      void Promise.resolve(context.close()).catch(() => undefined);
      return { envelope, frameMs };
    },
  };
}

// ---------------------------------------------------------------------------
// Diferenca de quadros (canvas 2D).
// ---------------------------------------------------------------------------

/** Resolucao reduzida. Mede mudanca global, e nao detalhe do rosto de ninguem. */
export const FRAME_SAMPLE_WIDTH = 32;
export const FRAME_SAMPLE_HEIGHT = 24;
export const FRAME_INTERVAL_MS = 200;

export interface FrameCanvasLike {
  width: number;
  height: number;
  getContext(contextId: "2d"): FrameContextLike | null;
}

export interface FrameContextLike {
  drawImage(
    source: CanvasImageSource,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void;
  getImageData(
    x: number,
    y: number,
    width: number,
    height: number,
  ): { data: Uint8ClampedArray };
}

export interface FrameDifferenceCollector {
  stop(): { frameDifferences: number[] };
}

/**
 * Media da diferenca absoluta entre quadros consecutivos, em escala de cinza.
 *
 * Mede **mudanca de pixel**. Nao e postura, nao e intencao, nao e emocao e nao
 * e reconhecimento facial: a imagem e reduzida a 32x24 antes de qualquer conta,
 * uma resolucao em que nao existe rosto a identificar. Nenhum quadro e gravado
 * — so o numero que resume a diferenca sobrevive ao tick.
 */
export function startFrameDifferenceCollection(
  video: HTMLVideoElement,
  createCanvas: () => FrameCanvasLike | null = () =>
    typeof document === "undefined" ? null : document.createElement("canvas"),
  intervalMs: number = FRAME_INTERVAL_MS,
): FrameDifferenceCollector | null {
  const canvas = createCanvas();
  const context = canvas?.getContext("2d") ?? null;
  if (!canvas || !context) return null;

  canvas.width = FRAME_SAMPLE_WIDTH;
  canvas.height = FRAME_SAMPLE_HEIGHT;

  const frameDifferences: number[] = [];
  let previous: Float32Array | null = null;

  const timer = globalThis.setInterval(() => {
    let pixels: Uint8ClampedArray;
    try {
      context.drawImage(video, 0, 0, FRAME_SAMPLE_WIDTH, FRAME_SAMPLE_HEIGHT);
      pixels = context.getImageData(
        0,
        0,
        FRAME_SAMPLE_WIDTH,
        FRAME_SAMPLE_HEIGHT,
      ).data;
    } catch {
      // Quadro indisponivel (aba oculta, stream encerrado) nao vira medida.
      return;
    }

    const gray = new Float32Array(FRAME_SAMPLE_WIDTH * FRAME_SAMPLE_HEIGHT);
    for (let index = 0; index < gray.length; index += 1) {
      const offset = index * 4;
      gray[index] =
        (0.299 * (pixels[offset] ?? 0) +
          0.587 * (pixels[offset + 1] ?? 0) +
          0.114 * (pixels[offset + 2] ?? 0)) /
        255;
    }

    if (previous) {
      let sum = 0;
      for (let index = 0; index < gray.length; index += 1) {
        sum += Math.abs((gray[index] ?? 0) - (previous[index] ?? 0));
      }
      frameDifferences.push(sum / gray.length);
    }
    previous = gray;
  }, intervalMs);

  return {
    stop() {
      globalThis.clearInterval(timer);
      previous = null;
      return { frameDifferences };
    },
  };
}
