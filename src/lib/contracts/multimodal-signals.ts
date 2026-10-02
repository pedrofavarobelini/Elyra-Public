import { z } from "zod";

import {
  captureCoverageSchema,
  isVisualModality,
  type CaptureCoverage,
  type VisualModality,
} from "@/lib/contracts/capture-coverage";
import {
  veltrixModelIdSchema,
  veltrixProviderIdSchema,
} from "@/lib/contracts/pedrocore";

/**
 * Contrato `elyra-multimodal/v1` — sinais observaveis de sessao.
 *
 * Espelha o contrato Pydantic da capability multimodal do PedroCore. As duas
 * pontas precisam recusar exatamente as mesmas coisas: se a Elyra aceitasse um
 * sinal que o PedroCore recusa, o erro apareceria tarde, na fronteira, em vez
 * de aparecer cedo, no dominio.
 *
 * Regra inviolavel: **sinal observavel nao e emocao.** O vocabulario e fechado
 * e a comparacao e sempre com a media pessoal do proprio usuario — nunca com
 * norma populacional e nunca entre pessoas. Ver ADR-0005 e
 * docs/01-Product/Non-Clinical-Language.md.
 */

export const ELYRA_MULTIMODAL_CONTRACT_VERSION = "elyra-multimodal/v2" as const;
export const ELYRA_MULTIMODAL_INPUT_VERSION =
  "elyra-multimodal-input/v2" as const;
export const ELYRA_MULTIMODAL_OUTPUT_VERSION =
  "elyra-multimodal-output/v2" as const;
export const ELYRA_MULTIMODAL_OPERATION =
  "interpret_observable_session_signals" as const;
export const ELYRA_MULTIMODAL_TASK =
  "multimodal_session_signal_interpretation" as const;
export const ELYRA_MULTIMODAL_MESSAGE =
  "interpretar_sinais_observaveis_de_sessao" as const;

export const SIGNALS_SCHEMA_VERSION = "multimodal_signals/v2" as const;
export const FEATURE_EXTRACTOR_VERSION = "elyra-signals/v3" as const;

/**
 * Versao do extrator **visual**, gravada linha a linha.
 *
 * Propria, e nao herdada de `elyra-signals`: a aritmetica dos sinais visuais nao
 * tem nada em comum com a dos sinais de audio, e as duas vao evoluir em ritmos
 * diferentes. Uma versao unica obrigaria a marcar toda serie de audio como nova
 * a cada ajuste de limiar de movimento - e a mentir sobre qual conta produziu
 * qual numero.
 *
 * `elyra-signals/v3` acima e a versao do **conjunto**: ele mudou porque ganhou
 * sinais. Cada linha persistida carrega a versao do extrator que a produziu.
 */
export const VISUAL_EXTRACTOR_VERSION = "elyra-visual/v1" as const;

export const ELYRA_MULTIMODAL_DISCLAIMER =
  "Conteúdo informativo e não clínico. Sinais observáveis descrevem como a sessão foi registrada, não determinam emoção, não constituem diagnóstico ou prescrição e devem ser interpretados pela pessoa usuária." as const;

/** Vocabulario fechado. Nenhum nome descreve emocao, humor ou diagnostico. */
export const OBSERVABLE_SIGNALS = [
  "speech_rate",
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
] as const;

export type ObservableSignalName = (typeof OBSERVABLE_SIGNALS)[number];

export const SIGNAL_UNIT: Record<ObservableSignalName, SignalUnit> = {
  speech_rate: "words_per_minute",
  pause_count: "count",
  pause_total_duration: "milliseconds",
  pause_mean_duration: "milliseconds",
  vocal_variation: "index",
  movement_frequency: "index",
  head_movement_frequency: "index",
  head_motion_amplitude: "index",
  body_movement_frequency: "index",
  body_motion_amplitude: "index",
  hand_movement_frequency: "index",
};

/** Teto por sinal. Valor acima disso e dado corrompido, nao leitura extrema. */
export const SIGNAL_MAXIMUM: Record<ObservableSignalName, number> = {
  speech_rate: 400,
  pause_count: 1000,
  pause_total_duration: 3_600_000,
  pause_mean_duration: 600_000,
  vocal_variation: 1,
  movement_frequency: 1,
  head_movement_frequency: 1,
  head_motion_amplitude: 1,
  body_movement_frequency: 1,
  body_motion_amplitude: 1,
  hand_movement_frequency: 1,
};

/** Sinais que so existem quando houve captura de microfone. */
export const AUDIO_SIGNALS = new Set<ObservableSignalName>([
  "speech_rate",
  "pause_count",
  "pause_total_duration",
  "pause_mean_duration",
  "vocal_variation",
]);

/**
 * Sinais que so existem quando houve camera **e** consentimento de analise
 * visual.
 *
 * Os dois, e nao um: camera ligada sem analise visual continua produzindo
 * `movement_frequency`, que nao depende de landmark nenhum.
 */
export const VISUAL_SIGNALS = new Set<ObservableSignalName>([
  "head_movement_frequency",
  "head_motion_amplitude",
  "body_movement_frequency",
  "body_motion_amplitude",
  "hand_movement_frequency",
]);

/** A modalidade visual de onde cada sinal visual vem. */
export const VISUAL_SIGNAL_MODALITY: Record<string, VisualModality> = {
  head_movement_frequency: "visual_face",
  head_motion_amplitude: "visual_face",
  body_movement_frequency: "visual_body",
  body_motion_amplitude: "visual_body",
  hand_movement_frequency: "visual_hands",
};

/** Rotulo em portugues para exibicao. Descreve a medida, nunca um estado. */
export const SIGNAL_LABEL: Record<ObservableSignalName, string> = {
  speech_rate: "Ritmo de fala",
  pause_count: "Quantidade de pausas",
  pause_total_duration: "Tempo total em pausa",
  pause_mean_duration: "Duração média das pausas",
  vocal_variation: "Variação vocal",
  movement_frequency: "Frequência de movimento",
  head_movement_frequency: "Frequência de movimento da cabeça",
  head_motion_amplitude: "Amplitude de movimento da cabeça",
  body_movement_frequency: "Frequência de movimento do corpo",
  body_motion_amplitude: "Amplitude de movimento do corpo",
  hand_movement_frequency: "Frequência de movimento das mãos",
};

const SIGNAL_UNITS = [
  "words_per_minute",
  "count",
  "milliseconds",
  "index",
] as const;
export type SignalUnit = (typeof SIGNAL_UNITS)[number];

export const SIGNAL_STATUSES = [
  "available",
  "insufficient_baseline",
  "not_captured",
] as const;
export type SignalStatus = (typeof SIGNAL_STATUSES)[number];

export const observableSignalSchema = z
  .object({
    name: z.enum(OBSERVABLE_SIGNALS),
    value: z.number().min(0).nullable(),
    unit: z.enum(SIGNAL_UNITS),
    personalBaselineMean: z.number().min(0).nullable(),
    personalBaselineSamples: z.number().int().min(0).max(90),
    deltaVsPersonalBaseline: z.number().nullable(),
    status: z.enum(SIGNAL_STATUSES),

    coverage: captureCoverageSchema.nullable(),
  })
  .strict()
  .superRefine((signal, ctx) => {
    if (signal.unit !== SIGNAL_UNIT[signal.name]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Unidade incompativel com o sinal declarado.",
      });
    }

    const maximum = SIGNAL_MAXIMUM[signal.name];
    if (signal.value !== null && signal.value > maximum) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Valor do sinal fora do dominio permitido.",
      });
    }
    if (
      signal.personalBaselineMean !== null &&
      signal.personalBaselineMean > maximum
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Baseline pessoal fora do dominio permitido.",
      });
    }
    if (
      signal.deltaVsPersonalBaseline !== null &&
      Math.abs(signal.deltaVsPersonalBaseline) > maximum
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Delta vs baseline fora do dominio permitido.",
      });
    }

    // Ausencia de captura nao e zero.
    if (signal.status === "not_captured") {
      if (signal.value !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sinal nao capturado nao pode transportar valor.",
        });
      }
    } else if (signal.value === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sinal capturado precisa de valor.",
      });
    }

    // Sem baseline nao existe comparacao, e portanto nao existe delta.
    if (signal.status === "available") {
      if (
        signal.personalBaselineMean === null ||
        signal.personalBaselineSamples < 1
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sinal disponivel exige baseline pessoal real.",
        });
      }
    } else if (signal.deltaVsPersonalBaseline !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Delta exige baseline pessoal disponivel.",
      });
    }
  });

export type ObservableSignalContract = z.infer<typeof observableSignalSchema>;

export const transcriptDigestSchema = z
  .object({
    language: z.literal("pt-BR"),
    text: z.string().min(1).max(20_000),
    wordCount: z.number().int().min(0).max(20_000),
    voicedDurationMs: z.number().int().min(0).max(3_600_000),
    truncated: z.boolean(),
  })
  .strict();

export type TranscriptDigest = z.infer<typeof transcriptDigestSchema>;

/**
 * O que a pessoa relatou sobre a propria sessao.
 *
 * `SELF_REPORTED`, e nunca `AI_INFERRED_EMOTION`. A distincao nao e vocabulario:
 * ela e o que permite dizer *"nas sessoes em que voce relatou ansiedade
 * elevada..."* sem nunca poder dizer *"fala rapida = ansiedade"*.
 *
 * `ADR-0008` fixou o que este contrato nao redecide: escala 0-10 (a mesma de
 * `/meu-humor`), coleta opcional, e **ausencia e `null`, nunca `0` e nunca
 * "neutro"**.
 */
export const sessionSelfReportSchema = z
  .object({
    mood: z.number().int().min(0).max(10).nullable(),
    /** Autorrelatada. O sistema nao mede ansiedade - ele registra o relato. */
    perceivedAnxiety: z.number().int().min(0).max(10).nullable(),
    energy: z.number().int().min(0).max(10).nullable(),
  })
  .strict()
  .superRefine((report, ctx) => {
    if (
      report.mood === null &&
      report.perceivedAnxiety === null &&
      report.energy === null
    ) {
      // Autorrelato vazio nao e autorrelato: ausencia e ausencia de relato, e
      // nao um relato de nada.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Autorrelato sem nenhum valor.",
      });
    }
  });

export type SessionSelfReport = z.infer<typeof sessionSelfReportSchema>;

export const CAPTURE_RESOURCES_CONTRACT = [
  "screen",
  "camera",
  "microphone",
] as const;

export const multimodalSessionSignalsSchema = z
  .object({
    signalsSchemaVersion: z.literal(SIGNALS_SCHEMA_VERSION),
    featureExtractorVersion: z.literal(FEATURE_EXTRACTOR_VERSION),
    sessionKind: z.enum(["guided", "free", "deep_checkin"]),
    capturedResources: z.array(z.enum(CAPTURE_RESOURCES_CONTRACT)).min(1).max(3),
    durationMs: z.number().int().min(0).max(3_600_000),
    /**
     * Cobertura de **todas** as modalidades, inclusive as nao autorizadas.
     *
     * Ausencia de entrada nao distingue "nao foi pedida" de "foi pedida e
     * falhou", e o Veltrix precisa dessa diferenca para nao afirmar sobre o que
     * nunca foi observado.
     */
    /**
     * Ate seis linhas: as tres modalidades de captura mais as tres visuais.
     *
     * As visuais nao sao redundantes com `camera`. `camera = full` diz que a
     * camera esteve ligada a sessao inteira; `visual_face = partial` diz que
     * houve rosto observavel em parte dela. Sem a segunda, um sinal de cabeca
     * derivado de 8 minutos viajaria como se falasse dos 30.
     */
    modalityCoverage: z.array(captureCoverageSchema).min(1).max(6),
    /**
     * O que a pessoa relatou. `null` quando ela nao relatou nada - e isso
     * **nao** e o mesmo que relatar valores neutros.
     */
    selfReport: sessionSelfReportSchema.nullable(),
    /** Janelas derivadas, em offset relativo. Vazio = sessao sem serie. */
    windows: z
      .array(
        z
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
          .strict(),
      )
      /*
        Dez sinais janelaveis numa sessao de 60 minutos sao 600 janelas; o teto
        anterior, de 600, foi calculado para cinco. Mante-lo recusaria a sessao
        longa completa em vez de recusar dado corrompido, que e o que um teto
        existe para fazer.
      */
      .max(1200),
    transcript: transcriptDigestSchema.nullable(),
    signals: z.array(observableSignalSchema).min(1).max(11),
  })
  .strict()
  .superRefine((session, ctx) => {
    if (new Set(session.capturedResources).size !== session.capturedResources.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recurso de captura duplicado.",
      });
    }

    const names = session.signals.map((signal) => signal.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sinal observavel duplicado.",
      });
    }

    // Sinal calculado sem a captura correspondente seria dado fabricado.
    const hasMicrophone = session.capturedResources.includes("microphone");
    const hasCamera = session.capturedResources.includes("camera");
    for (const signal of session.signals) {
      if (signal.status === "not_captured") continue;
      if (AUDIO_SIGNALS.has(signal.name) && !hasMicrophone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sinal de audio sem captura de microfone.",
        });
      }
      if (signal.name === "movement_frequency" && !hasCamera) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sinal de movimento sem captura de camera.",
        });
      }
      if (VISUAL_SIGNALS.has(signal.name) && !hasCamera) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sinal visual sem captura de camera.",
        });
      }
    }


    const declaredModalities = new Set(
      session.modalityCoverage.map((coverage) => coverage.modality),
    );
    for (const signal of session.signals) {
      if (signal.status === "not_captured") continue;
      const modality = VISUAL_SIGNAL_MODALITY[signal.name];
      if (modality && !declaredModalities.has(modality)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sinal visual sem cobertura da modalidade que o produziu.",
        });
      }
    }

    if (session.transcript !== null) {
      if (!hasMicrophone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Transcricao sem captura de microfone.",
        });
      }
      if (session.transcript.voicedDurationMs > session.durationMs) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duracao falada excede a duracao da sessao.",
        });
      }
    }
  });

export type MultimodalSessionSignals = z.infer<
  typeof multimodalSessionSignalsSchema
>;

export const elyraMultimodalInputSchema = z
  .object({
    contractVersion: z.literal(ELYRA_MULTIMODAL_CONTRACT_VERSION),
    inputSchemaVersion: z.literal(ELYRA_MULTIMODAL_INPUT_VERSION),
    operation: z.literal(ELYRA_MULTIMODAL_OPERATION),
    aiInferenceConsent: z.literal(true),
    multimodalAnalysisConsent: z.literal(true),
    transcriptAnalysisConsent: z.boolean(),

    visualAnalysisConsent: z.boolean(),
    session: multimodalSessionSignalsSchema,
  })
  .strict()
  .superRefine((input, ctx) => {
    // Consentimento de IA nao substitui consentimento de transcricao.
    if (input.session.transcript !== null && !input.transcriptAnalysisConsent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Transcricao enviada sem consentimento de transcricao.",
      });
    }

    if (input.visualAnalysisConsent) return;

    /*
      Sem consentimento visual, nada derivado de landmark atravessa a fronteira:
      nem sinal, nem janela, nem a linha de cobertura que diria por quanto tempo
      o corpo da pessoa esteve observavel. A cobertura parece inofensiva e nao e:
      "rosto observavel por 22 dos 30 minutos" e uma observacao sobre o corpo de
      alguem que nao autorizou observacao do corpo.
    */
    for (const signal of input.session.signals) {
      if (VISUAL_SIGNALS.has(signal.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sinal visual enviado sem consentimento de analise visual.",
        });
        break;
      }
    }
    if (input.session.windows.some((window) => VISUAL_SIGNALS.has(window.signal))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Janela visual enviada sem consentimento de analise visual.",
      });
    }
    if (
      input.session.modalityCoverage.some((coverage) =>
        isVisualModality(coverage.modality),
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cobertura visual enviada sem consentimento de analise visual.",
      });
    }
  });

export type ElyraMultimodalInput = z.infer<typeof elyraMultimodalInputSchema>;


export const MULTIMODAL_EVIDENCE_PATHS = [
  "signals.speech_rate",
  "signals.pause_count",
  "signals.pause_total_duration",
  "signals.pause_mean_duration",
  "signals.vocal_variation",
  "signals.movement_frequency",
  "signals.head_movement_frequency",
  "signals.head_motion_amplitude",
  "signals.body_movement_frequency",
  "signals.body_motion_amplitude",
  "signals.hand_movement_frequency",
  "transcript",
  "captureQuality",
  "coverage",
  "timeline",
  "selfReport",
] as const;

/**
 * Confianca declarada da interpretacao.
 *
 * Ela **altera o que se afirma**, e nao acompanha uma frase categorica como
 * ressalva. `low` obriga a saida a recuar na afirmacao; e por isso o quality
 * gate cruza confianca com linguagem em vez de apenas registrar o rotulo.
 */
export const INTERPRETATION_CONFIDENCE = ["low", "moderate", "high"] as const;
export type InterpretationConfidence =
  (typeof INTERPRETATION_CONFIDENCE)[number];

export const multimodalObservationSchema = z
  .object({
    category: z.enum(["observable_signal", "transcript", "capture_quality"]),
    evidencePath: z.enum(MULTIMODAL_EVIDENCE_PATHS),
    text: z.string().min(1).max(320),
  })
  .strict();

export const elyraMultimodalOutputSchema = z
  .object({
    contractVersion: z.literal(ELYRA_MULTIMODAL_CONTRACT_VERSION),
    outputSchemaVersion: z.literal(ELYRA_MULTIMODAL_OUTPUT_VERSION),
    operation: z.literal(ELYRA_MULTIMODAL_OPERATION),
    correlationId: z.string().min(3).max(128),
    sourceSignalsSchemaVersion: z.literal(SIGNALS_SCHEMA_VERSION),
    sourceFeatureExtractorVersion: z.literal(FEATURE_EXTRACTOR_VERSION),
    language: z.literal("pt-BR"),
    summary: z.string().min(1).max(1000),
    confidence: z.enum(INTERPRETATION_CONFIDENCE),
    observations: z.array(multimodalObservationSchema).min(1).max(6),
    limitations: z.array(z.string().trim().min(1).max(320)).min(2).max(5),
    disclaimer: z.literal(ELYRA_MULTIMODAL_DISCLAIMER),
    safety: z
      .object({
        diagnosticClaim: z.literal(false),
        prescription: z.literal(false),
        causalClaim: z.literal(false),
        facialEmotionAsFact: z.literal(false),
        fictitiousEmotionPercentage: z.literal(false),
        emotionInferredFromSignal: z.literal(false),
        rawMediaAccessed: z.literal(false),
        populationNormComparison: z.literal(false),
        /** Autorrelato nunca e apresentado como correcao do sinal, nem o inverso. */
        selfReportContradictedBySignal: z.literal(false),
      })
      .strict(),
  })
  .strict();

export type ElyraMultimodalOutput = z.infer<typeof elyraMultimodalOutputSchema>;

const identifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/);

export const elyraMultimodalOrchestrateRequestSchema = z
  .object({
    message: z.literal(ELYRA_MULTIMODAL_MESSAGE),
    mode: z.literal("tecnico"),
    provider: z.enum(["mock", "auto"]),
    model: z.null(),
    task_type: z.literal(ELYRA_MULTIMODAL_TASK),
    origin_system: z.literal("elyra"),
    allow_real_provider: z.boolean(),
    allow_mock_fallback: z.boolean(),
    correlation_id: identifierSchema,
    idempotency_key: identifierSchema,
    context: elyraMultimodalInputSchema,
  })
  .strict()
  .superRefine((request, ctx) => {
    const mock =
      request.provider === "mock" && request.allow_real_provider === false;
    const real =
      request.provider === "auto" &&
      request.allow_real_provider === true &&
      request.allow_mock_fallback === false;
    if (!mock && !real) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provider policy multimodal Elyra negada.",
      });
    }
  });

export type ElyraMultimodalOrchestrateRequest = z.infer<
  typeof elyraMultimodalOrchestrateRequestSchema
>;

export const elyraMultimodalOrchestrateSuccessSchema = z
  .object({
    status: z.literal("ok"),
    answer: z.string(),
    task_type: z.literal(ELYRA_MULTIMODAL_TASK),
    origin_system: z.literal("elyra"),
    provider_requested: z.enum(["mock", "auto"]),
    provider_used: veltrixProviderIdSchema,
    model: veltrixModelIdSchema,
    mode: z.literal("tecnico"),
    fallback_used: z.literal(false),
    correlation_id: identifierSchema,
    idempotency_replayed: z.boolean(),
    elyra_multimodal: elyraMultimodalOutputSchema,
    project_id: z.literal("elyra"),
    task_allowed_for_project: z.literal(true),
  })
  .passthrough();

export type ElyraMultimodalOrchestrateSuccess = z.infer<
  typeof elyraMultimodalOrchestrateSuccessSchema
>;

/**
 * Monta a projecao minimizada enviada ao PedroCore.
 *
 * A funcao existe para que a minimizacao seja um passo NOMEADO e testavel, e
 * nao um efeito colateral de quem chama: nada alem do que esta declarado aqui
 * atravessa a fronteira. Sem `user_id`, sem `session_id`, sem caminho de
 * Storage, sem midia.
 */
export function buildMultimodalInput(input: {
  sessionKind: MultimodalSessionSignals["sessionKind"];
  capturedResources: MultimodalSessionSignals["capturedResources"];
  durationMs: number;
  modalityCoverage: CaptureCoverage[];
  selfReport: SessionSelfReport | null;
  windows: MultimodalSessionSignals["windows"];
  signals: ObservableSignalContract[];
  transcript: TranscriptDigest | null;
  transcriptAnalysisConsent: boolean;
  visualAnalysisConsent: boolean;
}): ElyraMultimodalInput {
  // Fail-closed: sem consentimento de transcricao o texto nem chega a ser montado.
  const transcript = input.transcriptAnalysisConsent ? input.transcript : null;

  /*
    Fail-closed tambem para o visual, e no mesmo lugar: sem consentimento, sinal,
    janela e cobertura visuais sao **removidos antes de montar o payload**, e nao
    filtrados depois nem escondidos na apresentacao.

    O schema recusaria de qualquer forma - `elyraMultimodalInputSchema` tem a
    regra. Filtrar aqui e o que faz a diferenca entre "o payload nunca teve" e
    "o payload teve e foi rejeitado na borda": a segunda forma constroi, ainda
    que por um instante, um objeto em memoria com observacoes corporais nao
    autorizadas.
  */
  const visual = input.visualAnalysisConsent;
  const signals = visual
    ? input.signals
    : input.signals.filter((signal) => !VISUAL_SIGNALS.has(signal.name));
  const windows = visual
    ? input.windows
    : input.windows.filter((window) => !VISUAL_SIGNALS.has(window.signal));
  const modalityCoverage = visual
    ? input.modalityCoverage
    : input.modalityCoverage.filter(
        (coverage) => !isVisualModality(coverage.modality),
      );

  return elyraMultimodalInputSchema.parse({
    contractVersion: ELYRA_MULTIMODAL_CONTRACT_VERSION,
    inputSchemaVersion: ELYRA_MULTIMODAL_INPUT_VERSION,
    operation: ELYRA_MULTIMODAL_OPERATION,
    aiInferenceConsent: true,
    multimodalAnalysisConsent: true,
    transcriptAnalysisConsent: input.transcriptAnalysisConsent,
    visualAnalysisConsent: visual,
    session: {
      signalsSchemaVersion: SIGNALS_SCHEMA_VERSION,
      featureExtractorVersion: FEATURE_EXTRACTOR_VERSION,
      sessionKind: input.sessionKind,
      capturedResources: input.capturedResources,
      durationMs: input.durationMs,
      modalityCoverage,
      selfReport: input.selfReport,
      windows,
      transcript,
      signals,
    },
  });
}
