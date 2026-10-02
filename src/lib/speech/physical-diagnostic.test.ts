import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asrDiagnosticEnabled, newAsrDiagnostic, measureDiagnosticPcm, firstObservedFailure,
  saveAsrDiagnostic, readAsrDiagnostic, removeAsrDiagnostic } from "./physical-diagnostic";
import { createLocalModelEngine } from "./local-model-engine";

const ID = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_ASR_QA_DIAGNOSTICS", "1"); sessionStorage.clear(); });
afterEach(() => { vi.unstubAllEnvs(); sessionStorage.clear(); });

describe("diagnostico fisico sanitizado (sem inferencia real)", () => {
  it("mede PCM 16 kHz e silencio sem reter amostras", () => {
    const d = newAsrDiagnostic();
    measureDiagnosticPcm(d, new Float32Array([0, 1, -1, 0]));
    expect(d).toMatchObject({ pcmSampleCount: 4, pcmDurationMs: 0.25, pcmPeakAbs: 1 });
    expect(d.pcmRms).toBeCloseTo(Math.sqrt(0.5));
    const silence = newAsrDiagnostic();
    measureDiagnosticPcm(silence, new Float32Array(16000));
    expect(silence).toMatchObject({ pcmDurationMs: 1000, pcmPeakAbs: 0, pcmRms: 0 });
  });
  it("ausencia de medicao nao vira PCM zero; PCM vazio e identificado", () => {
    const d = newAsrDiagnostic();
    expect(firstObservedFailure(d)).toBe("UNKNOWN");
    measureDiagnosticPcm(d, new Float32Array());
    expect(firstObservedFailure(d)).toBe("PCM");
  });
  it.each([
    [{ vadCalled: true, vadCompleted: true, vadSegmentsCount: 0 }, "VAD"],
    [{ vadCalled: true, vadSegmentsCount: 1 }, "WHISPER_NOT_CALLED"],
    [{ whisperCallCount: 1, whisperRawTextLength: [0] }, "WHISPER_EMPTY"],
    [{ whisperCallCount: 1, whisperRawTextLength: [12], acceptedCount: 0, acceptanceCompleted: true }, "ACCEPTANCE"],
    [{ acceptedCount: 1 }, "NONE"],
    [{ acceptedCount: 1, persistedSegments: 0 }, "PERSISTENCE"],
    [{ acceptedCount: 1, persistedSegments: 1 }, "NONE"],
  ] as const)("classificacao deterministica %j => %s", (patch, expected) => {
    const d = newAsrDiagnostic();
    measureDiagnosticPcm(d, new Float32Array(16000));
    Object.assign(d, patch);
    expect(firstObservedFailure(d)).toBe(expected);
  });
  it.each([
    [0, "texto sintetico", "VAD", 0],
    [0.9, "", "WHISPER_EMPTY", 1],
    [0.9, "[música]", "ACCEPTANCE", 1],
    [0.9, "conteudo sintetico confidencial", "NONE", 1],
  ] as const)("instrumentacao preserva resultado e parametros: %s/%s", async (probability, text, failure, calls) => {
    const samples = new Float32Array(16000).fill(0.2);
    const d = newAsrDiagnostic();
    measureDiagnosticPcm(d, samples);
    const vad = { reset: vi.fn(), process: vi.fn(() => probability) };
    const asr = { transcribe: vi.fn(async () => ({ text })) };
    const observed = await createLocalModelEngine({ pcm: () => samples, vad, asr, diagnostic: d }).stop();
    expect(asr.transcribe).toHaveBeenCalledTimes(calls);
    expect(d.vadWindowsTotal).toBe(31);
    expect(d.vadMaxSpeechProbability).toBe(probability);
    expect(d.vadWindowsAboveThreshold).toBe(probability >= 0.5 ? 31 : 0);
    expect(d.whisperInputDurationMs).toEqual(calls ? [1000] : []);
    expect(d.asrOutcomeCount).toBe(calls);
    expect(firstObservedFailure(d)).toBe(failure);
    const unobserved = await createLocalModelEngine({ pcm: () => samples, vad, asr }).stop();
    expect(observed).toEqual(unobserved);
    expect(JSON.stringify(d)).not.toContain(text || '"text"');
    if (failure === "ACCEPTANCE") expect(d.rejectionReasons.non_speech_only).toBe(1);
  });
  it("excecao conserva somente classe tipada, sem mensagem ou texto descartado", async () => {
    const d = newAsrDiagnostic();
    const samples = new Float32Array(16000);
    measureDiagnosticPcm(d, samples);
    await createLocalModelEngine({ pcm: () => samples, diagnostic: d,
      vad: { reset() {}, process: () => 0.9 },
      asr: { transcribe: async () => { throw new TypeError("SEGREDO_DA_EXCECAO"); } },
    }).stop();
    expect(d.whisperErrorsCount).toBe(1);
    expect(d.whisperErrorClasses).toEqual(["TypeError"]);
    expect(d.asrOutcomeCount).toBe(0);
    expect(d.rejectionReasons).toMatchObject({ empty_text: 0, runtime_error: 1 });
    expect(firstObservedFailure(d)).toBe("WHISPER_RUNTIME_ERROR");
    expect(JSON.stringify(d)).not.toContain("SEGREDO_DA_EXCECAO");
  });
  it("falha do VAD nao acusa Whisper nem silencio", async () => {
    const d = newAsrDiagnostic();
    const samples = new Float32Array(16000);
    measureDiagnosticPcm(d, samples);
    const asr = { transcribe: vi.fn() };
    await createLocalModelEngine({ pcm: () => samples, diagnostic: d, asr,
      vad: { reset() {}, process: () => { throw new Error("privado"); } },
    }).stop();
    expect(firstObservedFailure(d)).toBe("VAD_RUNTIME_ERROR");
    expect(asr.transcribe).not.toHaveBeenCalled();
  });
  it("allowlist remove campos proibidos, sobrevive leitura e isola/remova por sessao", () => {
    const d = Object.assign(newAsrDiagnostic(), { pcm: [1], audio: "SEGREDO", rawText: "SEGREDO",
      discardedText: "SEGREDO", text: "SEGREDO", waveform: [1], embedding: [1] });
    saveAsrDiagnostic(ID, d);
    const raw = sessionStorage.getItem(`elyra:qa:asr:${ID}`)!;
    expect(raw).not.toContain("SEGREDO");
    for (const key of ["pcm", "audio", "rawText", "discardedText", "text", "waveform", "embedding"]) {
      expect(Object.keys(JSON.parse(raw))).not.toContain(key);
    }
    expect(readAsrDiagnostic(ID)?.pcmSampleCount).toBeNull();
    expect(readAsrDiagnostic("22222222-2222-4222-8222-222222222222")).toBeNull();
    expect(localStorage.getItem(`elyra:qa:asr:${ID}`)).toBeNull();
    removeAsrDiagnostic(ID);
    expect(readAsrDiagnostic(ID)).toBeNull();
  });
  it("bloqueia producao normal, campos invalidos e falha de storage sem afetar sessao", () => {
    expect(asrDiagnosticEnabled("example.com")).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_ASR_QA_DIAGNOSTICS", "0");
    saveAsrDiagnostic(ID, newAsrDiagnostic());
    expect(sessionStorage.length).toBe(0);
    vi.stubEnv("NEXT_PUBLIC_ASR_QA_DIAGNOSTICS", "1");
    const d = newAsrDiagnostic();
    d.whisperRawTextLength = ["SEGREDO" as unknown as number];
    saveAsrDiagnostic(ID, d);
    expect(sessionStorage.length).toBe(0);
    const storage = { setItem() { throw new Error("quota"); } } as unknown as Storage;
    expect(() => saveAsrDiagnostic(ID, newAsrDiagnostic(), storage)).not.toThrow();
  });
});
