import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { pedroCoreReportFixture } from "@/lib/contracts/pedrocore-fixtures";
import {
  MINIMUM_DAYS_WITH_DATA,
  MINIMUM_WINDOW_COMPLETENESS,
  QUALITY_CHECKS,
  elyraLearningSubmissionSchema,
  sanitizedLearningPayloadSchema,
} from "@/lib/contracts/learning";
import {
  buildLearningSubmission,
  canonicalJson,
  evaluateLearningEligibility,
  findSanitizationIssues,
  learningFingerprint,
  minimizeReport,
  runLearningQualityGate,
} from "@/lib/learning-pipeline";
import type { AnalyticsReportContract } from "@/lib/contracts/pedrocore";

function report(
  overrides: Partial<AnalyticsReportContract["dataQuality"]> = {},
): AnalyticsReportContract {
  const base = pedroCoreReportFixture();
  return {
    ...base,
    dataQuality: { ...base.dataQuality, ...overrides },
  };
}

const PRODUCED_AT = "2026-08-26T12:00:00.000Z";
const CONSENT_AT = "2026-08-20T12:00:00.000Z";

function submissionInput(overrides: Record<string, unknown> = {}) {
  return {
    report: report(),
    trainingConsentActive: true,
    trainingConsentGrantedAt: CONSENT_AT,
    producedAt: PRODUCED_AT,
    evaluatedAt: PRODUCED_AT,
    ...overrides,
  } as Parameters<typeof buildLearningSubmission>[0];
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

describe("evaluateLearningEligibility", () => {
  it("recusa sem consentimento de treino vigente", () => {
    const result = evaluateLearningEligibility({
      trainingConsentActive: false,
      report: report(),
    });

    expect(result.eligible).toBe(false);
    expect(result.rejectionCode).toBe("training_consent_missing");
  });

  it("consentimento nao torna um relatorio vazio elegivel", () => {
    const result = evaluateLearningEligibility({
      trainingConsentActive: true,
      report: report({
        daysWithMood: 2,
        daysWithAnxiety: 1,
        daysWithEnergy: 0,
        daysWithSleep: 0,
      }),
    });

    expect(result.eligible).toBe(false);
    expect(result.rejectionCode).toBe("insufficient_data");
  });

  it("recusa quando a janela esta majoritariamente vazia", () => {
    const result = evaluateLearningEligibility({
      trainingConsentActive: true,
      report: report({
        daysWithMood: MINIMUM_DAYS_WITH_DATA,
        daysWithAnxiety: 0,
        daysWithEnergy: 0,
        daysWithSleep: 0,
      }),
    });

    expect(result.eligible).toBe(false);
    expect(result.rejectionCode).toBe("insufficient_data");
  });

  it("aceita janela com historico suficiente", () => {
    const result = evaluateLearningEligibility({
      trainingConsentActive: true,
      report: report(),
    });

    expect(result.eligible).toBe(true);
    expect(result.rejectionCode).toBeNull();
  });

  it("inelegivel e resultado nomeado, nao excecao", () => {
    expect(() =>
      evaluateLearningEligibility({
        trainingConsentActive: false,
        report: report(),
      }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Minimization
// ---------------------------------------------------------------------------

describe("minimizeReport", () => {
  it("produz um payload que satisfaz o contrato", () => {
    expect(() =>
      sanitizedLearningPayloadSchema.parse(minimizeReport(report())),
    ).not.toThrow();
  });

  it("descarta a serie diaria, o fuso, as janelas e as associacoes", () => {
    const serialized = JSON.stringify(minimizeReport(report()));

    for (const dropped of [
      "series",
      "timeZone",
      "window",
      "previousWindow",
      "associations",
      "registeredBands",
      "moodHeatmapBucket",
    ]) {
      expect(serialized).not.toContain(dropped);
    }
  });

  it("mantem somente o opt-in do ciclo, nunca os dias registrados", () => {
    const payload = minimizeReport(report());

    expect(payload.cycleEnabled).toBe(false);
    expect(JSON.stringify(payload)).not.toContain("registeredMenstruationDays");
  });

  it("metrica sem dia registrado vira ausencia, nao zero", () => {
    const payload = minimizeReport(report({ daysWithSleep: 0 }));

    expect(payload.sleepDurationMinutes.samples).toBe(0);
    expect(payload.sleepDurationMinutes.mean).toBeNull();
    expect(payload.sleepDurationMinutes.delta).toBeNull();
    expect(payload.sleepDurationMinutes.trend).toBe("insufficient_data");
  });

  it("nao transporta identificador nem texto livre", () => {
    const issues = findSanitizationIssues(minimizeReport(report()));

    expect(issues).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

describe("findSanitizationIssues", () => {
  it("acusa diario", () => {
    const issues = findSanitizationIssues({ journal: "hoje me senti cansado" });

    expect(issues.some((issue) => issue.reason === "forbidden_key")).toBe(true);
  });

  it("acusa transcricao", () => {
    expect(
      findSanitizationIssues({ transcript: "gravacao" }).some(
        (issue) => issue.reason === "forbidden_key",
      ),
    ).toBe(true);
  });

  it("acusa caminho de midia e URL assinada", () => {
    const issues = findSanitizationIssues({
      storagePath: "elyra-private/u/s/cam.webm",
      signedUrl: "https://exemplo/abc",
    });

    expect(issues.filter((issue) => issue.reason === "forbidden_key")).toHaveLength(2);
  });

  it("acusa identificador de pessoa", () => {
    const issues = findSanitizationIssues({
      userId: "abc",
      email: "pessoa@example.invalid",
    });

    expect(issues.length).toBeGreaterThanOrEqual(2);
  });

  it("acusa saida anterior da IA e prompt bruto", () => {
    const issues = findSanitizationIssues({
      pedrocoreOutput: "resumo",
      rawPrompt: "instrucao",
    });

    expect(issues.filter((issue) => issue.reason === "forbidden_key")).toHaveLength(2);
  });

  it("acusa nota profissional", () => {
    expect(
      findSanitizationIssues({ professionalNote: "observacao" }).length,
    ).toBeGreaterThan(0);
  });

  it("acusa frase livre mesmo sob chave inocente", () => {
    const issues = findSanitizationIssues({ nota: "esta e uma frase inteira" });

    expect(issues.some((issue) => issue.reason === "free_text")).toBe(true);
  });

  it("aceita enum curto", () => {
    expect(findSanitizationIssues({ trend: "insufficient_data" })).toEqual([]);
  });

  it("percorre estruturas aninhadas", () => {
    const issues = findSanitizationIssues({ a: { b: [{ transcript: "x" }] } });

    expect(issues[0]?.path).toContain("transcript");
  });
});

// ---------------------------------------------------------------------------
// Canonicalizacao e fingerprint
// ---------------------------------------------------------------------------

describe("canonicalJson", () => {
  it("ordena chaves recursivamente", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it("nao insere espaco", () => {
    expect(canonicalJson({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
  });

  it("preserva null como ausencia", () => {
    expect(canonicalJson({ mean: null })).toBe('{"mean":null}');
  });
});

describe("learningFingerprint", () => {
  it("e estavel para o mesmo conteudo governado", () => {
    const payload = minimizeReport(report());

    expect(learningFingerprint(payload)).toBe(learningFingerprint(payload));
  });

  it("independe da ordem das chaves", () => {
    const payload = minimizeReport(report());
    const reordered = Object.fromEntries(
      Object.entries(payload).reverse(),
    ) as typeof payload;

    expect(learningFingerprint(reordered)).toBe(learningFingerprint(payload));
  });

  it("muda quando o conteudo muda semanticamente", () => {
    const first = learningFingerprint(minimizeReport(report()));
    const second = learningFingerprint(minimizeReport(report({ daysWithSleep: 20 })));

    expect(second).not.toBe(first);
  });

  it("e o sha256 do JSON canonico, nao do texto bruto", () => {
    const payload = minimizeReport(report());
    const expected = createHash("sha256")
      .update(canonicalJson(payload), "utf8")
      .digest("hex");

    expect(learningFingerprint(payload)).toBe(expected);
  });

  it("nao inclui correlacao nem instante", () => {
    const payload = minimizeReport(report());
    const canonical = canonicalJson(payload);

    expect(canonical).not.toContain("correlation");
    expect(canonical).not.toContain("At\":");
  });
});

// ---------------------------------------------------------------------------
// Quality Gate
// ---------------------------------------------------------------------------

describe("runLearningQualityGate", () => {
  it("aprova um payload completo e nomeia todos os gates", () => {
    const result = runLearningQualityGate(minimizeReport(report()));

    expect(result.passed).toBe(true);
    expect(result.checks.map((check) => check.name)).toEqual([...QUALITY_CHECKS]);
    expect(result.failed).toEqual([]);
  });

  it("reprova por dados insuficientes", () => {
    const payload = minimizeReport(
      report({
        daysWithMood: 3,
        daysWithAnxiety: 3,
        daysWithEnergy: 3,
        daysWithSleep: 3,
      }),
    );
    const result = runLearningQualityGate(payload);

    expect(result.passed).toBe(false);
    expect(result.failed).toContain("minimum_days_with_data");
  });

  it("reprova por janela incompleta", () => {
    const payload = minimizeReport(
      report({
        daysWithMood: 14,
        daysWithAnxiety: 0,
        daysWithEnergy: 0,
        daysWithSleep: 0,
      }),
    );

    expect(runLearningQualityGate(payload).failed).toContain(
      "window_completeness",
    );
  });

  it("reprova texto livre injetado", () => {
    const payload = {
      ...minimizeReport(report()),
      nota: "uma frase inteira aqui",
    } as unknown as ReturnType<typeof minimizeReport>;

    expect(runLearningQualityGate(payload).failed).toContain("no_free_text");
  });

  it("reprova identificador injetado", () => {
    const payload = {
      ...minimizeReport(report()),
      userId: "abc",
    } as unknown as ReturnType<typeof minimizeReport>;

    expect(runLearningQualityGate(payload).failed).toContain(
      "no_direct_identifier",
    );
  });

  it("e deterministico", () => {
    const payload = minimizeReport(report());

    expect(runLearningQualityGate(payload)).toEqual(
      runLearningQualityGate(payload),
    );
  });

  it("respeita o limiar documentado de completude", () => {
    const half = Math.ceil(28 * MINIMUM_WINDOW_COMPLETENESS);
    const payload = minimizeReport(
      report({
        daysWithMood: half,
        daysWithAnxiety: half,
        daysWithEnergy: half,
        daysWithSleep: half,
      }),
    );

    expect(runLearningQualityGate(payload).failed).not.toContain(
      "window_completeness",
    );
  });
});

// ---------------------------------------------------------------------------
// Pipeline completo
// ---------------------------------------------------------------------------

describe("buildLearningSubmission", () => {
  it("monta uma submissao valida no contrato", () => {
    const outcome = buildLearningSubmission(submissionInput());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(() =>
      elyraLearningSubmissionSchema.parse(outcome.submission),
    ).not.toThrow();
  });

  it("o fingerprint declarado corresponde ao payload enviado", () => {
    const outcome = buildLearningSubmission(submissionInput());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.submission.fingerprint).toBe(
      learningFingerprint(outcome.submission.payload),
    );
  });

  it("recusa sem consentimento de treino", () => {
    const outcome = buildLearningSubmission(
      submissionInput({ trainingConsentActive: false }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejectionCode).toBe("training_consent_missing");
  });

  it("recusa dados insuficientes", () => {
    const outcome = buildLearningSubmission(
      submissionInput({
        report: report({
          daysWithMood: 1,
          daysWithAnxiety: 1,
          daysWithEnergy: 1,
          daysWithSleep: 1,
        }),
      }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejectionCode).toBe("insufficient_data");
  });

  it("recusa consentimento concedido depois do dado exportado", () => {
    const outcome = buildLearningSubmission(
      submissionInput({ trainingConsentGrantedAt: "2026-09-01T12:00:00.000Z" }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.rejectionCode).toBe("provenance_invalid");
  });

  it("a submissao nunca carrega conteudo bruto nem identificador", () => {
    const outcome = buildLearningSubmission(submissionInput());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const serialized = JSON.stringify(outcome.submission);

    for (const forbidden of [
      "journal",
      "transcript",
      "userId",
      "user_id",
      "email",
      "storagePath",
      "elyra-private",
      "signedUrl",
      "professionalNote",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("declara a proveniencia completa", () => {
    const outcome = buildLearningSubmission(submissionInput());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.submission.provenance).toEqual({
      sourceKind: "report_snapshot",
      sourceSchemaVersion: "report_snapshot/v1",
      analyticsVersion: "elyra-analytics/v1",
      exportSchemaVersion: "elyra-learning-export/v1",
      producedAt: PRODUCED_AT,
    });
  });

  it("declara os cinco gates de qualidade aprovados", () => {
    const outcome = buildLearningSubmission(submissionInput());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.submission.quality.checks).toHaveLength(QUALITY_CHECKS.length);
    expect(
      outcome.submission.quality.checks.every((check) => check.passed),
    ).toBe(true);
  });

  it("o mesmo snapshot produz o mesmo fingerprint em execucoes distintas", () => {
    const first = buildLearningSubmission(submissionInput());
    const second = buildLearningSubmission(submissionInput());

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.fingerprint).toBe(first.fingerprint);
  });
});

// ---------------------------------------------------------------------------
// Acordo de fingerprint entre Elyra e PedroCore
// ---------------------------------------------------------------------------

/**
 * Vetor compartilhado com `test_elyra_learning_contract.py`.
 *
 * As duas pontas precisam chegar ao mesmo digest a partir do mesmo conteudo.
 * Repare nas medias de valor INTEIRO: `JSON.stringify(7)` produz `7`, enquanto
 * um float Python produziria `7.0`. Se este vetor divergir, toda submissao com
 * media inteira passa a ser recusada por `FINGERPRINT_MISMATCH`.
 */
const SHARED_VECTOR = {
  daysInWindow: 28,
  mood: { mean: 7, delta: 1, trend: "up", samples: 28 },
  anxiety: { mean: 3, delta: -1, trend: "down", samples: 28 },
  energy: { mean: 6.5, delta: 0, trend: "stable", samples: 28 },
  sleepDurationMinutes: { mean: 450, delta: 20, trend: "up", samples: 27 },
  daysWithMood: 28,
  daysWithAnxiety: 28,
  daysWithEnergy: 28,
  daysWithSleep: 27,
  cycleEnabled: false,
} as const;

const SHARED_VECTOR_DIGEST =
  "df6620d4930b82f6173b59df083f2e581ba82b0ecde90992768f817a04dbfa06";

describe("acordo de fingerprint entre linguagens", () => {
  it("o vetor compartilhado produz o digest acordado", () => {
    const digest = createHash("sha256")
      .update(canonicalJson(SHARED_VECTOR), "utf8")
      .digest("hex");

    expect(digest).toBe(SHARED_VECTOR_DIGEST);
  });

  it("o vetor compartilhado e um payload valido no contrato", () => {
    expect(() => sanitizedLearningPayloadSchema.parse(SHARED_VECTOR)).not.toThrow();
  });

  it("media inteira nao vira decimal na serializacao canonica", () => {
    expect(canonicalJson({ mean: 7 })).toBe('{"mean":7}');
    expect(canonicalJson({ mean: 7.5 })).toBe('{"mean":7.5}');
  });
});
