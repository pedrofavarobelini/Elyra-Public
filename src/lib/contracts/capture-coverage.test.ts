import { describe, expect, it } from "vitest";

import {
  COVERAGE_UNQUALIFIED_MIN_RATIO,
  captureCoverageSchema,
  coverageNeedsQualification,
  coverageRatio,
  notRequestedCoverage,
} from "@/lib/contracts/capture-coverage";
import {
  MEDIA_BITS_PER_SECOND,
  MEDIA_RECORDING_MAX_MS,
  MEDIA_SIZE_HEADROOM,
} from "@/lib/multimodal-capture";
import { MAX_MEDIA_BYTES, MAX_SESSION_MS } from "@/lib/contracts/session";

const FULL = {
  modality: "camera",
  outcome: "full",
  reason: null,
  coverageMs: 1_800_000,
  sessionDurationMs: 1_800_000,
} as const;

describe("cobertura completa", () => {
  it("aceita cobertura completa sem motivo", () => {
    expect(captureCoverageSchema.safeParse(FULL).success).toBe(true);
  });

  it("recusa cobertura completa com motivo", () => {
    expect(
      captureCoverageSchema.safeParse({ ...FULL, reason: "interrupted" }).success,
    ).toBe(false);
  });
});

describe("cobertura parcial", () => {
  it("aceita interrupcao com tempo menor que a sessao", () => {
    const parsed = captureCoverageSchema.safeParse({
      ...FULL,
      outcome: "partial",
      reason: "interrupted",
      coverageMs: 480_000,
    });
    expect(parsed.success).toBe(true);
  });

  it("aceita limite de gravacao como motivo proprio", () => {
    expect(
      captureCoverageSchema.safeParse({
        ...FULL,
        outcome: "partial",
        reason: "recording_capped",
        coverageMs: 760_000,
      }).success,
    ).toBe(true);
  });

  it("recusa parcial sem motivo declarado", () => {
    expect(
      captureCoverageSchema.safeParse({
        ...FULL,
        outcome: "partial",
        reason: null,
        coverageMs: 480_000,
      }).success,
    ).toBe(false);
  });

  /**
   * Perder a track e bater no teto de gravacao sao os dois motivos parciais.
   * Permissao negada nao e parcial - e ausencia -, e cruzar os dois esconderia
   * qual dos dois aconteceu.
   */
  it("recusa motivo de ausencia num desfecho parcial", () => {
    expect(
      captureCoverageSchema.safeParse({
        ...FULL,
        outcome: "partial",
        reason: "denied",
        coverageMs: 480_000,
      }).success,
    ).toBe(false);
  });

  it("recusa cobertura maior que a sessao", () => {
    expect(
      captureCoverageSchema.safeParse({
        ...FULL,
        outcome: "partial",
        reason: "interrupted",
        coverageMs: 1_900_000,
      }).success,
    ).toBe(false);
  });
});

describe("ausencia", () => {
  it("distingue nao autorizada de negada", () => {
    const naoPedida = notRequestedCoverage("screen", 600_000);
    expect(naoPedida.reason).toBe("not_requested");
    expect(
      captureCoverageSchema.safeParse({ ...naoPedida, reason: "denied" }).success,
    ).toBe(true);
  });

  /** Ausencia com tempo afirmaria captura, que e o que `absent` nega. */
  it("recusa ausencia que carrega tempo", () => {
    expect(
      captureCoverageSchema.safeParse({
        modality: "camera",
        outcome: "absent",
        reason: "unsupported",
        coverageMs: 1,
        sessionDurationMs: 600_000,
      }).success,
    ).toBe(false);
  });

  it("recusa motivo parcial num desfecho ausente", () => {
    expect(
      captureCoverageSchema.safeParse({
        modality: "camera",
        outcome: "absent",
        reason: "interrupted",
        coverageMs: 0,
        sessionDurationMs: 600_000,
      }).success,
    ).toBe(false);
  });
});

describe("fracao coberta", () => {
  it("calcula a fracao da sessao", () => {
    expect(coverageRatio({ coverageMs: 480_000, sessionDurationMs: 1_800_000 }))
      .toBeCloseTo(0.2667, 3);
  });

  /**
   * Sessao de duracao zero devolve `0`, e nao `1`: nao houve sessao para cobrir,
   * e arredondar isso para "completa" seria afirmar cobertura que ninguem mediu.
   */
  it("sessao de duracao zero nao vira cobertura completa", () => {
    expect(coverageRatio({ coverageMs: 0, sessionDurationMs: 0 })).toBe(0);
  });

  it("cobertura abaixo do minimo exige ressalva", () => {
    const parcial = captureCoverageSchema.parse({
      ...FULL,
      outcome: "partial",
      reason: "interrupted",
      coverageMs: 180_000,
    });
    expect(coverageNeedsQualification(parcial)).toBe(true);
  });

  it("cobertura completa nao exige ressalva", () => {
    expect(coverageNeedsQualification(captureCoverageSchema.parse(FULL))).toBe(
      false,
    );
  });

  /** Ausencia ja e dita pelo proprio desfecho; ressalva ali seria redundante. */
  it("ausencia nao entra na regra de ressalva", () => {
    expect(coverageNeedsQualification(notRequestedCoverage("screen", 600_000)))
      .toBe(false);
  });

  it("o minimo e explicito e versionado, nao um numero solto na tela", () => {
    expect(COVERAGE_UNQUALIFIED_MIN_RATIO).toBeGreaterThan(0);
    expect(COVERAGE_UNQUALIFIED_MIN_RATIO).toBeLessThanOrEqual(1);
  });
});


describe("teto de gravacao derivado do bitrate", () => {
  it("cabe no limite de bytes do contrato, com a folga declarada", () => {
    for (const modality of ["screen", "camera", "microphone"] as const) {
      const bytes =
        (MEDIA_RECORDING_MAX_MS[modality] / 1000) *
        (MEDIA_BITS_PER_SECOND[modality] / 8);
      expect(bytes).toBeLessThanOrEqual(MAX_MEDIA_BYTES * MEDIA_SIZE_HEADROOM + 1);
    }
  });

  it("nunca ultrapassa a duracao maxima de uma sessao", () => {
    for (const modality of ["screen", "camera", "microphone"] as const) {
      expect(MEDIA_RECORDING_MAX_MS[modality]).toBeLessThanOrEqual(MAX_SESSION_MS);
    }
  });

  /**
   * O audio e o que sustenta a analise falada, e por isso ele nao pode ser o
   * primeiro a bater no teto: uma sessao inteira de fala precisa caber.
   */
  it("audio cobre a sessao inteira", () => {
    expect(MEDIA_RECORDING_MAX_MS.microphone).toBe(MAX_SESSION_MS);
  });

  /**
   * Video **nao** cobre a sessao inteira, e isso e declarado em vez de
   * descoberto no upload. A gravacao para; a analise continua.
   */
  it("video para antes do fim de uma sessao longa, de forma previsivel", () => {
    expect(MEDIA_RECORDING_MAX_MS.camera).toBeLessThan(MAX_SESSION_MS);
    expect(MEDIA_RECORDING_MAX_MS.camera).toBe(MEDIA_RECORDING_MAX_MS.screen);
  });
});
