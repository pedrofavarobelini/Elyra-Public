import { describe, expect, it } from "vitest";

import {
  CORRECTION_NOT_TRAINING_NOTICE,
  FEEDBACK_TARGETS,
  TRANSCRIPTION_FEEDBACK_REASONS,
  TRANSCRIPTION_FEEDBACK_REASON_LABEL,
  feedbackSubmissionSchema,
  transcriptCorrectionSubmissionSchema,
  transcriptCorrectionViewSchema,
} from "./feedback";

const SESSION = "11111111-1111-4111-8111-111111111111";
const TARGET = "22222222-2222-4222-8222-222222222222";

describe("alvos separados", () => {
  it("transcricao e interpretacao sao alvos distintos", () => {
    /*
      Um polegar para baixo na transcricao nao e um polegar para baixo no
      Veltrix: sao dois sistemas com dois modos de errar. Fundi-los produziria
      uma metrica que nao serve para consertar nenhum dos dois.
    */
    expect(FEEDBACK_TARGETS).toEqual(["transcription", "interpretation"]);
  });

  it("aceita avaliar cada alvo por si", () => {
    for (const targetType of FEEDBACK_TARGETS) {
      expect(
        feedbackSubmissionSchema.safeParse({
          sessionId: SESSION,
          targetType,
          targetId: TARGET,
          rating: "positive",
          reason: null,
        }).success,
      ).toBe(true);
    }
  });

  it("nao existe alvo fora do vocabulario", () => {
    expect(
      feedbackSubmissionSchema.safeParse({
        sessionId: SESSION,
        targetType: "the_person",
        rating: "negative",
      }).success,
    ).toBe(false);
  });
});

describe("motivo", () => {
  it("nao acompanha avaliacao positiva", () => {
    // "Gostei, porque faltou uma palavra" e contraditorio.
    expect(
      feedbackSubmissionSchema.safeParse({
        sessionId: SESSION,
        targetType: "transcription",
        rating: "positive",
        reason: "missing_word",
      }).success,
    ).toBe(false);
  });

  it("motivo de transcricao nao descreve interpretacao", () => {
    expect(
      feedbackSubmissionSchema.safeParse({
        sessionId: SESSION,
        targetType: "interpretation",
        rating: "negative",
        reason: "missing_word",
      }).success,
    ).toBe(false);
  });

  it("todo motivo descreve o erro da maquina, nunca quem falou", () => {
    /*
      Nao existe "fala impossivel de entender" nesta lista, e a ausencia e
      proposital: a culpa de uma transcricao ruim e do reconhecedor.
    */
    for (const reason of TRANSCRIPTION_FEEDBACK_REASONS) {
      const label = TRANSCRIPTION_FEEDBACK_REASON_LABEL[reason];
      expect(label).not.toMatch(
        /você falou|voce falou|sua fala|sotaque|gaguej|inaudív|inaudiv|confus/iu,
      );
    }
  });

  it("motivo e opcional mesmo na recusa", () => {
    expect(
      feedbackSubmissionSchema.safeParse({
        sessionId: SESSION,
        targetType: "transcription",
        rating: "negative",
        reason: null,
      }).success,
    ).toBe(true);
  });
});

describe("correcao", () => {
  it("a submissao NAO carrega o texto original", () => {
    /*
      Quem conhece o original e o servidor, que o copia da transcricao
      persistida. Aceitar o "original" do cliente permitiria que a pagina
      declarasse o que o ASR teria dito - e a comparacao entre os dois e a
      evidencia que a tabela existe para guardar.
    */
    const parsed = transcriptCorrectionSubmissionSchema.safeParse({
      sessionId: SESSION,
      correctedText: "o que eu disse de fato",
      originalText: "o que a maquina entendeu",
    });
    expect(parsed.success).toBe(false);
  });

  it("aceita apenas sessao e texto corrigido", () => {
    expect(
      transcriptCorrectionSubmissionSchema.safeParse({
        sessionId: SESSION,
        correctedText: "o que eu disse de fato",
      }).success,
    ).toBe(true);
  });

  it("correcao vazia nao e correcao", () => {
    expect(
      transcriptCorrectionSubmissionSchema.safeParse({
        sessionId: SESSION,
        correctedText: "   ",
      }).success,
    ).toBe(false);
  });

  it("a visao preserva o original ao lado do corrigido", () => {
    // ASR_ORIGINAL != USER_CORRECTION: os dois viajam juntos, sempre.
    const view = transcriptCorrectionViewSchema.parse({
      revision: 1,
      correctedText: "eu nao consegui terminar hoje",
      originalText: "eu consegui terminar hoje",
      createdAt: "2026-09-09T12:00:00.000Z",
      revokedAt: null,
    });
    expect(view.originalText).not.toBe(view.correctedText);
  });

  it("a visao nao tem campo de elegibilidade para treinamento", () => {
    /*
      A tela nunca oferece "usar para treinar". FEEDBACK != TRAINING, e o campo
      nem chega ao cliente.
    */
    expect(
      transcriptCorrectionViewSchema.safeParse({
        revision: 1,
        correctedText: "a",
        originalText: "b",
        createdAt: "2026-09-09T12:00:00.000Z",
        revokedAt: null,
        trainingEligible: true,
      }).success,
    ).toBe(false);
  });
});

describe("o aviso de treinamento", () => {
  it("nega o treinamento em vez de prometer melhoria", () => {
    /*
      A expectativa natural de quem corrige um texto e que "o sistema vai
      aprender". Deixar essa expectativa de pe obteria consentimento de
      treinamento por silencio.
    */
    expect(CORRECTION_NOT_TRAINING_NOTICE).toMatch(/não é usada para treinar/iu);
    expect(CORRECTION_NOT_TRAINING_NOTICE).not.toMatch(
      /vamos melhorar|aprende|treinar o modelo com/iu,
    );
  });
});
