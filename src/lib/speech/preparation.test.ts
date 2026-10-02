import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CANCEL_GRACE_MS, STALL_SILENT_MS, STALL_TRANSFER_MS,
  createSpeechPreparation, describePreparationProgress, preparationPercent,
  speechFailureCapture, transcriptionCanStart, transcriptionPreflight, type PreparationLoaders,
} from "./preparation";
import type { AsrSession } from "./local-model-engine";
import { VAD_MODEL_BYTES, type AsrLoadOptions, type RuntimeLoad } from "./browser-runtime";
import type { VadSession } from "./vad";

function fixture() {
  const vad: VadSession = { reset: vi.fn(), process: vi.fn(() => 0.9), dispose: vi.fn() };
  const asr: AsrSession = { transcribe: vi.fn(async () => ({ text: "frase sintetica do teste" })), dispose: vi.fn() };
  const loaders = {
    vad: vi.fn<PreparationLoaders["vad"]>(async () => ({ value: vad, failure: null })),
    asr: vi.fn<PreparationLoaders["asr"]>(async () => ({ value: asr, failure: null })),
  };
  return { vad, asr, loaders, preparation: createSpeechPreparation(loaders) };
}
const pcm = () => ({ available: true, stop: vi.fn(() => new Float32Array(32000).fill(0.1)), sampleCount: () => 32000 });

describe("preflight e lifecycle local (fixtures; nao valida voz humana)", () => {
  it("native available autoriza sem carregar fallback; sem consentimento nao prepara", () => {
    const f = fixture();
    expect(transcriptionPreflight(true, "available", f.preparation.getSnapshot())).toBe("READY_NATIVE");
    expect(transcriptionCanStart(true, "available", f.preparation.getSnapshot())).toBe(true);
    expect(transcriptionCanStart(false, null, f.preparation.getSnapshot())).toBe(true);
    expect(f.loaders.vad).not.toHaveBeenCalled();
    expect(f.loaders.asr).not.toHaveBeenCalled();
  });
  it.each([null, "unavailable", "unsupported", "downloadable", "downloading"] as const)(
    "TEST_FAILS_IF_SESSION_STARTS_WITH_PROMISED_TRANSCRIPTION_NOT_READY: %s", (native) => {
      const f = fixture();
      expect(transcriptionCanStart(true, native, f.preparation.getSnapshot())).toBe(false);
      expect(f.loaders.vad).not.toHaveBeenCalled();
      expect(f.loaders.asr).not.toHaveBeenCalled();
    });
  it("prepara VAD antes de Whisper, sem PCM, e reutiliza runtime", async () => {
    const f = fixture();
    const first = f.preparation.prepare();
    expect(f.preparation.prepare()).toBe(first);
    expect(transcriptionCanStart(true, "unavailable", f.preparation.getSnapshot())).toBe(false);
    await first;
    expect(f.loaders.vad.mock.invocationCallOrder[0]).toBeLessThan(f.loaders.asr.mock.invocationCallOrder[0]!);
    expect(transcriptionPreflight(true, "unavailable", f.preparation.getSnapshot())).toBe("READY_LOCAL");
    await f.preparation.prepare();
    expect(f.loaders.vad).toHaveBeenCalledTimes(1);
    expect(f.loaders.asr).toHaveBeenCalledTimes(1);
    expect(f.asr.transcribe).not.toHaveBeenCalled();
  });
  it.each([
    ["vad", "load_failed", "local_vad_load_failed"],
    ["asr", "load_failed", "local_whisper_load_failed"],
    ["vad", "assets_missing", "local_asr_assets_missing"],
    ["vad", "integrity_failed", "local_asr_integrity_failed"],
  ] as const)("preserva falha %s/%s", async (stage, failure, expected) => {
    const f = fixture();
    f.loaders[stage].mockResolvedValueOnce({ value: null, failure });
    await f.preparation.prepare();
    expect(f.preparation.getSnapshot()).toEqual({ status: "failed", failure: expected });
    expect(transcriptionCanStart(true, "unavailable", f.preparation.getSnapshot())).toBe(false);
    expect(speechFailureCapture(expected)).toEqual({ status: "failed", reason: "recognition_failed" });
    if (stage === "vad") expect(f.loaders.asr).not.toHaveBeenCalled();
    await f.preparation.prepare();
    expect(f.preparation.getSnapshot().status).toBe("ready");
  });
  it("cancelamento nao vira READY tardio nem permite carga concorrente", async () => {
    const f = fixture();
    let finish!: (value: RuntimeLoad<VadSession>) => void;
    f.loaders.vad.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = f.preparation.prepare();
    f.preparation.cancel();
    expect(f.preparation.getSnapshot()).toEqual({ status: "cancelling", failure: "local_asr_cancelled" });
    expect(f.preparation.prepare()).toBe(pending);
    finish({ value: f.vad, failure: null });
    await pending;
    expect(f.preparation.getSnapshot()).toEqual({ status: "failed", failure: "local_asr_cancelled" });
    expect(f.loaders.asr).not.toHaveBeenCalled();
    expect(f.vad.dispose).toHaveBeenCalledOnce();
  });
  it("cancelar Whisper em andamento descarta resultado tardio", async () => {
    const f = fixture();
    let finish!: (value: RuntimeLoad<AsrSession>) => void;
    f.loaders.asr.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = f.preparation.prepare();
    await vi.waitFor(() => expect(f.loaders.asr).toHaveBeenCalledOnce());
    f.preparation.cancel();
    finish({ value: f.asr, failure: null });
    await pending;
    expect(f.preparation.getSnapshot().failure).toBe("local_asr_cancelled");
    expect(f.asr.dispose).toHaveBeenCalledOnce();
  });
  it("READY_LOCAL cria engine por sessao; PCM separado e VAD resetado, sem retencao", async () => {
    const f = fixture();
    await f.preparation.prepare();
    const failure = vi.fn();
    const firstPcm = pcm();
    const first = f.preparation.attach(firstPcm, failure)!;
    expect(first.engine.kind).toBe("local_model");
    expect(f.vad.reset).toHaveBeenCalledOnce();
    expect((await first.engine.stop()).status).toBe("available");
    expect(firstPcm.stop).toHaveBeenCalledOnce();
    const resets = vi.mocked(f.vad.reset).mock.calls.length;
    const secondPcm = pcm();
    secondPcm.stop.mockReturnValue(new Float32Array(0));
    const second = f.preparation.attach(secondPcm, failure)!;
    expect(f.vad.reset).toHaveBeenCalledTimes(resets + 1);
    expect(await second.engine.stop()).toEqual({ status: "failed", reason: "recognition_failed" });
    expect(failure).toHaveBeenLastCalledWith("local_pcm_unavailable");
    expect(firstPcm.stop).toHaveBeenCalledOnce();
    expect(f.loaders.asr).toHaveBeenCalledOnce();
  });
  it("PCM indisponivel falha separado do microfone; nao cria engine ativo", async () => {
    const f = fixture();
    await f.preparation.prepare();
    const failure = vi.fn();
    expect(f.preparation.attach({ ...pcm(), available: false }, failure)).toBeNull();
    expect(failure).toHaveBeenCalledWith("local_pcm_unavailable");
  });
  it("falha de inferencia nao vira silencio ou recusa nativa", async () => {
    const f = fixture();
    vi.mocked(f.asr.transcribe).mockRejectedValue(new Error("synthetic runtime failure"));
    await f.preparation.prepare();
    const failure = vi.fn();
    const session = f.preparation.attach(pcm(), failure)!;
    expect(await session.engine.stop()).toEqual({ status: "failed", reason: "recognition_failed" });
    expect(failure).toHaveBeenCalledWith("local_asr_runtime_failed");
    expect(f.preparation.getSnapshot()).toEqual({ status: "failed", failure: "local_asr_runtime_failed" });
    expect(transcriptionCanStart(true, "unavailable", f.preparation.getSnapshot())).toBe(false);
    expect(f.vad.dispose).toHaveBeenCalledOnce();
    expect(f.asr.dispose).toHaveBeenCalledOnce();
  });
  it("nao compartilha VAD enquanto outra sessao infere ou desmonta", async () => {
    const f = fixture();
    let finish!: (value: { text: string }) => void;
    vi.mocked(f.asr.transcribe).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await f.preparation.prepare();
    const first = f.preparation.attach(pcm(), vi.fn())!;
    const pending = first.engine.stop();
    await vi.waitFor(() => expect(f.asr.transcribe).toHaveBeenCalled());
    first.release();
    expect(f.preparation.attach(pcm(), vi.fn())).toBeNull();
    finish({ text: "teste sintetico" });
    await pending;
    expect(f.preparation.attach(pcm(), vi.fn())).not.toBeNull();
  });
});

/*
  L-157. O Android ficava em "Preparando reconhecimento local..." sem numero
  nenhum enquanto ~276 MB desciam a ~0,35 MB/s pelo Quick Tunnel, e nada tirava
  o estado de PREPARING se a rede parasse. Carga lenta e legitima; parada nao.
*/
describe("progresso, stall e cancelamento do preparo (L-157)", () => {
  afterEach(() => { vi.useRealTimers(); });

  function heldAsr(f: ReturnType<typeof fixture>) {
    const held = {} as {
      emit: NonNullable<AsrLoadOptions["onLoadEvent"]>;
      finish: (value: RuntimeLoad<AsrSession>) => void;
      signal: AbortSignal;
    };
    f.loaders.asr.mockImplementationOnce((options) => new Promise((resolve) => {
      held.emit = options.onLoadEvent!;
      held.finish = resolve;
      held.signal = options.signal!;
    }));
    return held;
  }

  it("PREPARING -> progresso -> READY: etapa, bytes somados por arquivo e percentual em 0-100", async () => {
    const f = fixture();
    const held = heldAsr(f);
    const pending = f.preparation.prepare();
    expect(f.preparation.getSnapshot()).toMatchObject({ status: "preparing", progress: { stage: "detector" } });
    await vi.waitFor(() => expect(f.loaders.asr).toHaveBeenCalledOnce());
    held.emit({ status: "progress", file: "onnx/encoder", loaded: 40_000_000, total: 100_000_000 });
    held.emit({ status: "progress", file: "onnx/decoder", loaded: 44_000_000, total: 152_000_000 });
    const snapshot = f.preparation.getSnapshot();
    expect(snapshot.status).toBe("preparing");
    expect(snapshot.progress).toEqual({
      stage: "model", loadedBytes: VAD_MODEL_BYTES + 84_000_000, totalBytes: VAD_MODEL_BYTES + 252_000_000,
    });
    expect(describePreparationProgress(snapshot.progress!)).toBe("Baixando modelo: 86 MB / 254 MB — 33%");
    held.emit({ status: "done", file: "onnx/encoder" });
    held.emit({ status: "done", file: "onnx/decoder" });
    expect(f.preparation.getSnapshot().progress).toMatchObject({ stage: "initializing" });
    expect(preparationPercent(f.preparation.getSnapshot().progress!)).toBe(100);
    held.finish({ value: f.asr, failure: null });
    await pending;
    expect(f.preparation.getSnapshot()).toEqual({ status: "ready", failure: null });
    expect(f.preparation.getSnapshot().progress).toBeUndefined();
  });

  it("carga lenta legitima nao e interrompida: 15 min avancando a cada minuto continua PREPARING", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const held = heldAsr(f);
    const pending = f.preparation.prepare();
    await vi.advanceTimersByTimeAsync(0);
    for (let minute = 1; minute <= 15; minute++) {
      held.emit({ status: "progress", file: "onnx/decoder", loaded: minute * 10_000_000, total: 252_000_000 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(f.preparation.getSnapshot().status).toBe("preparing");
      const percent = preparationPercent(f.preparation.getSnapshot().progress!)!;
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
    held.finish({ value: f.asr, failure: null });
    await pending;
    expect(f.preparation.getSnapshot().status).toBe("ready");
  });

  it("PREPARING -> stall -> FAILED: aborta o download, libera o slot e a nova tentativa funciona", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const held = heldAsr(f);
    const pending = f.preparation.prepare();
    await vi.advanceTimersByTimeAsync(0);
    held.emit({ status: "progress", file: "onnx/decoder", loaded: 1_000_000, total: 152_000_000 });
    await vi.advanceTimersByTimeAsync(STALL_TRANSFER_MS - 1);
    expect(f.preparation.getSnapshot().status).toBe("preparing");
    await vi.advanceTimersByTimeAsync(1);
    expect(f.preparation.getSnapshot()).toEqual({ status: "failed", failure: "local_asr_stalled" });
    expect(held.signal.aborted).toBe(true);
    await pending;
    expect(transcriptionCanStart(true, "unavailable", f.preparation.getSnapshot())).toBe(false);
    // Resultado tardio da tentativa abandonada e descartado, e nao vira READY.
    held.finish({ value: f.asr, failure: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.asr.dispose).toHaveBeenCalledOnce();
    expect(f.preparation.getSnapshot().status).toBe("failed");
    await f.preparation.prepare();
    expect(f.preparation.getSnapshot().status).toBe("ready");
    expect(f.loaders.asr).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fase sem contador de bytes tem janela propria, e tambem nunca fica eterna", async () => {
    vi.useFakeTimers();
    const f = fixture();
    heldAsr(f);
    const pending = f.preparation.prepare();
    await vi.advanceTimersByTimeAsync(STALL_TRANSFER_MS);
    expect(f.preparation.getSnapshot().status).toBe("preparing");
    await vi.advanceTimersByTimeAsync(STALL_SILENT_MS - STALL_TRANSFER_MS);
    expect(f.preparation.getSnapshot()).toEqual({ status: "failed", failure: "local_asr_stalled" });
    await pending;
  });

  it("erro de fetch/WASM vira FAILED e nao deixa watchdog pendurado", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.loaders.asr.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await f.preparation.prepare();
    expect(f.preparation.getSnapshot()).toEqual({ status: "failed", failure: "local_whisper_load_failed" });
    f.loaders.asr.mockResolvedValueOnce({ value: null, failure: "assets_missing" });
    await f.preparation.prepare();
    expect(f.preparation.getSnapshot()).toEqual({ status: "failed", failure: "local_asr_assets_missing" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancel -> recursos liberados -> estado consistente -> nova tentativa prepara", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.loaders.asr.mockImplementationOnce((options) => new Promise((resolve) => {
      options.signal!.addEventListener("abort", () => resolve({ value: null, failure: "cancelled" }));
    }));
    const pending = f.preparation.prepare();
    await vi.advanceTimersByTimeAsync(0);
    f.preparation.cancel();
    expect(f.preparation.getSnapshot()).toEqual({ status: "cancelling", failure: "local_asr_cancelled" });
    await pending;
    expect(f.preparation.getSnapshot()).toEqual({ status: "failed", failure: "local_asr_cancelled" });
    expect(f.vad.dispose).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    await f.preparation.prepare();
    expect(f.preparation.getSnapshot()).toEqual({ status: "ready", failure: null });
  });

  it("cancel com runtime que nao devolve o controle: carencia encerra, e o retry nao espera o antigo", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const held = heldAsr(f);
    const pending = f.preparation.prepare();
    await vi.advanceTimersByTimeAsync(0);
    f.preparation.cancel();
    f.preparation.cancel();
    expect(f.preparation.getSnapshot().status).toBe("cancelling");
    await vi.advanceTimersByTimeAsync(CANCEL_GRACE_MS);
    expect(f.preparation.getSnapshot()).toEqual({ status: "failed", failure: "local_asr_cancelled" });
    await pending;
    await f.preparation.prepare();
    expect(f.preparation.getSnapshot().status).toBe("ready");
    held.finish({ value: f.asr, failure: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.asr.dispose).toHaveBeenCalledOnce();
    expect(f.preparation.getSnapshot().status).toBe("ready");
  });

  it("percentual e sempre inteiro em 0-100, ou null sem total", () => {
    const at = (loadedBytes: number, totalBytes: number) =>
      preparationPercent({ stage: "model", loadedBytes, totalBytes });
    expect(at(0, 100)).toBe(0);
    expect(at(33, 100)).toBe(33);
    expect(at(300, 100)).toBe(100);
    expect(at(-5, 100)).toBe(0);
    expect(at(10, 0)).toBeNull();
    expect(at(Number.NaN, 100)).toBeNull();
  });
});
