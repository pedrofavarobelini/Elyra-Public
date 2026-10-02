import { describe, expect, it } from "vitest";

import type { CaptureCoverage } from "@/lib/contracts/capture-coverage";

import {
  buildObservableSignal,
  computeMovementFrequency,
  computePauseSignals,
  computeSpeechRate,
  computeVocalVariation,
  extractSessionSignals,
  personalBaseline,
  PAUSE_MINIMUM_MS,
} from "@/lib/multimodal-signals";
import {
  SIGNAL_MAXIMUM,
  buildMultimodalInput,
  elyraMultimodalInputSchema,
  observableSignalSchema,
} from "@/lib/contracts/multimodal-signals";
import { multimodalInputFixture } from "@/lib/contracts/multimodal-fixtures";

describe("computePauseSignals", () => {
  it("conta apenas silencios acima da duracao minima", () => {
    // 5 quadros de 200 ms de silencio = 1000 ms (conta);
    // 1 quadro isolado de 200 ms (nao conta).
    const envelope = [1, 1, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1];
    const result = computePauseSignals(envelope, 200);

    expect(result.pauseCount).toBe(1);
    expect(result.pauseTotalMs).toBe(1000);
    expect(result.pauseMeanMs).toBe(1000);
  });

  it("fecha uma pausa que termina junto com a sessao", () => {
    const result = computePauseSignals([1, 1, 0, 0, 0], 200);

    expect(result.pauseCount).toBe(1);
    expect(result.pauseTotalMs).toBe(600);
  });

  it("nao inventa pausa em envelope vazio", () => {
    expect(computePauseSignals([], 200)).toEqual({
      pauseCount: 0,
      pauseTotalMs: 0,
      pauseMeanMs: 0,
    });
  });

  it("usa limiar relativo, entao ganho do microfone nao muda o resultado", () => {
    const quiet = [0.1, 0.1, 0, 0, 0, 0, 0.1];
    const loud = quiet.map((value) => value * 50);

    expect(computePauseSignals(loud, 200)).toEqual(
      computePauseSignals(quiet, 200),
    );
  });

  it("respeita a duracao minima documentada", () => {
    const frames = Math.ceil(PAUSE_MINIMUM_MS / 200);
    const envelope = [1, ...Array<number>(frames).fill(0), 1];

    expect(computePauseSignals(envelope, 200).pauseCount).toBe(1);
  });
});

describe("computeVocalVariation", () => {
  it("retorna zero para energia constante", () => {
    expect(computeVocalVariation([0.5, 0.5, 0.5, 0.5])).toBe(0);
  });

  it("cresce com a oscilacao e permanece normalizado em 0-1", () => {
    const steady = computeVocalVariation([0.5, 0.52, 0.48, 0.5])!;
    const volatile = computeVocalVariation([0.1, 0.9, 0.15, 0.85])!;

    expect(volatile).toBeGreaterThan(steady);
    expect(volatile).toBeLessThanOrEqual(1);
    expect(steady).toBeGreaterThanOrEqual(0);
  });

  it("retorna null sem amostra suficiente", () => {
    expect(computeVocalVariation([])).toBeNull();
    expect(computeVocalVariation([0.4])).toBeNull();
  });

  it("retorna null quando nao houve energia alguma", () => {
    expect(computeVocalVariation([0, 0, 0, 0])).toBeNull();
  });
});

describe("computeSpeechRate", () => {
  it("usa o tempo falado, nao a duracao da sessao", () => {
    expect(computeSpeechRate(120, 60_000)).toBe(120);
    expect(computeSpeechRate(60, 30_000)).toBe(120);
  });

  it("retorna null sem fala detectada", () => {
    expect(computeSpeechRate(10, 0)).toBeNull();
  });

  it("limita o valor ao teto do contrato", () => {
    expect(computeSpeechRate(10_000, 1_000)).toBe(SIGNAL_MAXIMUM.speech_rate);
  });
});

describe("computeMovementFrequency", () => {
  it("normaliza a media das diferencas de quadro", () => {
    expect(computeMovementFrequency([0.2, 0.4, 0.3])).toBeCloseTo(0.3, 6);
  });

  it("retorna null sem quadros", () => {
    expect(computeMovementFrequency([])).toBeNull();
  });

  it("nunca ultrapassa 1", () => {
    expect(computeMovementFrequency([5, 5, 5])).toBe(1);
  });
});

describe("personalBaseline", () => {
  it("retorna null quando nao ha historico", () => {
    expect(personalBaseline([])).toBeNull();
  });

  it("calcula a media do proprio usuario e conta as amostras", () => {
    expect(personalBaseline([100, 120, 140])).toEqual({ mean: 120, samples: 3 });
  });

  it("limita a contagem de amostras ao teto do contrato", () => {
    const history = Array<number>(200).fill(100);

    expect(personalBaseline(history)?.samples).toBe(90);
  });
});

describe("buildObservableSignal", () => {
  it("marca not_captured sem valor, e ausencia nao vira zero", () => {
    const signal = buildObservableSignal("movement_frequency", null, null);

    expect(signal.status).toBe("not_captured");
    expect(signal.value).toBeNull();
    expect(signal.deltaVsPersonalBaseline).toBeNull();
  });

  it("marca insufficient_baseline quando ha valor mas nao ha historico", () => {
    const signal = buildObservableSignal("speech_rate", 130, null);

    expect(signal.status).toBe("insufficient_baseline");
    expect(signal.value).toBe(130);
    expect(signal.personalBaselineMean).toBeNull();
    expect(signal.deltaVsPersonalBaseline).toBeNull();
  });

  it("so calcula delta quando existe baseline pessoal real", () => {
    const signal = buildObservableSignal("speech_rate", 130, {
      mean: 120,
      samples: 8,
    });

    expect(signal.status).toBe("available");
    expect(signal.deltaVsPersonalBaseline).toBe(10);
    expect(signal.personalBaselineSamples).toBe(8);
  });

  it("atribui a unidade canonica do sinal", () => {
    expect(buildObservableSignal("pause_count", 4, null).unit).toBe("count");
    expect(buildObservableSignal("vocal_variation", 0.5, null).unit).toBe("index");
  });

  it("limita valor fora do dominio em vez de propagar dado corrompido", () => {
    const signal = buildObservableSignal("vocal_variation", 42, null);

    expect(signal.value).toBe(1);
  });
});

describe("extractSessionSignals", () => {
  const base = {
    audioEnvelope: [1, 1, 0, 0, 0, 0, 1, 1, 0.8, 1],
    audioFrameMs: 200,
    frameDifferences: [0.2, 0.3, 0.25],
    wordCount: 120,
    voicedDurationMs: 60_000,
    history: {},
  };

  it("nao produz sinal de audio sem captura de microfone", () => {
    const signals = extractSessionSignals({
      ...base,
      capturedResources: ["camera"],
    });
    const names = signals.map((signal) => signal.name);

    expect(names).toEqual(["movement_frequency"]);
  });

  it("nao produz sinal de movimento sem captura de camera", () => {
    const signals = extractSessionSignals({
      ...base,
      capturedResources: ["microphone"],
    });

    expect(signals.some((signal) => signal.name === "movement_frequency")).toBe(
      false,
    );
    expect(signals.length).toBeGreaterThan(0);
  });

  it("produz somente sinais do vocabulario fechado", () => {
    const signals = extractSessionSignals({
      ...base,
      capturedResources: ["microphone", "camera"],
    });

    for (const signal of signals) {
      expect(() => observableSignalSchema.parse(signal)).not.toThrow();
    }
  });

  it("usa o historico do proprio usuario como baseline", () => {
    const signals = extractSessionSignals({
      ...base,
      capturedResources: ["microphone"],
      history: { speech_rate: [100, 110, 120] },
    });
    const speechRate = signals.find((signal) => signal.name === "speech_rate")!;

    expect(speechRate.status).toBe("available");
    expect(speechRate.personalBaselineMean).toBe(110);
    expect(speechRate.deltaVsPersonalBaseline).toBe(10);
  });

  it("sessao apenas de tela nao produz sinal algum", () => {
    expect(
      extractSessionSignals({ ...base, capturedResources: ["screen"] }),
    ).toEqual([]);
  });
});

describe("contrato multimodal", () => {
  it("aceita a fixture canonica", () => {
    expect(() =>
      elyraMultimodalInputSchema.parse(multimodalInputFixture()),
    ).not.toThrow();
  });

  it("recusa sinal fora do vocabulario", () => {
    const input = multimodalInputFixture();
    const corrupted = {
      ...input,
      session: {
        ...input.session,
        signals: [
          ...input.session.signals,
          {
            name: "sadness_score",
            value: 0.8,
            unit: "index",
            personalBaselineMean: 0.5,
            personalBaselineSamples: 4,
            deltaVsPersonalBaseline: 0.3,
            status: "available",
          },
        ],
      },
    };

    expect(() => elyraMultimodalInputSchema.parse(corrupted)).toThrow();
  });

  it("recusa campo extra na projecao, como caminho de Storage", () => {
    const input = multimodalInputFixture();
    const corrupted = {
      ...input,
      session: { ...input.session, storagePath: "elyra-private/u/s/cam.webm" },
    };

    expect(() => elyraMultimodalInputSchema.parse(corrupted)).toThrow();
  });

  it("recusa identificador de pessoa usuaria", () => {
    const corrupted = { ...multimodalInputFixture(), userId: "abc" };

    expect(() => elyraMultimodalInputSchema.parse(corrupted)).toThrow();
  });

  it("recusa unidade incompativel com o sinal", () => {
    expect(() =>
      observableSignalSchema.parse({
        name: "speech_rate",
        value: 0.5,
        unit: "index",
        personalBaselineMean: 0.4,
        personalBaselineSamples: 3,
        deltaVsPersonalBaseline: 0.1,
        status: "available",
      }),
    ).toThrow();
  });

  it("recusa sinal available sem baseline pessoal", () => {
    expect(() =>
      observableSignalSchema.parse({
        name: "speech_rate",
        value: 130,
        unit: "words_per_minute",
        personalBaselineMean: null,
        personalBaselineSamples: 0,
        deltaVsPersonalBaseline: null,
        status: "available",
      }),
    ).toThrow();
  });

  it("recusa sinal not_captured com valor", () => {
    expect(() =>
      observableSignalSchema.parse({
        name: "pause_count",
        value: 0,
        unit: "count",
        personalBaselineMean: null,
        personalBaselineSamples: 0,
        deltaVsPersonalBaseline: null,
        status: "not_captured",
      }),
    ).toThrow();
  });

  it("recusa transcricao sem captura de microfone", () => {
    expect(() =>
      multimodalInputFixture({
        capturedResources: ["camera"],
        signals: [
          {
            name: "movement_frequency",
            value: 0.3,
            unit: "index",
            personalBaselineMean: 0.2,
            personalBaselineSamples: 5,
            deltaVsPersonalBaseline: 0.1,
            status: "available",
            coverage: null,
          },
        ],
      }),
    ).toThrow();
  });
});

describe("buildMultimodalInput", () => {
  const signals = multimodalInputFixture().session.signals;
  const COVERAGE_300K = [
    { modality: "screen", outcome: "absent", reason: "not_requested", coverageMs: 0, sessionDurationMs: 300_000 },
    { modality: "camera", outcome: "full", reason: null, coverageMs: 300_000, sessionDurationMs: 300_000 },
    { modality: "microphone", outcome: "full", reason: null, coverageMs: 300_000, sessionDurationMs: 300_000 },
  ] satisfies CaptureCoverage[];

  it("nao envia transcricao sem consentimento de transcricao", () => {
    const input = buildMultimodalInput({
      sessionKind: "guided",
      capturedResources: ["microphone", "camera"],
      durationMs: 300_000,
      modalityCoverage: COVERAGE_300K,
      selfReport: null,
      windows: [],
      signals,
      transcript: {
        language: "pt-BR",
        text: "conteudo que nao pode atravessar",
        wordCount: 5,
        voicedDurationMs: 10_000,
        truncated: false,
      },
      transcriptAnalysisConsent: false,
      visualAnalysisConsent: false,
    });

    expect(input.session.transcript).toBeNull();
    expect(JSON.stringify(input)).not.toContain("nao pode atravessar");
  });

  it("envia transcricao quando ha consentimento proprio", () => {
    const input = buildMultimodalInput({
      sessionKind: "guided",
      capturedResources: ["microphone", "camera"],
      durationMs: 300_000,
      modalityCoverage: COVERAGE_300K,
      selfReport: null,
      windows: [],
      signals,
      transcript: {
        language: "pt-BR",
        text: "relato consentido",
        wordCount: 2,
        voicedDurationMs: 10_000,
        truncated: false,
      },
      transcriptAnalysisConsent: true,
      visualAnalysisConsent: false,
    });

    expect(input.session.transcript?.text).toBe("relato consentido");
  });

  it("a projecao nunca carrega identificador ou caminho de midia", () => {
    const serialized = JSON.stringify(
      buildMultimodalInput({
        sessionKind: "free",
        capturedResources: ["microphone"],
        durationMs: 60_000,
        modalityCoverage: [
          { modality: "screen", outcome: "absent", reason: "not_requested", coverageMs: 0, sessionDurationMs: 60_000 },
          { modality: "camera", outcome: "absent", reason: "not_requested", coverageMs: 0, sessionDurationMs: 60_000 },
          { modality: "microphone", outcome: "full", reason: null, coverageMs: 60_000, sessionDurationMs: 60_000 },
        ],
      selfReport: null,
      windows: [],
        signals: signals.filter((signal) => signal.name !== "movement_frequency"),
        transcript: null,
        transcriptAnalysisConsent: false,
        visualAnalysisConsent: false,
      }),
    );

    for (const forbidden of [
      "userId",
      "user_id",
      "sessionId",
      "storagePath",
      "elyra-private",
      "signedUrl",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
