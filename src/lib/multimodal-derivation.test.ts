import { LOCAL_WHISPER_PROVENANCE } from "@/lib/speech/browser-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildTranscriptSubmission,
  countWords,
  detectSpeechRecognition,
  startAudioEnvelopeCollection,
  startFrameDifferenceCollection,
  startSessionTranscription,
  type AudioContextLike,
  type FrameCanvasLike,
  type SpeechErrorEventLike,
  type SpeechRecognitionLike,
  type SpeechResultEventLike,
} from "@/lib/multimodal-derivation";

/**
 * Derivacao on-device sem aparelho fisico.
 *
 * Nenhum teste aqui depende de microfone, camera ou navegador real: todas as
 * APIs sao injetadas. E deliberado — a ADR-0005 exige que o pipeline seja
 * verificavel em CI, e um teste que precisasse de iPhone nunca rodaria.
 *
 * `PHYSICAL_DEVICE_QA` continua sendo outra coisa, e continua pendente.
 */

// ---------------------------------------------------------------------------
// Web Speech API simulada
// ---------------------------------------------------------------------------

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = true;
  /*
    Um reconhecedor sem `processLocally` nao pode provar processamento local, e o
    transcritor recusa inicia-lo - corretamente. Esta fake declara a propriedade
    porque estes testes exercitam o reconhecimento, e nao o portao; o caso da
    propriedade ausente esta coberto em `multimodal-transcription.test.ts`.
  */
  processLocally = false;
  onresult: ((event: SpeechResultEventLike) => void) | null = null;
  onerror: ((event: SpeechErrorEventLike) => void) | null = null;
  onend: (() => void) | null = null;
  started = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }

  start() {
    this.started = true;
  }

  stop() {
    this.onend?.();
  }

  abort() {
    this.onend?.();
  }

  emitFinal(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: true, length: 1, 0: { transcript } },
      ] as unknown as SpeechResultEventLike["results"],
    });
  }

  emitInterim(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [
        { isFinal: false, length: 1, 0: { transcript } },
      ] as unknown as SpeechResultEventLike["results"],
    });
  }

  emitError(error: string) {
    this.onerror?.({ error });
  }
}

beforeEach(() => {
  FakeRecognition.instances = [];
});

describe("detectSpeechRecognition", () => {
  it("devolve null quando o navegador nao oferece a API", () => {
    expect(detectSpeechRecognition({})).toBeNull();
  });

  it("aceita a variante com prefixo do webkit", () => {
    expect(
      detectSpeechRecognition({ webkitSpeechRecognition: FakeRecognition }),
    ).toBe(FakeRecognition);
  });

  it("ignora um valor que nao e construtor", () => {
    expect(
      detectSpeechRecognition({
        SpeechRecognition: "nao sou construtor" as never,
      }),
    ).toBeNull();
  });
});

describe("startSessionTranscription", () => {
  /*
    Estes testes exercitam o **reconhecimento**, e nao o portao de privacidade.

    Por isso declaram `localAvailability: "available"` explicitamente: sem essa
    precondicao o transcritor recusa iniciar, que e o comportamento correto e
    esta coberto em `multimodal-transcription.test.ts`. Declarar a precondicao
    mantem cada teste falando de uma coisa so.
  */
  it("devolve null em navegador sem suporte, sem inventar texto", () => {
    expect(
      startSessionTranscription({
        environment: {},
        localAvailability: "available",
      }),
    ).toBeNull();
  });

  it("acumula somente resultados finais", async () => {
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: FakeRecognition },
      localAvailability: "available",
    });
    const recognition = FakeRecognition.instances[0]!;
    recognition.emitInterim("texto provisorio que muda sozinho");
    recognition.emitFinal("Falei sobre o meu dia.");
    recognition.emitFinal("Estou cansado.");

    const capture = await transcriber!.stop();
    expect(capture.status).toBe("available");
    if (capture.status !== "available") return;
    expect(capture.text).toBe("Falei sobre o meu dia. Estou cansado.");
    expect(capture.text).not.toContain("provisorio");
  });

  it("configura pt-BR e desliga resultados provisorios", () => {
    startSessionTranscription({
      environment: { SpeechRecognition: FakeRecognition },
      localAvailability: "available",
    });
    const recognition = FakeRecognition.instances[0]!;
    expect(recognition.lang).toBe("pt-BR");
    expect(recognition.interimResults).toBe(false);
    expect(recognition.continuous).toBe(true);
  });

  it("relata ausencia de fala em vez de texto vazio", async () => {
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: FakeRecognition },
      localAvailability: "available",
    });
    const capture = await transcriber!.stop();
    expect(capture).toEqual({
      status: "unavailable",
      reason: "no_speech_detected",
    });
  });

  it("traduz permissao negada em motivo tipado", async () => {
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: FakeRecognition },
      localAvailability: "available",
    });
    FakeRecognition.instances[0]!.emitError("not-allowed");
    const capture = await transcriber!.stop();
    expect(capture).toEqual({
      status: "failed",
      reason: "speech_api_denied",
    });
  });

  it("nao trata no-speech como falha de reconhecimento", async () => {
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: FakeRecognition },
      localAvailability: "available",
    });
    FakeRecognition.instances[0]!.emitError("no-speech");
    const capture = await transcriber!.stop();
    expect(capture.status).toBe("unavailable");
  });

  it("descarta texto reconhecido quando o reconhecimento falha", async () => {
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: FakeRecognition },
      localAvailability: "available",
    });
    const recognition = FakeRecognition.instances[0]!;
    recognition.emitFinal("comeco de frase");
    recognition.emitError("network");
    const capture = await transcriber!.stop();
    // Uma transcricao parcial publicada como completa seria pior que nenhuma.
    expect(capture).toEqual({
      status: "failed",
      reason: "recognition_failed",
    });
  });
});

describe("countWords", () => {
  it("conta palavras separadas por qualquer espaco", () => {
    expect(countWords("uma  duas\ntres")).toBe(3);
  });

  it("conta zero para texto vazio", () => {
    expect(countWords("   ")).toBe(0);
  });
});

describe("buildTranscriptSubmission", () => {
  it("devolve null quando nao houve captura de transcricao", () => {
    expect(buildTranscriptSubmission(null, 1000, 5000)).toBeNull();
  });

  it("preserva o motivo de indisponibilidade", () => {
    expect(
      buildTranscriptSubmission(
        { status: "unavailable", reason: "speech_api_unsupported" },
        0,
        5000,
      ),
    ).toEqual({ status: "unavailable", reason: "speech_api_unsupported" });
  });

  it("monta a submissao com contagem e tempo falado", () => {
    const submission = buildTranscriptSubmission(
      { status: "available", text: "uma duas tres", truncated: false, segments: [] },
      12_000,
      300_000,
    );
    expect(submission).toEqual({
      status: "available",
      text: "uma duas tres",
      wordCount: 3,
      voicedDurationMs: 12_000,
      truncated: false,
      // Sem motor declarado a proveniencia e ausente - e ausente NAO e "nativo".
      provenance: null,
    });
  });

  it("carrega a proveniencia do motor que produziu o texto", () => {

    const submission = buildTranscriptSubmission(
      { status: "available", text: "uma duas tres", truncated: false, segments: [] },
      12_000,
      300_000,
      LOCAL_WHISPER_PROVENANCE,
    );
    expect(submission).toMatchObject({
      status: "available",
      provenance: { engine: "local_whisper", model: "onnx-community/whisper-small" },
    });
  });

  it("desce para indisponivel sem tempo falado medido", () => {
    // Sem denominador nao ha `speech_rate` honesto. Melhor nao ter transcricao
    // do que ter uma com ritmo de fala inventado.
    const submission = buildTranscriptSubmission(
      { status: "available", text: "uma duas", truncated: false, segments: [] },
      0,
      300_000,
    );
    expect(submission).toEqual({
      status: "unavailable",
      reason: "no_speech_detected",
    });
  });

  it("nunca deixa o tempo falado exceder a duracao da sessao", () => {
    const submission = buildTranscriptSubmission(
      { status: "available", text: "uma duas", truncated: false, segments: [] },
      900_000,
      10_000,
    );
    expect(submission).toMatchObject({
      status: "available",
      voicedDurationMs: 10_000,
    });
  });
});

// ---------------------------------------------------------------------------
// Web Audio API simulada
// ---------------------------------------------------------------------------

describe("startAudioEnvelopeCollection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function audioEnvironment(sample: number) {
    const analyser = {
      fftSize: 0,
      frequencyBinCount: 4,
      getByteTimeDomainData: (array: Uint8Array) => array.fill(sample),
    };
    const context: AudioContextLike = {
      createAnalyser: () => analyser,
      createMediaStreamSource: () => ({ connect: () => undefined }),
      close: () => undefined,
    };
    return { AudioContext: class { constructor() { return context; } } as never };
  }

  it("devolve null sem Web Audio API", () => {
    expect(
      startAudioEnvelopeCollection({} as MediaStream, {}),
    ).toBeNull();
  });

  it("amostra energia e nao audio", () => {
    const collector = startAudioEnvelopeCollection(
      {} as MediaStream,
      audioEnvironment(255),
      100,
    );
    vi.advanceTimersByTime(350);
    const { envelope, frameMs } = collector!.stop();
    expect(frameMs).toBe(100);
    expect(envelope).toHaveLength(3);
    // 255 e o extremo do dominio: energia proxima de 1, e nenhuma amostra bruta.
    expect(envelope[0]).toBeCloseTo(0.9922, 3);
  });

  it("registra silencio como energia zero, nao como ausencia", () => {
    const collector = startAudioEnvelopeCollection(
      {} as MediaStream,
      audioEnvironment(128),
      100,
    );
    vi.advanceTimersByTime(200);
    expect(collector!.stop().envelope).toEqual([0, 0]);
  });

  it("para de amostrar depois de encerrado", () => {
    const collector = startAudioEnvelopeCollection(
      {} as MediaStream,
      audioEnvironment(200),
      100,
    );
    vi.advanceTimersByTime(200);
    const first = collector!.stop().envelope.length;
    vi.advanceTimersByTime(1000);
    expect(collector!.stop().envelope).toHaveLength(first);
  });
});

// ---------------------------------------------------------------------------
// Canvas simulado
// ---------------------------------------------------------------------------

describe("startFrameDifferenceCollection", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function canvasFactory(values: number[]) {
    let call = 0;
    const canvas: FrameCanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: (_x, _y, width, height) => {
          const level = values[Math.min(call, values.length - 1)] ?? 0;
          call += 1;
          const data = new Uint8ClampedArray(width * height * 4);
          data.fill(level);
          return { data };
        },
      }),
    };
    return () => canvas;
  }

  it("devolve null sem contexto 2d", () => {
    expect(
      startFrameDifferenceCollection({} as HTMLVideoElement, () => null),
    ).toBeNull();
  });

  it("nao produz medida a partir de um unico quadro", () => {
    const collector = startFrameDifferenceCollection(
      {} as HTMLVideoElement,
      canvasFactory([10]),
      100,
    );
    vi.advanceTimersByTime(100);
    expect(collector!.stop().frameDifferences).toEqual([]);
  });

  it("mede zero quando a imagem nao muda", () => {
    const collector = startFrameDifferenceCollection(
      {} as HTMLVideoElement,
      canvasFactory([90, 90, 90]),
      100,
    );
    vi.advanceTimersByTime(300);
    const { frameDifferences } = collector!.stop();
    expect(frameDifferences).toHaveLength(2);
    expect(frameDifferences.every((value) => value === 0)).toBe(true);
  });

  it("mede diferenca normalizada entre quadros consecutivos", () => {
    const collector = startFrameDifferenceCollection(
      {} as HTMLVideoElement,
      canvasFactory([0, 255]),
      100,
    );
    vi.advanceTimersByTime(200);
    const { frameDifferences } = collector!.stop();
    expect(frameDifferences).toHaveLength(1);
    expect(frameDifferences[0]).toBeCloseTo(1, 5);
  });

  it("reduz a imagem antes de qualquer conta", () => {
    const canvas: FrameCanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        getImageData: (_x, _y, width, height) => ({
          data: new Uint8ClampedArray(width * height * 4),
        }),
      }),
    };
    startFrameDifferenceCollection({} as HTMLVideoElement, () => canvas, 100);
    // 32x24 em escala de cinza: resolucao em que nao existe rosto a identificar.
    expect(canvas.width).toBe(32);
    expect(canvas.height).toBe(24);
  });
});
