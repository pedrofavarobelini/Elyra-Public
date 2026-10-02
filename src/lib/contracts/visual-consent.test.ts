import { describe, expect, it } from "vitest";

import { notRequestedCoverage } from "@/lib/contracts/capture-coverage";
import { multimodalInputFixture } from "@/lib/contracts/multimodal-fixtures";
import {
  VISUAL_EXTRACTOR_VERSION,
  buildMultimodalInput,
  elyraMultimodalInputSchema,
  type ObservableSignalContract,
} from "@/lib/contracts/multimodal-signals";
import {
  DEFAULT_SESSION_SETUP,
  sessionCreateSchema,
  sessionSetupSchema,
} from "@/lib/contracts/session";
import { sessionAnalysisSubmissionSchema } from "@/lib/contracts/session-analysis";
import { buildObservableSignal } from "@/lib/multimodal-signals";

const DURATION_MS = 600_000;

function visualCoverage(modality: "visual_face" | "visual_body" | "visual_hands") {
  return {
    modality,
    outcome: "partial" as const,
    reason: "out_of_frame" as const,
    coverageMs: 300_000,
    sessionDurationMs: DURATION_MS,
  };
}

function headSignal(): ObservableSignalContract {
  return buildObservableSignal("head_movement_frequency", 0.4, null, null);
}

describe("consentimento visual e uma decisao propria", () => {
  it("nasce desligado", () => {
    expect(DEFAULT_SESSION_SETUP.visualAnalysis).toBe(false);
  });

  it("exige camera", () => {
    const result = sessionCreateSchema.safeParse({
      ...DEFAULT_SESSION_SETUP,
      microphone: true,
      camera: false,
      visualAnalysis: true,
    });
    expect(result.success).toBe(false);
  });

  it("camera sozinha nao liga a analise visual", () => {

    const setup = sessionSetupSchema.parse({
      ...DEFAULT_SESSION_SETUP,
      camera: true,
    });
    expect(setup.visualAnalysis).toBe(false);
  });
});

describe("a fronteira do Veltrix e fail-closed para o visual", () => {
  it("recusa sinal visual sem consentimento", () => {
    const result = elyraMultimodalInputSchema.safeParse({
      ...multimodalInputFixture(),
      visualAnalysisConsent: false,
      session: {
        ...multimodalInputFixture().session,
        signals: [...multimodalInputFixture().session.signals, headSignal()],
      },
    });
    expect(result.success).toBe(false);
  });

  it("recusa cobertura visual sem consentimento", () => {
    const base = multimodalInputFixture();
    const result = elyraMultimodalInputSchema.safeParse({
      ...base,
      visualAnalysisConsent: false,
      session: {
        ...base.session,
        modalityCoverage: [
          ...base.session.modalityCoverage,
          visualCoverage("visual_face"),
        ],
      },
    });
    /*
      Cobertura parece inofensiva e nao e: "rosto observavel por 22 dos 30
      minutos" e uma observacao sobre o corpo de alguem que nao autorizou
      observacao do corpo.
    */
    expect(result.success).toBe(false);
  });

  it("recusa janela visual sem consentimento", () => {
    const base = multimodalInputFixture();
    const result = elyraMultimodalInputSchema.safeParse({
      ...base,
      visualAnalysisConsent: false,
      session: {
        ...base.session,
        windows: [
          {
            signal: "head_movement_frequency",
            startOffsetMs: 0,
            endOffsetMs: 60_000,
            value: 0.3,
          },
        ],
      },
    });
    expect(result.success).toBe(false);
  });

  it("recusa sinal visual sem a cobertura da modalidade que o produziu", () => {
    const base = multimodalInputFixture();
    const result = elyraMultimodalInputSchema.safeParse({
      ...base,
      visualAnalysisConsent: true,
      session: {
        ...base.session,
        capturedResources: ["microphone", "camera"],
        // Cobertura da camera existe; a de `visual_face`, nao.
        signals: [...base.session.signals, headSignal()],
      },
    });
    expect(result.success).toBe(false);
  });

  it("recusa sinal visual sem captura de camera", () => {
    const base = multimodalInputFixture();
    const result = elyraMultimodalInputSchema.safeParse({
      ...base,
      visualAnalysisConsent: true,
      session: {
        ...base.session,
        capturedResources: ["microphone"],
        modalityCoverage: [
          notRequestedCoverage("camera", base.session.durationMs),
          notRequestedCoverage("visual_face", base.session.durationMs),
        ],
        // So o sinal visual: sem camera, `movement_frequency` tambem seria
        // recusado, e o teste falharia pela razao errada.
        signals: [headSignal()],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe("buildMultimodalInput remove o visual antes de montar o payload", () => {
  const commonInput = {
    sessionKind: "guided" as const,
    capturedResources: ["camera", "microphone"] as ("camera" | "microphone")[],
    durationMs: DURATION_MS,
    selfReport: null,
    transcript: null,
    transcriptAnalysisConsent: false,
  };

  it("sem consentimento, sinal, janela e cobertura visuais nao chegam a existir", () => {
    const input = buildMultimodalInput({
      ...commonInput,
      modalityCoverage: [
        {
          modality: "camera",
          outcome: "full",
          reason: null,
          coverageMs: DURATION_MS,
          sessionDurationMs: DURATION_MS,
        },
        visualCoverage("visual_face"),
      ],
      windows: [
        {
          signal: "head_movement_frequency",
          startOffsetMs: 0,
          endOffsetMs: 60_000,
          value: 0.3,
        },
      ],
      signals: [
        buildObservableSignal("movement_frequency", 0.2, null, null),
        headSignal(),
      ],
      visualAnalysisConsent: false,
    });

    expect(input.visualAnalysisConsent).toBe(false);
    expect(input.session.signals.map((signal) => signal.name)).toEqual([
      "movement_frequency",
    ]);
    expect(input.session.windows).toHaveLength(0);
    expect(
      input.session.modalityCoverage.map((coverage) => coverage.modality),
    ).toEqual(["camera"]);

    // Nenhum vestigio do vocabulario visual no payload serializado.
    const serialized = JSON.stringify(input);
    for (const forbidden of [
      "head_movement_frequency",
      "visual_face",
      "visual_body",
      "visual_hands",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("com consentimento, o visual atravessa com a cobertura da propria modalidade", () => {
    const input = buildMultimodalInput({
      ...commonInput,
      modalityCoverage: [
        {
          modality: "camera",
          outcome: "full",
          reason: null,
          coverageMs: DURATION_MS,
          sessionDurationMs: DURATION_MS,
        },
        visualCoverage("visual_face"),
      ],
      windows: [],
      signals: [headSignal()],
      visualAnalysisConsent: true,
    });

    const [signal] = input.session.signals;
    expect(signal!.name).toBe("head_movement_frequency");
    expect(
      input.session.modalityCoverage.some(
        (coverage) => coverage.modality === "visual_face",
      ),
    ).toBe(true);
  });

  it("a projecao nunca carrega midia, coordenada ou template facial", () => {
    const input = buildMultimodalInput({
      ...commonInput,
      modalityCoverage: [visualCoverage("visual_face")],
      windows: [],
      signals: [headSignal()],
      visualAnalysisConsent: true,
    });

    const serialized = JSON.stringify(input).toLowerCase();
    /*
      Lista precisa de proposito.

      A primeira versao proibia a substring `frame` e falhava em `out_of_frame` -
      o **motivo legitimo** de cobertura parcial. Um teste de privacidade que
      reprova o vocabulario correto ensina a afrouxa-lo, e a proxima pessoa
      relaxaria a lista inteira em vez de so este termo.
    */
    for (const forbidden of [
      "landmark",
      "blendshape",
      "keypoint",
      "facialtransformation",
      "imagedata",
      "videoframe",
      "base64",
      "blob:",
      "data:image",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe("analise visual autorizada que nao observou nada", () => {
  const base = {
    durationMs: DURATION_MS,
    capturedResources: ["camera", "microphone"] as const,
    visualAnalysis: true,
    transcript: null,
    measurements: [],
    windows: [],
    transcriptSegments: [],
    selfReport: null,
  };

  function submission(visualOutcome: {
    outcome: "absent";
    reason: "unsupported" | "error" | "not_observed";
  }) {
    return {
      ...base,
      coverage: [
        {
          modality: "camera",
          outcome: "full",
          reason: null,
          coverageMs: DURATION_MS,
          sessionDurationMs: DURATION_MS,
        },
        {
          modality: "microphone",
          outcome: "full",
          reason: null,
          coverageMs: DURATION_MS,
          sessionDurationMs: DURATION_MS,
        },
        ...(["visual_face", "visual_body", "visual_hands"] as const).map(
          (modality) => ({
            modality,
            ...visualOutcome,
            coverageMs: 0,
            sessionDurationMs: DURATION_MS,
          }),
        ),
      ],
    };
  }

  it("aceita cobertura visual ausente quando o motor nao produziu nada", () => {

    for (const reason of ["unsupported", "error", "not_observed"] as const) {
      const result = sessionAnalysisSubmissionSchema.safeParse(
        submission({ outcome: "absent", reason }),
      );
      expect(result.success, reason).toBe(true);
    }
  });

  it("modalidade de captura ausente com o recurso capturado continua recusada", () => {
    // A regra original nao foi enfraquecida: ela so deixou de ser aplicada onde
    // nao valia.
    const result = sessionAnalysisSubmissionSchema.safeParse({
      ...base,
      coverage: [
        {
          modality: "microphone",
          outcome: "absent",
          reason: "not_requested",
          coverageMs: 0,
          sessionDurationMs: DURATION_MS,
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("versao do extrator visual", () => {
  it("e propria, e nao continuacao de elyra-signals", () => {
    /*
      Aritmetica visual e aritmetica de audio evoluem em ritmos diferentes.
      Reutilizar `elyra-signals/vN` obrigaria a marcar toda serie de audio como
      nova a cada ajuste de limiar de movimento, e a mentir sobre qual conta
      produziu qual numero.
    */
    expect(VISUAL_EXTRACTOR_VERSION).toBe("elyra-visual/v1");
    expect(VISUAL_EXTRACTOR_VERSION.startsWith("elyra-signals/")).toBe(false);
  });
});
