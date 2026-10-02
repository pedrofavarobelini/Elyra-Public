import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildMultimodalInput,
  ELYRA_MULTIMODAL_CONTRACT_VERSION,
  FEATURE_EXTRACTOR_VERSION,
  SIGNALS_SCHEMA_VERSION,
  VISUAL_SIGNALS,
  type ObservableSignalContract,
} from "@/lib/contracts/multimodal-signals";
import type { CaptureCoverage } from "@/lib/contracts/capture-coverage";

/**
 * Fixtures de paridade do contrato `elyra-multimodal/v2`.
 *
 * ## O defeito que elas fecham
 *
 * A Elyra monta o payload; o Veltrix decide se o aceita. Ate aqui as duas
 * pontas eram verificadas **separadamente**: a Elyra provava que produzia um
 * objeto valido segundo a Elyra, e o Veltrix provava que aceitava um objeto
 * valido segundo o Veltrix. Os dois testes podiam continuar verdes para sempre
 * com os dois lados incompativeis — e foi exatamente o que aconteceu: a Elyra
 * enviava `elyra-multimodal/v2` para um servico que so conhecia a `v1`, e
 * nenhuma suite viu.
 *
 * Estas fixtures sao o objeto do meio. Elas sao geradas por
 * `buildMultimodalInput` — o mesmo caminho que uma sessao real usa, e nao um
 * literal escrito a mao que envelheceria sozinho — e o mesmo arquivo e
 * validado pelo schema Pydantic real do Veltrix, do outro lado.
 *
 * Se a Elyra passar a mandar um campo, ou deixar de mandar, o arquivo muda e o
 * lado que nao acompanhar quebra. E o que torna a incompatibilidade
 * **detectavel por teste** em vez de detectavel por leitura manual.
 *
 * Para regravar apos uma mudanca deliberada de contrato:
 *   UPDATE_CONTRACT_FIXTURES=1 npx vitest run tests/contract
 */

const OUTPUT_DIR = resolve(process.cwd(), "contract-fixtures", "elyra-multimodal-v2");

const coverage = (
  modality: CaptureCoverage["modality"],
  outcome: CaptureCoverage["outcome"],
  coverageMs: number,
  sessionDurationMs: number,
  reason: CaptureCoverage["reason"] = null,
): CaptureCoverage => ({ modality, outcome, reason, coverageMs, sessionDurationMs });

const signal = (
  name: ObservableSignalContract["name"],
  unit: ObservableSignalContract["unit"],
  value: number | null,
  personalBaselineMean: number | null,
  personalBaselineSamples: number,
  deltaVsPersonalBaseline: number | null,
  status: ObservableSignalContract["status"],
  cov: CaptureCoverage | null = null,
): ObservableSignalContract => ({
  name,
  value,
  unit,
  personalBaselineMean,
  personalBaselineSamples,
  deltaVsPersonalBaseline,
  status,
  coverage: cov,
});

/**
 * Os casos foram escolhidos por serem os que a V1 **nao sabia expressar**.
 *
 * Uma fixture que exercitasse so o que ja funcionava provaria paridade sobre o
 * subconjunto antigo e continuaria cega para a incompatibilidade real.
 */
const CASES: Record<string, () => unknown> = {
  // Sessao completa: audio + visual + autorrelato + janelas + transcricao.
  "full-multimodal": () =>
    buildMultimodalInput({
      sessionKind: "guided",
      capturedResources: ["camera", "microphone"],
      durationMs: 600_000,
      modalityCoverage: [
        coverage("camera", "full", 600_000, 600_000),
        coverage("microphone", "full", 600_000, 600_000),
        coverage("visual_face", "partial", 420_000, 600_000, "out_of_frame"),
        coverage("visual_body", "full", 600_000, 600_000),
        coverage("visual_hands", "absent", 0, 600_000, "not_observed"),
      ],
      selfReport: { mood: 6, perceivedAnxiety: 4, energy: 5 },
      windows: [
        { signal: "pause_count", startOffsetMs: 0, endOffsetMs: 300_000, value: 12 },
        {
          signal: "head_movement_frequency",
          startOffsetMs: 0,
          endOffsetMs: 300_000,
          value: 0.31,
        },
      ],
      signals: [
        signal("speech_rate", "words_per_minute", 132, 128, 9, 4, "available",
          coverage("microphone", "full", 600_000, 600_000)),
        signal("pause_count", "count", 18, 15, 9, 3, "available",
          coverage("microphone", "full", 600_000, 600_000)),
        signal("head_movement_frequency", "index", 0.31, 0.28, 7, 0.03, "available",
          coverage("visual_face", "partial", 420_000, 600_000, "out_of_frame")),
        signal("body_motion_amplitude", "index", 0.12, 0.11, 7, 0.01, "available",
          coverage("visual_body", "full", 600_000, 600_000)),
      ],
      transcript: {
        language: "pt-BR",
        text: "Falei sobre a semana e sobre o que mudou no trabalho.",
        wordCount: 10,
        voicedDurationMs: 240_000,
        truncated: false,
      },
      transcriptAnalysisConsent: true,
      visualAnalysisConsent: true,
    }),

  // Microfone apenas: a rota sem nada visual (FASE H3).
  "microphone-only": () =>
    buildMultimodalInput({
      sessionKind: "free",
      capturedResources: ["microphone"],
      durationMs: 180_000,
      modalityCoverage: [coverage("microphone", "full", 180_000, 180_000)],
      selfReport: { mood: null, perceivedAnxiety: 7, energy: null },
      windows: [],
      signals: [
        signal("speech_rate", "words_per_minute", 118, 124, 12, -6, "available",
          coverage("microphone", "full", 180_000, 180_000)),
        signal("vocal_variation", "index", 0.44, null, 0, null, "insufficient_baseline",
          coverage("microphone", "full", 180_000, 180_000)),
      ],
      transcript: {
        language: "pt-BR",
        text: "Hoje foi um dia corrido.",
        wordCount: 5,
        voicedDurationMs: 90_000,
        truncated: false,
      },
      transcriptAnalysisConsent: true,
      visualAnalysisConsent: false,
    }),

  /*
    Camera ligada SEM consentimento de analise visual.

    Prova que sinal, janela e cobertura visuais sao removidos ANTES de montar o
    payload, e nao filtrados na apresentacao.
  */
  "camera-without-visual-consent": () =>
    buildMultimodalInput({
      sessionKind: "guided",
      capturedResources: ["camera", "microphone"],
      durationMs: 300_000,
      modalityCoverage: [
        coverage("camera", "full", 300_000, 300_000),
        coverage("microphone", "full", 300_000, 300_000),
        coverage("visual_face", "full", 300_000, 300_000),
      ],
      selfReport: null,
      windows: [
        { signal: "movement_frequency", startOffsetMs: 0, endOffsetMs: 150_000, value: 0.2 },
        {
          signal: "hand_movement_frequency",
          startOffsetMs: 0,
          endOffsetMs: 150_000,
          value: 0.4,
        },
      ],
      signals: [
        signal("movement_frequency", "index", 0.21, 0.2, 5, 0.01, "available",
          coverage("camera", "full", 300_000, 300_000)),
        signal("hand_movement_frequency", "index", 0.4, 0.38, 5, 0.02, "available",
          coverage("visual_hands", "full", 300_000, 300_000)),
      ],
      transcript: null,
      transcriptAnalysisConsent: false,
      visualAnalysisConsent: false,
    }),

  // Ausencia real: nada capturado produziu valor. NULL nao e zero.
  "absent-signals": () =>
    buildMultimodalInput({
      sessionKind: "deep_checkin",
      capturedResources: ["microphone"],
      durationMs: 60_000,
      modalityCoverage: [
        coverage("microphone", "partial", 12_000, 60_000, "interrupted"),
      ],
      selfReport: { mood: 3, perceivedAnxiety: null, energy: null },
      windows: [],
      signals: [
        signal("speech_rate", "words_per_minute", null, null, 0, null, "not_captured",
          coverage("microphone", "partial", 12_000, 60_000, "interrupted")),
      ],
      transcript: null,
      transcriptAnalysisConsent: false,
      visualAnalysisConsent: false,
    }),
};

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const update = process.env.UPDATE_CONTRACT_FIXTURES === "1";

describe("paridade de contrato elyra-multimodal/v2", () => {
  const digests: Record<string, string> = {};

  for (const [name, build] of Object.entries(CASES)) {
    it(`fixture ${name} e estavel e reflete o codigo real`, () => {
      const text = `${JSON.stringify(build(), null, 2)}\n`;
      digests[name] = sha256(text);
      const file = resolve(OUTPUT_DIR, `${name}.json`);

      if (update) {
        mkdirSync(OUTPUT_DIR, { recursive: true });
        writeFileSync(file, text, "utf8");
      }

      /*
        A fixture committada e o que o Veltrix realmente valida do outro lado.
        Se ela nao existir, ou divergir do que o codigo produz hoje, a paridade
        nao esta provada - e passar assim mesmo seria o proprio defeito que
        estas fixtures existem para impedir.
      */
      expect(
        existsSync(file),
        `Fixture ausente. Rode: UPDATE_CONTRACT_FIXTURES=1 npx vitest run tests/contract`,
      ).toBe(true);
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  }

  it("o manifesto de digests acompanha as fixtures", () => {
    const manifestFile = resolve(OUTPUT_DIR, "manifest.json");
    const manifest = {
      contract: ELYRA_MULTIMODAL_CONTRACT_VERSION,
      signalsSchemaVersion: SIGNALS_SCHEMA_VERSION,
      featureExtractorVersion: FEATURE_EXTRACTOR_VERSION,
      fixtures: digests,
    };
    const text = `${JSON.stringify(manifest, null, 2)}\n`;

    if (update) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
      writeFileSync(manifestFile, text, "utf8");
    }

    /*
      O manifesto viaja para o Veltrix junto das fixtures. Ele e o que impede a
      falha silenciosa mais provavel: alguem copiar uma fixture antiga para la e
      o teste do outro lado passar validando um payload que a Elyra nao produz
      mais.
    */
    expect(existsSync(manifestFile)).toBe(true);
    expect(readFileSync(manifestFile, "utf8")).toBe(text);
  });

  it("as versoes declaradas sao as da V2", () => {
    expect(ELYRA_MULTIMODAL_CONTRACT_VERSION).toBe("elyra-multimodal/v2");
    expect(SIGNALS_SCHEMA_VERSION).toBe("multimodal_signals/v2");
    expect(FEATURE_EXTRACTOR_VERSION).toBe("elyra-signals/v3");
  });
});

describe("projecao minimizada", () => {
  const built = CASES["full-multimodal"]!() as Record<string, unknown>;

  /**
   * Chaves e valores sao verificados separadamente, e de proposito.
   *
   * A primeira versao deste teste procurava substrings no JSON inteiro e
   * reprovava a propria fixture: `out_of_frame` — um motivo legitimo de
   * cobertura parcial — contem "frame". Um teste de privacidade que dispara em
   * dado licito e pior que inutil, porque ensina a ignora-lo.
   */
  const keys: string[] = [];
  const strings: string[] = [];
  (function walk(node: unknown): void {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        keys.push(key);
        walk(value);
      }
      return;
    }
    if (typeof node === "string") strings.push(node);
  })(built);

  it("nenhuma chave de midia, Storage, identificador ou segredo atravessa", () => {
    const forbidden = [
      "userid", "user_id", "sessionid", "session_id", "id",
      "storage", "bucket", "path", "url", "signedurl", "publicurl",
      "mediaasset", "media_asset", "blob", "pcm", "waveform",
      "audio", "video", "frame", "frames", "image", "thumbnail",
      "landmark", "landmarks", "keypoint", "descriptor", "embedding",
      "apikey", "api_key", "token", "secret", "password", "credential",
      // WER e CER sao medidas de laboratorio da Elyra. Atravessa-las as
      // transformaria em atributo da sessao de alguem.
      "wer", "cer", "accuracy", "acuracia", "errorrate",
    ];
    for (const key of keys) {
      expect(forbidden, `chave proibida na projecao: ${key}`).not.toContain(
        key.toLowerCase(),
      );
    }
  });

  it("nenhum valor de texto carrega URL, caminho ou midia embutida", () => {
    for (const value of strings) {
      expect(value).not.toMatch(/https?:\/\//iu);
      expect(value).not.toMatch(/^data:/iu);
      expect(value).not.toMatch(/supabase|storage\.googleapis|s3\./iu);
      // Um caminho de Storage tem barra; a transcricao consentida nao tem por
      // que ter uma, e as demais strings sao enum ou rotulo.
      expect(value).not.toMatch(/\.(?:png|jpe?g|webm|mp4|wav|mp3|ogg)/iu);
    }
  });

  it("sem consentimento visual, nada derivado de landmark e montado", () => {
    const denied = CASES["camera-without-visual-consent"]!() as {
      visualAnalysisConsent: boolean;
      session: {
        signals: { name: string }[];
        windows: { signal: string }[];
        modalityCoverage: { modality: string }[];
      };
    };

    expect(denied.visualAnalysisConsent).toBe(false);
    expect(
      denied.session.signals.some((entry) =>
        VISUAL_SIGNALS.has(entry.name as never),
      ),
    ).toBe(false);
    expect(
      denied.session.windows.some((entry) =>
        VISUAL_SIGNALS.has(entry.signal as never),
      ),
    ).toBe(false);
    // Cobertura visual tambem nao: "rosto observavel por 22 dos 30 minutos" e
    // uma observacao sobre o corpo de quem nao autorizou observacao do corpo.
    expect(
      denied.session.modalityCoverage.some((entry) =>
        entry.modality.startsWith("visual_"),
      ),
    ).toBe(false);
    // E `movement_frequency`, que nao depende de landmark, sobrevive.
    expect(
      denied.session.signals.some((entry) => entry.name === "movement_frequency"),
    ).toBe(true);
  });
});
