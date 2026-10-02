import { z } from "zod";

/**
 * Feedback de produto e correcao humana da transcricao.
 *
 * ## As tres coisas que este contrato mantem separadas
 *
 * 1. **Avaliar a transcricao** e dizer que o reconhecedor errou.
 * 2. **Avaliar a interpretacao** e dizer que o Veltrix leu mal os sinais.
 * 3. **Corrigir a transcricao** e dizer o que a pessoa realmente falou.
 *
 * Um polegar para baixo na transcricao **nao** e um polegar para baixo no
 * Veltrix. Sao dois sistemas com dois modos de errar, e fundi-los produziria uma
 * metrica que nao serve para consertar nenhum dos dois: uma queda na media nao
 * diria se o problema foi o reconhecedor ou a leitura dos sinais.
 *
 * ## O que nenhum dos tres e
 *
 * **`FEEDBACK != TRAINING`.** **`CORRECTION != TRAINING`.**
 *
 * Nada aqui inicia treinamento, e a elegibilidade nasce `false` no banco com um
 * trigger que recusa liga-la por update direto. Quem corrige um nome proprio
 * esta consertando o proprio registro, e nao doando a propria voz — tratar a
 * correcao como doacao converteria um gesto de reparo em consentimento que
 * ninguem deu.
 *
 * **`ASR_ORIGINAL != USER_CORRECTION`.** A correcao e entidade separada, nunca
 * um `update` no texto original. Sobrescrever faria o sistema afirmar que o ASR
 * produziu algo que ele nao produziu, apagaria a evidencia do erro e tornaria
 * impossivel medir qualidade depois.
 */

export const FEEDBACK_TARGETS = ["transcription", "interpretation"] as const;
export type FeedbackTarget = (typeof FEEDBACK_TARGETS)[number];

export const FEEDBACK_RATINGS = ["positive", "negative"] as const;
export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

/**
 * Por que a transcricao foi recusada.
 *
 * Cada valor descreve **o erro da maquina**, e nunca quem falou. Nao existe
 * "fala impossivel de entender" nesta lista, e a ausencia e proposital: a culpa
 * de uma transcricao ruim e do reconhecedor.
 */
export const TRANSCRIPTION_FEEDBACK_REASONS = [
  "incorrect_text",
  "missing_word",
  "added_word",
  "incorrect_number_or_name",
  "other",
] as const;
export type TranscriptionFeedbackReason =
  (typeof TRANSCRIPTION_FEEDBACK_REASONS)[number];

export const TRANSCRIPTION_FEEDBACK_REASON_LABEL: Record<
  TranscriptionFeedbackReason,
  string
> = {
  incorrect_text: "O texto não corresponde ao que foi dito",
  missing_word: "Faltou uma palavra",
  added_word: "Apareceu uma palavra que não foi dita",
  incorrect_number_or_name: "Número ou nome incorreto",
  other: "Outro problema",
};

export const feedbackSubmissionSchema = z
  .object({
    sessionId: z.string().uuid(),
    targetType: z.enum(FEEDBACK_TARGETS),
    /** A linha avaliada. `null` quando ela ja nao existe (retencao). */
    targetId: z.string().uuid().nullable().default(null),
    rating: z.enum(FEEDBACK_RATINGS),
    reason: z.enum(TRANSCRIPTION_FEEDBACK_REASONS).nullable().default(null),
  })
  .strict()
  .superRefine((submission, ctx) => {
    // Um "gostei, porque faltou uma palavra" e contraditorio, e aceita-lo
    // produziria dado que ninguem sabe ler depois.
    if (submission.rating === "positive" && submission.reason !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Avaliacao positiva nao carrega motivo de erro.",
      });
    }
    // O vocabulario fala de palavra, numero e nome: sao categorias do
    // reconhecedor, e nao descrevem uma leitura de sinais.
    if (
      submission.reason !== null &&
      submission.targetType !== "transcription"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Motivo de transcricao nao descreve interpretacao.",
      });
    }
  });

export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;

export const feedbackViewSchema = z
  .object({
    targetType: z.enum(FEEDBACK_TARGETS),
    rating: z.enum(FEEDBACK_RATINGS),
    reason: z.enum(TRANSCRIPTION_FEEDBACK_REASONS).nullable(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type FeedbackView = z.infer<typeof feedbackViewSchema>;

/**
 * A correcao que a pessoa escreveu.
 *
 * Ela nao carrega o texto original: quem o conhece e o servidor, que o copia da
 * transcricao persistida. Aceitar o "original" do cliente permitiria que a
 * pagina declarasse o que o ASR teria dito — e a comparacao entre os dois e
 * justamente a evidencia que esta tabela existe para guardar.
 */
export const transcriptCorrectionSubmissionSchema = z
  .object({
    sessionId: z.string().uuid(),
    correctedText: z.string().trim().min(1).max(20_000),
  })
  .strict();

export type TranscriptCorrectionSubmission = z.infer<
  typeof transcriptCorrectionSubmissionSchema
>;

export const transcriptCorrectionViewSchema = z
  .object({
    revision: z.number().int().min(1),
    correctedText: z.string().min(1).max(20_000),
    /** O que o ASR produziu. Preservado, e nunca substituido. */
    originalText: z.string().min(1).max(20_000),
    createdAt: z.string().datetime({ offset: true }),
    revokedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type TranscriptCorrectionView = z.infer<
  typeof transcriptCorrectionViewSchema
>;

export const FEEDBACK_ACTION_MESSAGE = {
  saved: "Obrigado. Sua avaliação foi registrada.",
  removed: "Avaliação removida.",
  corrected: "Correção salva. O texto original foi preservado.",
  correctionRemoved: "Correção removida. O texto original continua registrado.",
  unchanged: "O texto não mudou, então não há o que corrigir.",
  denied: "Não foi possível registrar. Verifique se a sessão é sua.",
  invalid: "Não foi possível registrar com os dados enviados.",
  /*
    O alvo nao pertence a esta sessao. A mensagem nao diz de quem ele e nem se
    existe: confirmar isso descreveria dado de outra pessoa para quem nao pode
    ve-lo.
  */
  invalidTarget: "Não foi possível registrar: o item avaliado não é desta sessão.",
} as const;

/**
 * O aviso que acompanha a correcao na tela.
 *
 * Ele existe porque a expectativa natural de quem corrige um texto e que "o
 * sistema vai aprender". Nao vai — e deixar essa expectativa de pe seria obter
 * um consentimento de treinamento por silencio.
 */
export const CORRECTION_NOT_TRAINING_NOTICE =
  "Sua correção fica registrada nesta sessão e não é usada para treinar nenhum modelo." as const;

/**
 * Estado das acoes de feedback.
 *
 * Vive aqui, e nao no arquivo de acoes: um modulo `"use server"` so pode
 * exportar funcoes assincronas, e um valor constante exportado de la quebra a
 * build. O contrato e o lugar natural dele de qualquer forma.
 */
export interface FeedbackActionState {
  message: string | null;
  ok: boolean;
}

export const INITIAL_FEEDBACK_STATE: FeedbackActionState = {
  message: null,
  ok: false,
};
