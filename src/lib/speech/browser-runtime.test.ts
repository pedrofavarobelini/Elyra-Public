import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { loadAsrSession, loadVadSession, VAD_MODEL_SHA256 } from "./browser-runtime";

const runtime = vi.hoisted(() => ({
  ort: { env: { wasm: { wasmPaths: "", numThreads: 0 } },
    InferenceSession: { create: vi.fn() }, Tensor: class {
      constructor(public type: string, public data: Float32Array | BigInt64Array, public dims: number[]) {}
    } },
  transformers: { env: { allowRemoteModels: true, allowLocalModels: false, localModelPath: "",
    backends: { onnx: { wasm: { wasmPaths: "", numThreads: 0 } } } }, pipeline: vi.fn() },
}));
vi.mock("onnxruntime-web", () => runtime.ort);
vi.mock("@huggingface/transformers", () => runtime.transformers);
beforeEach(() => {
  vi.clearAllMocks();
  runtime.ort.InferenceSession.create.mockResolvedValue({ run: vi.fn(), release: vi.fn() });
  runtime.transformers.pipeline.mockResolvedValue(Object.assign(vi.fn(async () => ({ text: "fixture" })), { dispose: vi.fn() }));
  vi.stubGlobal("crypto", { subtle: { digest: vi.fn(async () => Uint8Array.from(VAD_MODEL_SHA256.match(/../g)!, (s) => parseInt(s, 16)).buffer) } });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2]))));
});
afterEach(() => vi.unstubAllGlobals());

async function vadHarness() {
  const run = vi.fn(async (feeds: Record<string, { data: Float32Array | BigInt64Array; dims: number[] }>) => {
    void feeds;
    return { output: { data: new Float32Array([0.8]) },
      stateN: { data: new Float32Array(256).fill(0.25) } };
  });
  runtime.ort.InferenceSession.create.mockResolvedValue({ run, release: vi.fn() });
  const { value } = await loadVadSession();
  return { vad: value!, run };
}

it("TEST_FAILS_IF_SILERO_CONTEXT_IS_REMOVED: primeira janela interna tem 64 zeros + 512 samples", async () => {
  const { vad, run } = await vadHarness();
  const window = new Float32Array(512).fill(0.3);
  await vad.process(window);
  const feeds = run.mock.calls[0]![0];
  expect(feeds.input!.dims).toEqual([1, 576]);
  expect(feeds.input!.data.length).toBe(576);
  expect(feeds.input!.data.slice(0, 64)).toEqual(new Float32Array(64));
  expect(feeds.input!.data.slice(64)).toEqual(window);
  expect(feeds.state!.dims).toEqual([2, 1, 128]);
  expect(feeds.sr!.dims).toEqual([]);
  expect(Array.from(feeds.sr!.data as BigInt64Array)).toEqual([16000n]);
});
it("TEST_FAILS_IF_SILERO_CONTEXT_IS_NOT_UPDATED: segunda janela recebe a cauda anterior", async () => {
  const { vad, run } = await vadHarness();
  const first = Float32Array.from({ length: 512 }, (_, i) => i / 512);
  await vad.process(first);
  const tail = first.slice(-64);
  first.fill(-1); // O contexto nao pode ser uma view do buffer do chamador.
  await vad.process(new Float32Array(512).fill(0.1));
  expect(run.mock.calls[1]![0].input!.data.slice(0, 64)).toEqual(tail);
});
it("TEST_FAILS_IF_SILERO_CONTEXT_LEAKS_BETWEEN_SESSIONS: reset limpa contexto e estado", async () => {
  const { vad, run } = await vadHarness();
  await vad.process(new Float32Array(512).fill(0.7));
  vad.reset();
  await vad.process(new Float32Array(512).fill(0.2));
  const feeds = run.mock.calls[1]![0];
  expect(feeds.input!.data.slice(0, 64)).toEqual(new Float32Array(64));
  expect(feeds.state!.data).toEqual(new Float32Array(256));
});
it("estado recorrente e preservado independentemente do contexto", async () => {
  const { vad, run } = await vadHarness();
  await vad.process(new Float32Array(512).fill(0.7));
  await vad.process(new Float32Array(512).fill(0.2));
  expect(run.mock.calls[0]![0].state!.data).toEqual(new Float32Array(256));
  expect(run.mock.calls[1]![0].state!.data).toEqual(new Float32Array(256).fill(0.25));
  expect(run.mock.calls[1]![0].input!.data.slice(0, 64)).toEqual(new Float32Array(64).fill(0.7));
});
it("adapter rejeita janela publica diferente de 512 antes de chamar ONNX", async () => {
  const { vad, run } = await vadHarness();
  await expect(vad.process(new Float32Array(576))).rejects.toThrow("silero_window_must_be_512");
  expect(run).not.toHaveBeenCalled();
});

it("preparo e inferencia configuram apenas self, WASM e modelos locais; sem CDN", async () => {
  const vad = await loadVadSession();
  const asr = await loadAsrSession();
  expect(vad.failure).toBeNull();
  expect(asr.failure).toBeNull();
  await asr.value!.transcribe(new Float32Array(16000));
  expect(fetch).toHaveBeenCalledWith("/asr/vad/silero_vad.onnx", expect.any(Object));
  expect(runtime.ort.env.wasm).toEqual({ wasmPaths: "/asr/runtime/", numThreads: 1 });
  expect(runtime.transformers.env).toMatchObject({ allowRemoteModels: false, allowLocalModels: true,
    localModelPath: "/asr/models/", backends: { onnx: { wasm: { wasmPaths: "/asr/runtime/" } } } });
  expect(runtime.transformers.pipeline).toHaveBeenCalledWith("automatic-speech-recognition", "onnx-community/whisper-small",
    expect.objectContaining({ device: "wasm", dtype: { encoder_model: "q8", decoder_model_merged: "q8" } }));
});
it("integridade VAD falha antes de instanciar runtime", async () => {
  vi.mocked(crypto.subtle.digest).mockResolvedValue(new Uint8Array(32).buffer);
  expect(await loadVadSession()).toEqual({ value: null, failure: "integrity_failed" });
  expect(runtime.ort.InferenceSession.create).not.toHaveBeenCalled();
});
it("L-157: download do Whisper recebe o sinal do preparo, e o fetch global volta ao original", async () => {
  const controller = new AbortController();
  const seen: (AbortSignal | null)[] = [];
  const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(init?.signal ?? null);
    return new Response(new Uint8Array([1]));
  });
  vi.stubGlobal("fetch", base);
  runtime.transformers.pipeline.mockImplementationOnce(async () => {
    await fetch("/asr/models/onnx-community/whisper-small/onnx/decoder_model_merged_quantized.onnx");
    await fetch("/api/multimodal/sessions");
    return Object.assign(vi.fn(), { dispose: vi.fn() });
  });
  expect((await loadAsrSession({ signal: controller.signal })).failure).toBeNull();
  expect(seen).toEqual([controller.signal, null]);
  expect(globalThis.fetch).toBe(base);
});
it("L-157: abortar durante o download devolve cancelled, e nao load_failed", async () => {
  const controller = new AbortController();
  runtime.transformers.pipeline.mockImplementationOnce(async () => {
    controller.abort();
    throw new TypeError("network error");
  });
  expect(await loadAsrSession({ signal: controller.signal })).toEqual({ value: null, failure: "cancelled" });
});
it("L-157: erro de fetch vira falha nomeada nos dois loaders", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Failed to fetch"));
  expect(await loadVadSession()).toEqual({ value: null, failure: "assets_missing" });
  runtime.transformers.pipeline.mockRejectedValueOnce(new Error("Failed to fetch"));
  expect((await loadAsrSession()).failure).toBe("assets_missing");
});
it("L-157: VAD relata os bytes recebidos sem mudar o que e verificado", async () => {
  const onBytes = vi.fn();
  expect((await loadVadSession(undefined, onBytes)).failure).toBeNull();
  expect(onBytes).toHaveBeenLastCalledWith(2);
  expect(crypto.subtle.digest).toHaveBeenCalledWith("SHA-256", expect.any(ArrayBuffer));
});
it("cancelamento libera pipeline carregado e nao publica prontidao", async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await loadAsrSession({ signal: controller.signal })).toEqual({ value: null, failure: "cancelled" });
  const pipeline = await runtime.transformers.pipeline.mock.results[0]!.value;
  expect(pipeline.dispose).toHaveBeenCalledOnce();
});
