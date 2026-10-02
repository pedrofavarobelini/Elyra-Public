import { describe, expect, it } from "vitest";

import { ASR_AB_FIXTURE_VERSION, ASR_AB_REFERENCE } from "@/lib/qa/asr-ab-fixture";
import { buildAsrAbReport, findSilenceWindow } from "@/lib/qa/asr-ab-report";
import type { AsrModelComparison, AsrModelRun } from "@/lib/speech/model-comparison";

const METRICS = { loadMs: 100, inferenceMs: 200, totalMs: 300, peakHeapBytes: null };

function run(overrides: Partial<AsrModelRun>): AsrModelRun {
  return {
    modelId: "onnx-community/whisper-base",
    label: "Base q8",
    quantization: "q8",
    runtime: "transformers.js",
    runtimeVersion: "3.7.6",
    vad: "silero_vad_v5",
    loaded: true,
    failure: null,
    transcription: { accepted: [], rejected: [] },
    text: "",
    brokenLink: null,
    loadFailure: null,
    loadErrorName: null,
    loadErrorMessage: null,
    lastCompletedFile: null,
    metrics: METRICS,
    rejectedCount: 0,
    ...overrides,
  };
}

/** Dois trechos de fala com 10 s de silencio entre eles — a forma da fixture. */
const CANDIDATES = [
  { startOffsetMs: 0, endOffsetMs: 3_000, durationMs: 3_000, speechProbability: 0.95, samples: 48_000 },
  { startOffsetMs: 13_000, endOffsetMs: 15_000, durationMs: 2_000, speechProbability: 0.9, samples: 32_000 },
];

function comparison(runs: AsrModelRun[], candidates = CANDIDATES): AsrModelComparison {
  return {
    vadRuns: 1,
    candidates,
    candidateFingerprint: "fp",
    runs,
    pcmPersisted: false,
    peakConcurrentModels: 1,
  };
}

describe("relatorio da comparacao A/B", () => {
  it("F — os dois modelos sao medidos contra a MESMA referencia", () => {
    const report = buildAsrAbReport(
      comparison([
        run({ text: ASR_AB_REFERENCE }),
        run({ modelId: "onnx-community/whisper-small", label: "Small q8", text: "outra coisa" }),
      ]),
      ASR_AB_REFERENCE,
      ASR_AB_FIXTURE_VERSION,
    );

    expect(report.reference).toBe(ASR_AB_REFERENCE);
    // Denominador identico: a comparacao so vale se N for o mesmo dos dois lados.
    const [base, small] = report.models;
    expect(base!.quality!.werNormalized.referenceLength).toBe(
      small!.quality!.werNormalized.referenceLength,
    );
    // E o lado que acertou tudo tem taxa zero.
    expect(base!.quality!.werNormalized.rate).toBe(0);
    expect(small!.quality!.werNormalized.rate).toBeGreaterThan(0);
  });

  it("G — o relatorio nunca elege um vencedor", () => {
    const report = buildAsrAbReport(
      comparison([
        run({ text: "errado errado errado" }),
        run({ modelId: "onnx-community/whisper-small", label: "Small q8", text: ASR_AB_REFERENCE }),
      ]),
      ASR_AB_REFERENCE,
      ASR_AB_FIXTURE_VERSION,
    );

    /*
      O `small` acertou tudo e o `base` errou tudo — o caso em que um
      classificador automatico mais teria vontade de decidir. Ele continua sem
      decidir: `MORE_ACCURATE != AUTOMATICALLY_BETTER`, e latencia e memoria nem
      entram nesta funcao.
    */
    expect(report.winner).toBeNull();
  });

  it("11 — texto dentro da janela de silencio reprova o gate", () => {
    const fabricado = run({
      text: "obrigado por assistir",
      transcription: {
        accepted: [
          { startOffsetMs: 5_000, endOffsetMs: 7_000, text: "obrigado por assistir", wordCount: 3 },
        ],
        rejected: [],
      },
    });

    const report = buildAsrAbReport(
      comparison([fabricado]),
      ASR_AB_REFERENCE,
      ASR_AB_FIXTURE_VERSION,
    );

    expect(report.silenceWindow).toEqual({ startOffsetMs: 3_000, endOffsetMs: 13_000 });
    expect(report.models[0]!.silenceGate).toBe("fail");
    expect(report.models[0]!.fabricatedDuringSilence).toHaveLength(1);
  });

  it("11 — fala dentro dos trechos legitimos nao aciona o gate", () => {
    const honesto = run({
      text: "duas frases",
      transcription: {
        accepted: [
          { startOffsetMs: 0, endOffsetMs: 3_000, text: "duas", wordCount: 1 },
          { startOffsetMs: 13_000, endOffsetMs: 15_000, text: "frases", wordCount: 1 },
        ],
        rejected: [],
      },
    });

    const report = buildAsrAbReport(comparison([honesto]), ASR_AB_REFERENCE, ASR_AB_FIXTURE_VERSION);
    expect(report.models[0]!.silenceGate).toBe("pass");
    expect(report.models[0]!.fabricatedDuringSilence).toEqual([]);
  });

  it("11 — sem janela de silencio localizavel o gate fica indeterminado, e nao aprovado", () => {
    const semPausa = [
      { startOffsetMs: 0, endOffsetMs: 3_000, durationMs: 3_000, speechProbability: 0.9, samples: 48_000 },
      { startOffsetMs: 4_000, endOffsetMs: 6_000, durationMs: 2_000, speechProbability: 0.9, samples: 32_000 },
    ];

    const report = buildAsrAbReport(
      comparison([run({ text: "qualquer coisa" })], semPausa),
      ASR_AB_REFERENCE,
      ASR_AB_FIXTURE_VERSION,
    );

    expect(report.silenceWindow).toBeNull();
    /*
      `indeterminate`, e nao `pass`.

      Aprovar por falta de evidencia seria afirmar que o modelo nao fabricou
      num silencio que ninguem mediu. `NULL is not zero`.
    */
    expect(report.models[0]!.silenceGate).toBe("indeterminate");
  });

  it("18 — modelo que nao carregou nao recebe WER", () => {
    const report = buildAsrAbReport(
      comparison([run({ loaded: false, failure: "load_failed", transcription: null })]),
      ASR_AB_REFERENCE,
      ASR_AB_FIXTURE_VERSION,
    );

    /*
      Um WER de 1.0 aqui pareceria "o modelo se saiu pessimo". Ele nem rodou.
      Ausencia de medicao e diferente de medicao ruim.
    */
    expect(report.models[0]!.quality).toBeNull();
    expect(report.models[0]!.silenceGate).toBe("indeterminate");
  });

  it("a janela de silencio e a maior pausa de pelo menos 8 s", () => {
    const window = findSilenceWindow([
      { startOffsetMs: 0, endOffsetMs: 1_000 },
      { startOffsetMs: 3_000, endOffsetMs: 4_000 },
      { startOffsetMs: 15_000, endOffsetMs: 16_000 },
    ]);
    expect(window).toEqual({ startOffsetMs: 4_000, endOffsetMs: 15_000 });

    // Uma pausa de 2 s nao e a pausa da fixture.
    expect(
      findSilenceWindow([
        { startOffsetMs: 0, endOffsetMs: 1_000 },
        { startOffsetMs: 3_000, endOffsetMs: 4_000 },
      ]),
    ).toBeNull();
  });

  it("a referencia da fixture nao inclui o bloco de silencio", () => {
    expect(ASR_AB_REFERENCE).toContain("Hoje eu não vou compartilhar a tela");
    expect(ASR_AB_REFERENCE).toContain("Agora eu voltei a falar");
    expect(ASR_AB_REFERENCE).not.toMatch(/\s{2,}/u);
  });
});
