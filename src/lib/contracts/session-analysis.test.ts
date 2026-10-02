import { describe, expect, it } from "vitest";

import {
  sessionAnalysisResultSchema,
  sessionAnalysisSubmissionSchema,
  sessionMeasurementSchema,
  transcriptSubmissionSchema,
} from "@/lib/contracts/session-analysis";

/**
 * O contrato de submissao e a primeira barreira contra dado fabricado.
 *
 * Cada teste abaixo descreve uma forma concreta de mentir sobre uma sessao —
 * medir audio sem microfone, transcrever sem microfone, falar por mais tempo do
 * que a sessao durou — e prova que a barreira recusa antes de tocar o banco.
 */

/**
 * Cobertura derivada dos recursos, e nao escrita a mao.
 *
 * O contrato recusa recurso capturado sem cobertura e cobertura de recurso nao
 * capturado. Um helper que escrevesse as duas listas separadamente produziria,
 * na primeira alteracao, uma submissao que so ele mesmo aceita.
 */
function coverageFor(resources: readonly string[], durationMs: number) {
  return (["screen", "camera", "microphone"] as const).map((modality) =>
    resources.includes(modality)
      ? { modality, outcome: "full", reason: null, coverageMs: durationMs, sessionDurationMs: durationMs }
      : { modality, outcome: "absent", reason: "not_requested", coverageMs: 0, sessionDurationMs: durationMs },
  );
}

function submission(overrides: Record<string, unknown> = {}) {
  const durationMs = (overrides.durationMs as number | undefined) ?? 300_000;
  const capturedResources =
    (overrides.capturedResources as string[] | undefined) ?? ["microphone"];
  return {
    durationMs,
    capturedResources,
    transcript: null,
    measurements: [{ name: "pause_count", value: 4 }],
    coverage: coverageFor(capturedResources, durationMs),
    ...overrides,
  };
}

describe("transcriptSubmissionSchema", () => {
  it("aceita transcricao disponivel completa", () => {
    const parsed = transcriptSubmissionSchema.parse({
      status: "available",
      text: "Falei sobre o meu dia.",
      wordCount: 5,
      voicedDurationMs: 12_000,
      truncated: false,
    });
    expect(parsed.status).toBe("available");
  });

  it("recusa transcricao disponivel sem texto", () => {
    expect(
      transcriptSubmissionSchema.safeParse({
        status: "available",
        text: "",
        wordCount: 1,
        voicedDurationMs: 10,
        truncated: false,
      }).success,
    ).toBe(false);
  });

  it("recusa indisponibilidade sem motivo do vocabulario fechado", () => {
    expect(
      transcriptSubmissionSchema.safeParse({
        status: "unavailable",
        reason: "o microfone estava ruim",
      }).success,
    ).toBe(false);
  });

  it("recusa texto viajando junto de um estado indisponivel", () => {
    expect(
      transcriptSubmissionSchema.safeParse({
        status: "unavailable",
        reason: "no_speech_detected",
        text: "texto que nao deveria existir",
      }).success,
    ).toBe(false);
  });
});

describe("sessionMeasurementSchema", () => {
  it("aceita ausencia de medida como null", () => {
    expect(
      sessionMeasurementSchema.parse({ name: "speech_rate", value: null }).value,
    ).toBeNull();
  });

  it("recusa valor acima do teto do sinal", () => {
    expect(
      sessionMeasurementSchema.safeParse({ name: "speech_rate", value: 4000 })
        .success,
    ).toBe(false);
  });

  it("recusa indice fora de 0-1", () => {
    expect(
      sessionMeasurementSchema.safeParse({ name: "vocal_variation", value: 7 })
        .success,
    ).toBe(false);
  });

  it("recusa baseline enviada pelo cliente", () => {
    // A media pessoal e autoridade do servidor. Se o contrato aceitasse este
    // campo, a pagina poderia declarar qualquer sessao como "dentro do normal".
    expect(
      sessionMeasurementSchema.safeParse({
        name: "pause_count",
        value: 3,
        personalBaselineMean: 3,
      }).success,
    ).toBe(false);
  });

  it("recusa sinal fora do vocabulario fechado", () => {
    expect(
      sessionMeasurementSchema.safeParse({ name: "ansiedade", value: 0.5 })
        .success,
    ).toBe(false);
  });
});

describe("sessionAnalysisSubmissionSchema", () => {
  it("aceita uma submissao coerente", () => {
    expect(sessionAnalysisSubmissionSchema.safeParse(submission()).success).toBe(
      true,
    );
  });

  it("recusa sinal de audio sem captura de microfone", () => {
    const result = sessionAnalysisSubmissionSchema.safeParse(
      submission({
        capturedResources: ["camera"],
        measurements: [{ name: "vocal_variation", value: 0.4 }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("recusa sinal de movimento sem captura de camera", () => {
    const result = sessionAnalysisSubmissionSchema.safeParse(
      submission({
        capturedResources: ["microphone"],
        measurements: [{ name: "movement_frequency", value: 0.2 }],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("permite sinal sem valor mesmo sem a captura correspondente", () => {
    // `not_captured` e informacao legitima: diz que nao medimos, e nao que deu
    // zero. So o valor exige a captura.
    const result = sessionAnalysisSubmissionSchema.safeParse(
      submission({
        capturedResources: ["microphone"],
        measurements: [{ name: "movement_frequency", value: null }],
      }),
    );
    expect(result.success).toBe(true);
  });

  it("recusa transcricao sem captura de microfone", () => {
    const result = sessionAnalysisSubmissionSchema.safeParse(
      submission({
        capturedResources: ["screen"],
        measurements: [],
        transcript: {
          status: "available",
          text: "algo",
          wordCount: 1,
          voicedDurationMs: 1000,
          truncated: false,
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("recusa tempo falado maior que a duracao da sessao", () => {
    const result = sessionAnalysisSubmissionSchema.safeParse(
      submission({
        durationMs: 10_000,
        transcript: {
          status: "available",
          text: "algo",
          wordCount: 1,
          voicedDurationMs: 60_000,
          truncated: false,
        },
      }),
    );
    expect(result.success).toBe(false);
  });

  it("recusa medida duplicada", () => {
    const result = sessionAnalysisSubmissionSchema.safeParse(
      submission({
        measurements: [
          { name: "pause_count", value: 3 },
          { name: "pause_count", value: 9 },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });

  it("recusa recurso de captura duplicado", () => {
    const result = sessionAnalysisSubmissionSchema.safeParse(
      submission({ capturedResources: ["microphone", "microphone"] }),
    );
    expect(result.success).toBe(false);
  });

  it("recusa campo desconhecido na submissao", () => {
    const result = sessionAnalysisSubmissionSchema.safeParse(
      submission({ interpretation: "ja pronta" }),
    );
    expect(result.success).toBe(false);
  });

  it("recusa submissao sem nenhum recurso capturado", () => {
    const result = sessionAnalysisSubmissionSchema.safeParse(
      submission({ capturedResources: [], measurements: [] }),
    );
    expect(result.success).toBe(false);
  });
});

describe("sessionAnalysisResultSchema", () => {
  const base = {
    sessionId: "44444444-4444-4444-8444-444444444444",
    state: "pending",
    transcript: {
      state: "pending",
      reason: null,
      text: null,
      wordCount: null,
      voicedDurationMs: null,
      truncated: false,
    },
    signalsState: "pending",
    signals: [],

    // e sem segmento registrados.
    coverage: [],
    windows: [],
    transcriptSegments: [],
    selfReport: null,
    interpretation: {
      state: "pending",
      output: null,
      providerUsed: null,
      model: null,
      createdAt: null,
    },
  };

  it("aceita um resultado ainda nao processado", () => {
    expect(sessionAnalysisResultSchema.safeParse(base).success).toBe(true);
  });

  it("recusa texto em uma transcricao que nao esta disponivel", () => {
    const result = sessionAnalysisResultSchema.safeParse({
      ...base,
      transcript: { ...base.transcript, text: "texto fabricado" },
    });
    expect(result.success).toBe(false);
  });

  it("recusa interpretacao disponivel sem saida persistida", () => {
    const result = sessionAnalysisResultSchema.safeParse({
      ...base,
      interpretation: { ...base.interpretation, state: "available" },
    });
    expect(result.success).toBe(false);
  });
});
