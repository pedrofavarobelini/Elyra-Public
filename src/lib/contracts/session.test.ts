import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_SETUP,
  MAX_MEDIA_BYTES,
  MEDIA_KIND_LABEL,
  mediaAssetSchema,
  sessionCreateSchema,
  sessionSetupSchema,
} from "@/lib/contracts/session";

const MIB = 1024 * 1024;

function mediaAssetWithSize(sizeBytes: number) {
  return {
    id: "94000000-0000-4000-8000-000000000001",
    sessionId: "94000000-0000-4000-8000-000000000002",
    mediaKind: "camera" as const,
    mimeType: "video/webm" as const,
    sizeBytes,
    durationMs: 1000,
    checksumSha256: "a".repeat(64),
    retentionUntil: "2026-09-11T00:00:00.000Z",
    status: "stored" as const,
  };
}

describe("multimodal session Stage 11", () => {
  const captureCombinations = [
    { screen: true, camera: false, microphone: false },
    { screen: false, camera: true, microphone: false },
    { screen: false, camera: false, microphone: true },
    { screen: false, camera: true, microphone: true },
    { screen: true, camera: false, microphone: true },
    { screen: true, camera: true, microphone: false },
    { screen: true, camera: true, microphone: true },
  ] as const;

  it("mantem todas as finalidades desligadas por padrao", () => {
    expect(sessionSetupSchema.parse(DEFAULT_SESSION_SETUP)).toEqual({
      kind: "guided",
      screen: false,
      camera: false,
      microphone: false,
      transcribe: false,
      visualAnalysis: false,
      keepRecording: false,
      aiAnalysis: false,
      shareResult: false,
      shareTranscript: false,
      shareRecording: false,
      trainingEligible: false,
    });
  });

  it("exige captura e nao herda Storage, IA, sharing ou learning", () => {
    expect(sessionCreateSchema.safeParse(DEFAULT_SESSION_SETUP).success).toBe(false);
    const parsed = sessionCreateSchema.parse({
      ...DEFAULT_SESSION_SETUP,
      microphone: true,
    });
    expect(parsed).toMatchObject({
      microphone: true,
      keepRecording: false,
      aiAnalysis: false,
      shareResult: false,
      trainingEligible: false,
    });
  });

  it("fecha dependencias de sharing e learning antecipado", () => {
    expect(sessionCreateSchema.safeParse({
      ...DEFAULT_SESSION_SETUP,
      microphone: true,
      shareTranscript: true,
    }).success).toBe(false);
    expect(sessionCreateSchema.safeParse({
      ...DEFAULT_SESSION_SETUP,
      microphone: true,
      shareRecording: true,
    }).success).toBe(false);
    expect(sessionCreateSchema.safeParse({
      ...DEFAULT_SESSION_SETUP,
      microphone: true,
      trainingEligible: true,
    }).success).toBe(false);
  });

  it.each(captureCombinations)(
    "aceita a combinacao independente screen=$screen camera=$camera microphone=$microphone",
    (capture) => {
      const parsed = sessionCreateSchema.parse({
        ...DEFAULT_SESSION_SETUP,
        ...capture,
      });
      expect(parsed).toMatchObject(capture);
      expect(parsed).toMatchObject({
        keepRecording: false,
        aiAnalysis: false,
        shareResult: false,
        shareTranscript: false,
        shareRecording: false,
        trainingEligible: false,
      });
    },
  );
});

describe("contrato de tamanho do asset multimodal Stage 22-R", () => {
  it("fixa o teto Zod em 32 MiB", () => {
    expect(MAX_MEDIA_BYTES).toBe(32 * MIB);
  });

  it.each([
    ["1 byte", 1],
    ["5 MiB", 5 * MIB],
    ["5 MiB + 1 byte", 5 * MIB + 1],
    ["32 MiB", 32 * MIB],
  ])("aceita %s", (_label, sizeBytes) => {
    expect(mediaAssetSchema.safeParse(mediaAssetWithSize(sizeBytes)).success).toBe(true);
  });

  it("recusa 32 MiB + 1 byte", () => {
    expect(
      mediaAssetSchema.safeParse(mediaAssetWithSize(32 * MIB + 1)).success,
    ).toBe(false);
  });
});

describe("MEDIA_KIND_LABEL", () => {
  it("nomeia a midia gravada, nao o gesto de permissao (H9, Stage 23-H)", () => {
    expect(`Apagar gravação de ${MEDIA_KIND_LABEL.microphone}`).toBe(
      "Apagar gravação de Microfone",
    );
    for (const label of Object.values(MEDIA_KIND_LABEL)) {
      expect(label).not.toMatch(/^(Usar|Gravar)/);
    }
  });
});
