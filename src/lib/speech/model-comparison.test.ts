import { describe, expect, it, vi } from "vitest";

import {
  compareAsrModels,
  fingerprintCandidates,
  type AsrLoadAttempt,
  type AsrModelVariant,
} from "@/lib/speech/model-comparison";
import type { LoadEvent } from "@/lib/qa/asr-load-forensics";
import type { AsrSession } from "@/lib/speech/local-model-engine";
import { VAD_SAMPLE_RATE, type VadSession } from "@/lib/speech/vad";

/**
 * O experimento A/B, provado sem um Whisper por perto.
 *
 * O VAD aqui e **o de verdade** — `detectSpeechSegments` roda o codigo de
 * producao sobre um `VadSession` falso que responde probabilidade. Isso importa:
 * a afirmacao "o VAD roda uma vez so" nao vale nada se o teste substituir o VAD.
 */

const SECOND = VAD_SAMPLE_RATE;

/** Fala de 0-3 s, silencio de 3-13 s, fala de 13-15 s. */
const SPEECH_RANGES: readonly [number, number][] = [
  [0, 3 * SECOND],
  [13 * SECOND, 15 * SECOND],
];

function buildPcm(): Float32Array {
  return new Float32Array(15 * SECOND);
}

/**
 * `VadSession` falso que conta suas proprias execucoes.
 *
 * `reset()` e chamado exatamente uma vez por execucao de `detectSpeechSegments`,
 * entao conta-lo mede quantas vezes o VAD rodou — sem espionar o modulo.
 */
function createVad(): VadSession & { resets: number } {
  let cursor = 0;
  const session = {
    resets: 0,
    reset() {
      session.resets += 1;
      cursor = 0;
    },
    process(window: Float32Array): number {
      const start = cursor;
      cursor += window.length;
      const speech = SPEECH_RANGES.some(
        ([from, to]) => start >= from && start < to,
      );
      return speech ? 0.95 : 0.01;
    },
  };
  return session;
}

interface Recorder {
  session: AsrSession;
  seen: number[];
  disposed: boolean;
}

function createAsr(text: (index: number) => string): Recorder {
  const recorder: Recorder = {
    seen: [],
    disposed: false,
    session: {
      async transcribe(pcm: Float32Array) {
        recorder.seen.push(pcm.length);
        return { text: text(recorder.seen.length - 1) };
      },
      dispose() {
        recorder.disposed = true;
      },
    },
  };
  return recorder;
}

/** Carga bem-sucedida, na forma que o `AsrLoader` agora exige. */
function ok(session: AsrSession, events: LoadEvent[] = []): AsrLoadAttempt {
  return { session, failure: null, errorName: null, errorMessage: null, events };
}

/** Carga que falhou, com a causa preservada. */
function broke(
  failure: string,
  errorName: string | null,
  errorMessage: string | null,
  events: LoadEvent[] = [],
): AsrLoadAttempt {
  return { session: null, failure, errorName, errorMessage, events };
}

const VARIANTS: AsrModelVariant[] = [
  { id: "onnx-community/whisper-base", label: "Base q8", approxBytes: 79_680_351 },
  { id: "onnx-community/whisper-small", label: "Small q8", approxBytes: 251_846_613 },
];

describe("comparacao A/B de modelos de ASR", () => {
  it("B — o VAD roda uma unica vez, para os dois modelos", async () => {
    const vad = createVad();
    const recorders = new Map<string, Recorder>();

    await compareAsrModels({
      pcm: buildPcm(),
      vad,
      variants: VARIANTS,
      load: async (modelId) => {
        const recorder = createAsr(() => "texto");
        recorders.set(modelId, recorder);
        return ok(recorder.session);
      },
    });

    /*
      Se algum dia alguem recortar de novo para o segundo modelo, este numero
      vira 2 — e o experimento deixa de ser controlado sem ninguem perceber.
    */
    expect(vad.resets).toBe(1);
  });

  it("A — os dois modelos recebem exatamente os mesmos candidates", async () => {
    const recorders = new Map<string, Recorder>();
    const comparison = await compareAsrModels({
      pcm: buildPcm(),
      vad: createVad(),
      variants: VARIANTS,
      load: async (modelId) => {
        const recorder = createAsr(() => "texto");
        recorders.set(modelId, recorder);
        return ok(recorder.session);
      },
    });

    expect(comparison.candidates).toHaveLength(2);
    const base = recorders.get("onnx-community/whisper-base")!.seen;
    const small = recorders.get("onnx-community/whisper-small")!.seen;
    expect(base).toHaveLength(2);
    expect(small).toEqual(base);
    expect(comparison.vadRuns).toBe(1);
  });

  it("A — a impressao digital dos candidates e estavel e derivada dos limites", () => {
    const candidates = [
      { startOffsetMs: 0, endOffsetMs: 3000, pcm: new Float32Array(48_000), speechProbability: 0.95 },
      { startOffsetMs: 13_000, endOffsetMs: 15_000, pcm: new Float32Array(32_000), speechProbability: 0.9 },
    ];
    const fingerprint = fingerprintCandidates(candidates);
    expect(fingerprint).toBe("0-3000-48000-0.9500|13000-15000-32000-0.9000");

    // Um recorte diferente produz impressao diferente. E esse o ponto dela.
    const moved = [{ ...candidates[0]!, endOffsetMs: 2900 }, candidates[1]!];
    expect(fingerprintCandidates(moved)).not.toBe(fingerprint);
  });

  it("D — os modelos nunca ficam carregados ao mesmo tempo", async () => {
    let live = 0;
    let peak = 0;

    const comparison = await compareAsrModels({
      pcm: buildPcm(),
      vad: createVad(),
      variants: VARIANTS,
      load: async () => {
        live += 1;
        peak = Math.max(peak, live);
        return ok({
          async transcribe() {
            return { text: "texto" };
          },
          dispose() {
            live -= 1;
          },
        });
      },
    });

    expect(peak).toBe(1);
    expect(comparison.peakConcurrentModels).toBe(1);
    expect(live).toBe(0);
  });

  it("D — o primeiro modelo e descartado antes de o segundo subir", async () => {
    const order: string[] = [];
    await compareAsrModels({
      pcm: buildPcm(),
      vad: createVad(),
      variants: VARIANTS,
      load: async (modelId) => {
        order.push(`load:${modelId}`);
        return ok({
          async transcribe() {
            return { text: "texto" };
          },
          dispose() {
            order.push(`dispose:${modelId}`);
          },
        });
      },
    });

    expect(order).toEqual([
      "load:onnx-community/whisper-base",
      "dispose:onnx-community/whisper-base",
      "load:onnx-community/whisper-small",
      "dispose:onnx-community/whisper-small",
    ]);
  });

  it("C — o resultado nao carrega PCM", async () => {
    const comparison = await compareAsrModels({
      pcm: buildPcm(),
      vad: createVad(),
      variants: VARIANTS,
      load: async () => ok(createAsr(() => "texto").session),
    });

    /*
      Varre o resultado inteiro por qualquer array tipado. O PCM e a voz do
      Demo; o que sai deste modulo pode ser copiado para um relatorio, e um
      Float32Array escondido tres niveis abaixo viraria audio num arquivo de QA.
    */
    const offenders: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (ArrayBuffer.isView(node) || node instanceof ArrayBuffer) {
        offenders.push(path);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) walk(value, `${path}.${key}`);
      }
    };
    walk(comparison, "comparison");

    expect(offenders).toEqual([]);
    expect(comparison.pcmPersisted).toBe(false);

    /*
      Nenhuma chave chamada `pcm`, em nenhum nivel.

      Comparar por chave, e nao por substring no JSON: `"pcm"` casa com
      `"pcmPersisted"`, e um teste que passa por acaso hoje reprova por acaso
      amanha. Foi exatamente esse erro que a primeira versao deste teste
      cometeu.
    */
    const keys = new Set<string>();
    const collect = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(collect);
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          keys.add(key);
          collect(value);
        }
      }
    };
    collect(comparison);
    expect(keys.has("pcm")).toBe(false);
  });

  it("E — cada lado carrega a identidade do seu proprio modelo", async () => {
    const comparison = await compareAsrModels({
      pcm: buildPcm(),
      vad: createVad(),
      variants: VARIANTS,
      load: async () => ok(createAsr(() => "texto").session),
    });

    expect(comparison.runs.map((run) => run.modelId)).toEqual([
      "onnx-community/whisper-base",
      "onnx-community/whisper-small",
    ]);
    for (const run of comparison.runs) {
      expect(run.quantization).toBe("q8");
      expect(run.runtime).toBe("transformers.js");
      expect(run.runtimeVersion).toBe("3.7.6");
      expect(run.vad).toBe("silero_vad_v5");
    }
  });

  it("18 — modelo que nao carrega vira falha explicita, e nao silencio", async () => {
    const comparison = await compareAsrModels({
      pcm: buildPcm(),
      vad: createVad(),
      variants: VARIANTS,
      load: async (modelId) =>
        modelId.endsWith("small")
          ? broke("load_failed", "Error", "Aborted(). Build with -sASSERTIONS", [
              { status: "done", file: "onnx-community/whisper-small/onnx/encoder_model_quantized.onnx" },
            ])
          : ok(createAsr(() => "texto").session),
    });

    const small = comparison.runs.find((run) => run.modelId.endsWith("small"))!;
    expect(small.loaded).toBe(false);
    expect(small.failure).toBe("load_failed");
    expect(small.transcription).toBeNull();

    /*
      A causa sobrevive ate aqui.

      Esta e a regressao da H1-B: o Android disse `load_failed` e nada mais,
      porque este objeto nao carregava o primeiro elo quebrado. O encoder tinha
      descido inteiro, entao a quebra e no decoder - e agora isso e afirmavel
      sem repetir o teste fisico.
    */
    expect(small.brokenLink).toBe("decoder_load");
    expect(small.lastCompletedFile).toContain("encoder_model_quantized.onnx");
    expect(small.loadErrorMessage).toContain("Aborted()");
    expect(small.loadFailure).toBe("load_failed");

    // E o outro lado continua valido: meia comparacao e informacao.
    const base = comparison.runs.find((run) => run.modelId.endsWith("base"))!;
    expect(base.loaded).toBe(true);
    expect(base.text).not.toBe("");
  });

  it("18 — um modelo que estoura nao herda o texto do outro", async () => {
    const comparison = await compareAsrModels({
      pcm: buildPcm(),
      vad: createVad(),
      variants: VARIANTS,
      load: async (modelId) => {
        if (modelId.endsWith("small")) {
          return ok({
            async transcribe() {
              throw new Error("out of memory");
            },
          });
        }
        return ok(createAsr(() => "o texto do base").session);
      },
    });

    const small = comparison.runs.find((run) => run.modelId.endsWith("small"))!;
    expect(small.failure).toBe("transcribe_failed");
    expect(small.text).toBe("");
    expect(small.text).not.toContain("base");
  });

  it("um trecho que falha nao derruba os outros trechos do mesmo modelo", async () => {
    let call = 0;
    const comparison = await compareAsrModels({
      pcm: buildPcm(),
      vad: createVad(),
      variants: [VARIANTS[0]!],
      load: async () =>
        ok({
          async transcribe() {
            call += 1;
            if (call === 1) throw new Error("falhou o primeiro");
            return { text: "o segundo trecho saiu" };
          },
        }),
    });

    const run = comparison.runs[0]!;
    expect(run.failure).toBe("transcribe_failed");
    expect(run.text).toBe("o segundo trecho saiu");
  });

  it("H/I — a comparacao nao fala com rede nenhuma", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await compareAsrModels({
      pcm: buildPcm(),
      vad: createVad(),
      variants: VARIANTS,
      load: async () => ok(createAsr(() => "texto").session),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("metrica de memoria ausente e `null`, e nunca zero", async () => {
    const original = Object.getOwnPropertyDescriptor(performance, "memory");
    // Remove a API nao-padrao, para simular Firefox e Safari.
    delete (performance as unknown as { memory?: unknown }).memory;

    const comparison = await compareAsrModels({
      pcm: buildPcm(),
      vad: createVad(),
      variants: [VARIANTS[0]!],
      load: async () => ok(createAsr(() => "texto").session),
    });

    expect(comparison.runs[0]!.metrics.peakHeapBytes).toBeNull();
    expect(comparison.runs[0]!.metrics.peakHeapBytes).not.toBe(0);
    if (original) Object.defineProperty(performance, "memory", original);
  });
});
