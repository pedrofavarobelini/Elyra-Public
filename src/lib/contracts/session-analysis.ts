import { z } from "zod";

import { asrProvenanceSchema } from "@/lib/contracts/asr-provenance";

import {
  captureCoverageSchema,
  isVisualModality,
} from "@/lib/contracts/capture-coverage";

import {
  AUDIO_SIGNALS,
  CAPTURE_RESOURCES_CONTRACT,
  OBSERVABLE_SIGNALS,
  SIGNAL_MAXIMUM,
  elyraMultimodalOutputSchema,
  observableSignalSchema,
  sessionSelfReportSchema,
} from "@/lib/contracts/multimodal-signals";
import { veltrixProviderIdSchema } from "@/lib/contracts/pedrocore";



/**
 * Estado da transcricao no fio.
 *
 * `pending` e `deleted` existem no banco mas nao aqui: `pending` e estado
 * interno de escrita e `deleted` e resolvido antes de responder. O navegador
 * nunca submete "pendente" - ele submete o que conseguiu, ou declara que nao
 * conseguiu e por que.
 */
export const TRANSCRIPT_SUBMISSION_STATUSES = [
  "available",
  "unavailable",
  "failed",
] as const;

/**
 * Motivo pelo qual nao houve transcricao. Vocabulario fechado: um texto livre
 * aqui viraria, mais cedo ou mais tarde, uma explicacao inventada na tela.
 */
export const TRANSCRIPT_UNAVAILABLE_REASONS = [
  "speech_api_unsupported",
  "speech_api_denied",
  "no_speech_detected",
  "recognition_failed",
  "consent_missing",
  /**
   * O navegador **respondeu** que nao reconhece pt-BR localmente.
   *
   * Cobre `unavailable`, `downloadable` e `downloading`: nos tres a sonda
   * funcionou e a resposta foi negativa - o pacote de idioma nao esta pronto
   * neste aparelho, agora.
   *
   * Estado proprio, e nao `speech_api_unsupported`: a API **existe**, e o que
   * falta e a capacidade local. A alternativa seria deixar o navegador mandar o
   * audio para um servico de reconhecimento remoto, e essa e a unica coisa que
   * esta capability nao pode fazer em silencio.
   */
  "local_speech_unavailable",
  /**
   * Nao foi possivel **provar** que o reconhecimento seria local.
   *
   * Diferente de `local_speech_unavailable`, que e uma resposta negativa: aqui
   * nao houve resposta. O navegador nao expoe `SpeechRecognition.available`, a
   * sonda estourou, ninguem passou o resultado dela, ou a instancia nao tem
   * `processLocally`.
   *
   * A distincao nao muda a decisao - as duas recusam iniciar - e muda o que se
   * pode dizer. "Seu navegador nao tem o idioma instalado" e acionavel;
   * "nao consegui verificar" e honesto sobre uma incerteza.
   *
   * ```
   * UNPROVEN_LOCAL_PROCESSING = UNAVAILABLE
   * ```
   *
   * Ausencia de prova nao autoriza o caminho remoto. Preservar o comportamento
   * anterior aqui seria preservar exatamente o defeito.
   */
  "local_speech_unverifiable",
  /**
   * Houve voz medida pelo audio, e o reconhecedor nao devolveu texto.
   *
   * A distincao que a validacao fisica #1 exigiu. `no_speech_detected` afirma
   * que **nao houve fala** - uma afirmacao sobre a pessoa. Mas a Elyra tem uma
   * segunda fonte, independente do reconhecedor: a envoltoria RMS do audio. Numa
   * sessao em que ela mede voz por dois minutos e o reconhecedor volta vazio, o
   * reconhecedor falhou; a pessoa falou.
   *
   * Ausencia de transcricao nao e ausencia de voz.
   */
  "speech_detected_but_not_transcribed",
] as const;
export type TranscriptUnavailableReason =
  (typeof TRANSCRIPT_UNAVAILABLE_REASONS)[number];

const transcriptAvailableSchema = z
  .object({
    status: z.literal("available"),
    text: z.string().min(1).max(20_000),
    wordCount: z.number().int().min(1).max(20_000),
    voicedDurationMs: z.number().int().min(1).max(3_600_000),
    truncated: z.boolean(),

    provenance: asrProvenanceSchema.nullable().default(null),
  })
  .strict();

const transcriptAbsentSchema = z
  .object({
    status: z.enum(["unavailable", "failed"]),
    reason: z.enum(TRANSCRIPT_UNAVAILABLE_REASONS),
  })
  .strict();

export const transcriptSubmissionSchema = z.discriminatedUnion("status", [
  transcriptAvailableSchema,
  transcriptAbsentSchema,
]);
export type TranscriptSubmission = z.infer<typeof transcriptSubmissionSchema>;

/**
 * Medida crua de um sinal, como o navegador a produziu.
 *
 * Deliberadamente **nao** e `observableSignalSchema`: aquele carrega baseline e
 * delta, que sao autoridade do servidor. Aceitar o contrato completo do cliente
 * permitiria que a pagina declarasse a propria media pessoal.
 */
export const sessionMeasurementSchema = z
  .object({
    name: z.enum(OBSERVABLE_SIGNALS),
    value: z.number().min(0).nullable(),
  })
  .strict()
  .superRefine((measurement, ctx) => {
    if (
      measurement.value !== null &&
      measurement.value > SIGNAL_MAXIMUM[measurement.name]
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Valor do sinal fora do dominio permitido.",
      });
    }
  });
export type SessionMeasurement = z.infer<typeof sessionMeasurementSchema>;

/** Uma janela derivada de sinal. Nao carrega baseline: isso e do servidor. */
export const signalWindowSchema = z
  .object({
    signal: z.enum([
      "pause_count",
      "pause_total_duration",
      "pause_mean_duration",
      "vocal_variation",
      "movement_frequency",
      "head_movement_frequency",
      "head_motion_amplitude",
      "body_movement_frequency",
      "body_motion_amplitude",
      "hand_movement_frequency",
    ]),
    startOffsetMs: z.number().int().min(0).max(3_600_000),
    endOffsetMs: z.number().int().min(0).max(3_600_000),
    value: z.number().min(0),
  })
  .strict()
  .superRefine((window, ctx) => {
    if (window.endOffsetMs <= window.startOffsetMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Janela sem duracao positiva.",
      });
    }
  });
export type SignalWindowSubmission = z.infer<typeof signalWindowSchema>;

export const transcriptSegmentSchema = z
  .object({
    index: z.number().int().min(0),
    text: z.string().trim().min(1).max(2000),
    startOffsetMs: z.number().int().min(0).max(3_600_000),
    /** Instante de **reconhecimento**, nao de fala. Ver a migration da 22B. */
    recognizedAtOffsetMs: z.number().int().min(0).max(3_600_000),
  })
  .strict()
  .superRefine((segment, ctx) => {
    if (segment.recognizedAtOffsetMs < segment.startOffsetMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Segmento reconhecido antes de comecar.",
      });
    }
  });
export type TranscriptSegmentSubmission = z.infer<typeof transcriptSegmentSchema>;

/**
 * Submissao do processamento pos-sessao.
 *
 * As mesmas invariantes do contrato PedroCore sao verificadas aqui, na entrada:
 * sinal de audio sem microfone e sinal de movimento sem camera sao dado
 * fabricado, e sao recusados antes de tocar o banco.
 */
export const sessionAnalysisSubmissionSchema = z
  .object({
    durationMs: z.number().int().min(0).max(3_600_000),
    capturedResources: z
      .array(z.enum(CAPTURE_RESOURCES_CONTRACT))
      .min(1)
      .max(3),
    /**
     * A analise visual foi autorizada **para esta sessao**.
     *
     * Campo proprio, e nao inferido de `capturedResources.includes("camera")`:
     * a camera pode estar ligada sem analise visual nenhuma, e continuar
     * produzindo `movement_frequency`, que nao usa landmark. Inferir um do outro
     * transformaria ligar a camera em consentimento presumido para extrair
     * geometria corporal.
     */
    visualAnalysis: z.boolean().default(false),
    transcript: transcriptSubmissionSchema.nullable(),
    measurements: z.array(sessionMeasurementSchema).max(11),
    /**
     * Cobertura observada por modalidade, incluindo as que nao produziram nada.
     *
     * Quem sabe quanto tempo a camera esteve ligada e o navegador que capturou;
     * o servidor nao tem como reconstruir isso depois. Por isso a cobertura sobe
     * junto da medida - e, diferente da baseline, ela **e** autoridade do
     * cliente, porque descreve um evento que so ele presenciou.
     */
    coverage: z.array(captureCoverageSchema).max(6),
    /**
     * Janelas derivadas, em offset relativo ao inicio da sessao.
     *
     * Vazio e resposta legitima: sessao curta demais nao tem serie, e inventar
     * uma janela unica seria apresentar o agregado da sessao com outro nome.
     */
    windows: z.array(signalWindowSchema).max(1200).default([]),
    /**
     * Trechos reconhecidos com o instante de **reconhecimento**.
     *
     * Nunca instante de fala: a Web Speech API nao entrega o segundo. O nome do
     * campo carrega a distincao para que nenhum consumidor leia alinhamento por
     * palavra onde ha aproximacao por segmento.
     */
    transcriptSegments: z.array(transcriptSegmentSchema).max(500).default([]),
    /**
     * O que a pessoa relatou sobre a sessao (`ADR-0008`).
     *
     * `null` e o padrao e a resposta mais comum: a coleta e **opcional**, e uma
     * sessao nao pode ficar presa atras de formulario.
     */
    selfReport: sessionSelfReportSchema.nullable().default(null),
  })
  .strict()
  .superRefine((submission, ctx) => {
    const resources = submission.capturedResources;
    if (new Set(resources).size !== resources.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recurso de captura duplicado.",
      });
    }

    const names = submission.measurements.map((item) => item.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Medida de sinal duplicada.",
      });
    }

    const hasMicrophone = resources.includes("microphone");
    const hasCamera = resources.includes("camera");

    for (const measurement of submission.measurements) {
      if (measurement.value === null) continue;
      if (AUDIO_SIGNALS.has(measurement.name) && !hasMicrophone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sinal de audio sem captura de microfone.",
        });
      }
      if (measurement.name === "movement_frequency" && !hasCamera) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sinal de movimento sem captura de camera.",
        });
      }
    }

    if (submission.transcript !== null && !hasMicrophone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Transcricao sem captura de microfone.",
      });
    }
    if (
      submission.transcript?.status === "available" &&
      submission.transcript.voicedDurationMs > submission.durationMs
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duracao falada excede a duracao da sessao.",
      });
    }

    const modalities = submission.coverage.map((item) => item.modality);
    if (new Set(modalities).size !== modalities.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cobertura duplicada para a mesma modalidade.",
      });
    }

    for (const item of submission.coverage) {
      // A cobertura precisa falar da **mesma** sessao que a medida.
      if (item.sessionDurationMs !== submission.durationMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Cobertura declara duracao diferente da sessao.",
        });
      }

      /*
        Modalidade visual nao e recurso de captura: nao ha permissao de
        navegador para "rosto". O que a torna possivel e a camera **mais** o
        consentimento de analise visual, e e contra isso que ela e verificada.

        Perguntar `resources.includes(...)` para todas recusaria qualquer
        cobertura visual - inclusive a legitima.
      */
      // O guarda fica **inline** para o TypeScript estreitar `item.modality` no
      // ramo falso: extraido para uma variavel booleana, `resources.includes`
      // volta a receber a uniao larga e nao compila.
      const captured = isVisualModality(item.modality)
        ? submission.visualAnalysis && hasCamera
        : resources.includes(item.modality);

      if (item.outcome !== "absent" && !captured) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Cobertura de modalidade que nao foi capturada.",
        });
      }


      if (!isVisualModality(item.modality) && item.outcome === "absent" && captured) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Modalidade capturada nao pode ter cobertura ausente.",
        });
      }
    }

    const hasWindows = submission.windows.length > 0;
    if (hasWindows) {
      for (const window of submission.windows) {
        // Janela de sinal que a captura nao permitia e dado fabricado - a mesma
        // regra que ja vale para o agregado.
        const audio = window.signal !== "movement_frequency";
        if (audio && !hasMicrophone) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Janela de audio sem captura de microfone.",
          });
        }
        if (!audio && !hasCamera) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Janela de movimento sem captura de camera.",
          });
        }
        if (window.endOffsetMs > submission.durationMs) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Janela alem do fim da sessao.",
          });
        }
      }
    }

    for (const segment of submission.transcriptSegments) {
      if (!hasMicrophone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Segmento de transcricao sem captura de microfone.",
        });
      }
      if (segment.recognizedAtOffsetMs > submission.durationMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Segmento reconhecido depois do fim da sessao.",
        });
      }
    }

    // Segmento sem transcricao disponivel seria texto sem procedencia.
    if (
      submission.transcriptSegments.length > 0 &&
      submission.transcript?.status !== "available"
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Segmentos sem transcricao disponivel.",
      });
    }

    for (const resource of resources) {
      if (!modalities.includes(resource)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Recurso capturado sem cobertura declarada.",
        });
      }
    }
  });
export type SessionAnalysisSubmission = z.infer<
  typeof sessionAnalysisSubmissionSchema
>;

/**
 * Estados que a UI pode receber.
 *
 * `not_authorized` e um estado de primeira classe, nao um erro: uma sessao sem
 * consentimento de transcricao **nao falhou** ao transcrever - ela nunca foi
 * autorizada a tentar, e a tela precisa dizer exatamente isso.
 */
export const ANALYSIS_PART_STATES = [
  "not_authorized",
  "pending",
  "available",
  "unavailable",
  "failed",
] as const;
export type AnalysisPartState = (typeof ANALYSIS_PART_STATES)[number];

export const analysisTranscriptViewSchema = z
  .object({
    state: z.enum(ANALYSIS_PART_STATES),
    reason: z.enum(TRANSCRIPT_UNAVAILABLE_REASONS).nullable(),

    provenance: asrProvenanceSchema.nullable().default(null),
    text: z.string().nullable(),
    wordCount: z.number().int().min(0).nullable(),
    voicedDurationMs: z.number().int().min(0).nullable(),
    truncated: z.boolean(),
  })
  .strict()
  .superRefine((view, ctx) => {
    // Texto so existe quando a transcricao existe. Em qualquer outro estado a
    // ausencia e a resposta correta - preencher seria fabricar.
    if (view.state !== "available" && view.text !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Transcricao indisponivel nao pode transportar texto.",
      });
    }
  });

/**
 * Por que nao ha interpretacao.
 *
 * ## O que este vocabulario corrige
 *
 * Tudo caia em `pedrocore_unavailable`. Uma credencial ausente, um contrato
 * recusado, um provider fora do ar e uma sessao sem sinal util produziam o
 * mesmo diagnostico — e nenhum deles e "o servico esta indisponivel". Quem
 * fosse investigar tinha um unico nome para quatro causas com quatro correcoes
 * diferentes.
 *
 * A tela publica pode agrupar; ela nao precisa dizer "contrato recusado" a
 * ninguem. O que ela nao pode e **mentir** — dizer indisponibilidade quando a
 * causa foi falta de configuracao nossa.
 */
export const INTERPRETATION_UNAVAILABLE_REASONS = [
  /** A pessoa nao autorizou inferencia de IA nesta sessao. */
  "ai_not_authorized",
  /** Falta configuracao da nossa ponta: URL, credencial ou modo de provider. */
  "configuration_missing",
  /** O Veltrix nao respondeu, ou respondeu erro de transporte. */
  "service_unavailable",
  /** O Veltrix recusou o payload, ou devolveu saida fora do contrato. */
  "contract_rejected",
  /** O Veltrix esta de pe, e o provider de IA por tras dele nao. */
  "provider_unavailable",
  /** A resposta nao chegou dentro do orcamento de espera. */
  "provider_timeout",
  /** A saida chegou, e o portao de qualidade a reprovou. Nao vira ressalva. */
  "quality_gate_rejected",
  /** Nao havia sinal suficiente para interpretar. Ausencia, e nao falha. */
  "no_useful_signals",
  /** A interpretacao veio e nao pode ser gravada. */
  "persistence_failed",
] as const;
export type InterpretationUnavailableReason =
  (typeof INTERPRETATION_UNAVAILABLE_REASONS)[number];

export const analysisInterpretationViewSchema = z
  .object({
    state: z.enum(ANALYSIS_PART_STATES),
    /**
     * O diagnostico interno. `null` quando a interpretacao existe.
     *
     * Ele acompanha a linha ate a tela para que a mensagem publica seja
     * **derivada** de uma causa nomeada, em vez de ser um texto generico que
     * se aplica a tudo.
     */
    reason: z.enum(INTERPRETATION_UNAVAILABLE_REASONS).nullable().default(null),
    output: elyraMultimodalOutputSchema.nullable(),
    providerUsed: veltrixProviderIdSchema.nullable(),
    model: z.string().min(1).max(80).nullable(),
    createdAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((view, ctx) => {
    if (view.state === "available" && view.output === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Interpretacao disponivel exige saida persistida.",
      });
    }
    if (view.state === "available" && view.reason !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Interpretacao disponivel nao tem motivo de ausencia.",
      });
    }
    if (view.state !== "available" && view.output !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Interpretacao indisponivel nao pode transportar saida.",
      });
    }
  });

/**
 * Resultado real de uma sessao, montado **somente** a partir do que foi
 * persistido. Nao existe caminho neste contrato para um resultado sintetico.
 */
export const sessionAnalysisResultSchema = z
  .object({
    sessionId: z.string().uuid(),
    state: z.enum(["not_authorized", "pending", "available"]),
    transcript: analysisTranscriptViewSchema,
    signalsState: z.enum(ANALYSIS_PART_STATES),
    signals: z.array(observableSignalSchema).max(11),

    coverage: z.array(captureCoverageSchema).max(6),
    /**
     * Serie temporal da sessao. Vazia significa **sem serie** - sessao curta
     * demais, ou detalhe ja expirado pelos 7 dias. Nunca "sem variacao".
     */
    windows: z.array(signalWindowSchema).max(1200),
    /**
     * Trechos com o instante de **reconhecimento**. Vazio quando a transcricao
     * nao foi autorizada, nao houve fala, ou o detalhe expirou.
     */
    transcriptSegments: z.array(transcriptSegmentSchema).max(500),
    /** O que a pessoa relatou. `null` = nao relatou, e nunca "relatou neutro". */
    selfReport: sessionSelfReportSchema.nullable(),
    interpretation: analysisInterpretationViewSchema,
  })
  .strict();
export type SessionAnalysisResult = z.infer<typeof sessionAnalysisResultSchema>;

/** Rotulo do motivo. Descreve a condicao tecnica, nunca a pessoa. */
export const TRANSCRIPT_REASON_LABEL: Record<
  TranscriptUnavailableReason,
  string
> = {
  speech_api_unsupported:
    "Este navegador não oferece reconhecimento de fala. A sessão continua válida.",
  speech_api_denied:
    "O reconhecimento de fala não foi autorizado pelo navegador.",
  no_speech_detected: "Nenhuma fala foi reconhecida durante a sessão.",
  recognition_failed: "O reconhecimento de fala foi interrompido.",
  consent_missing: "A transcrição não foi autorizada para esta sessão.",
  local_speech_unavailable:
    "O reconhecimento de fala no próprio aparelho não está disponível para português neste navegador. A sessão continua válida e nenhum áudio foi enviado para fora.",
  local_speech_unverifiable:
    "Não foi possível confirmar que o reconhecimento de fala aconteceria no seu aparelho, então ele não foi iniciado. A sessão continua válida e nenhum áudio foi enviado para fora.",
  /*
    O texto diz o que aconteceu com o **reconhecedor**, e nao com a pessoa.
    "Nenhuma fala foi reconhecida" seria falso aqui: houve fala, e ela nao foi
    transcrita.
  */
  speech_detected_but_not_transcribed:
    "Houve fala durante a sessão, mas o reconhecimento não produziu texto. Os sinais de áudio continuam válidos.",
};

/**
 * O que a pessoa usuaria le.
 *
 * A tela agrupa o que nao lhe diz respeito — ela nao precisa da expressao
 * "contrato recusado", que descreve uma conversa entre dois sistemas. O que ela
 * nao pode e receber uma frase que atribua a causa ao lugar errado: uma
 * credencial que **nos** faltamos configurar nao pode aparecer como
 * instabilidade do servico, porque isso convidaria a pessoa a tentar de novo
 * mais tarde para sempre.
 *
 * Nenhuma frase culpa a pessoa, e nenhuma promete que "vai funcionar depois"
 * quando a correcao nao esta com ela.
 */
export const INTERPRETATION_REASON_LABEL: Record<
  InterpretationUnavailableReason,
  string
> = {
  ai_not_authorized:
    "A análise por IA não foi autorizada para esta sessão. Os sinais observados continuam registrados.",
  configuration_missing:
    "A análise por IA não está configurada nesta instalação. Não é uma falha da sua sessão.",
  service_unavailable:
    "O serviço de interpretação não respondeu. A sessão foi registrada e pode ser interpretada depois.",
  contract_rejected:
    "A interpretação não pôde ser concluída por uma incompatibilidade técnica. A sessão continua registrada.",
  provider_unavailable:
    "O serviço de interpretação está no ar, mas a IA por trás dele não respondeu.",
  provider_timeout:
    "A interpretação demorou mais do que o tempo previsto e foi encerrada. A sessão continua registrada.",
  quality_gate_rejected:
    "A interpretação gerada não passou na verificação de qualidade e não foi publicada.",
  no_useful_signals:
    "Não houve sinal suficiente nesta sessão para uma interpretação. Ausência de dado não é resultado zero.",
  persistence_failed:
    "A interpretação foi gerada e não pôde ser salva. A sessão continua registrada.",
};
