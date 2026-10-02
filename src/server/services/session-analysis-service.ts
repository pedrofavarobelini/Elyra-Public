import "server-only";

import {
  captureCoverageSchema,
  type CaptureCoverage,
  type ObservationModality,
} from "@/lib/contracts/capture-coverage";
import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

import { canonicalJson } from "@/lib/canonical-json";
import { evaluateInterpretationQuality } from "@/server/pedrocore/quality-gate";
import {
  AUDIO_SIGNALS,
  ELYRA_MULTIMODAL_CONTRACT_VERSION,
  SIGNALS_SCHEMA_VERSION,
  SIGNAL_UNIT,
  buildMultimodalInput,
  elyraMultimodalOutputSchema,
  type ObservableSignalContract,
  type ObservableSignalName,
  FEATURE_EXTRACTOR_VERSION,
  VISUAL_EXTRACTOR_VERSION,
  VISUAL_SIGNAL_MODALITY,
  type SessionSelfReport,
} from "@/lib/contracts/multimodal-signals";
import { veltrixProviderIdSchema } from "@/lib/contracts/pedrocore";
import {
  sessionAnalysisResultSchema,
  sessionAnalysisSubmissionSchema,
  type AnalysisPartState,
  type InterpretationUnavailableReason,
  type SessionAnalysisResult,
  type TranscriptUnavailableReason,
  type SignalWindowSubmission,
} from "@/lib/contracts/session-analysis";
import type { CaptureResource } from "@/lib/contracts/session";
import type { AsrProvenance } from "@/lib/contracts/asr-provenance";
import { buildObservableSignal, personalBaseline } from "@/lib/multimodal-signals";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  ElyraPedroCoreClient,
  PedroCoreBlockedError,
  PedroCoreConfigurationError,
  PedroCoreContractError,
  PedroCoreTimeoutError,
  PedroCoreUnavailableError,
  pedroCoreConfigFromEnvironment,
} from "@/server/pedrocore/client";
import { setAiInferenceConsent } from "@/server/repositories/ai-insights-repository";
import { appendAudit } from "@/server/repositories/identity-repository";
import {
  findMultimodalSession,
  insertProcessingJob,
  updateProcessingJob,
} from "@/server/repositories/multimodal-repository";
import {
  findInterpretationByFingerprint,
  findLatestInterpretation,
  findSessionCoverage,
  findSessionFeatures,
  findSessionTranscript,
  findSignalHistory,
  insertSessionInterpretation,
  upsertDerivedFeatures,
  upsertSessionCoverage,
  upsertSessionTranscript,
  type DerivedFeatureRow,
  type SessionCoverageRow,
  type SessionInterpretationRow,
  type SessionTranscriptRow,
  findSignalWindows,
  findTranscriptSegments,
  replaceSignalWindows,
  replaceTranscriptSegments,
  type SignalWindowRow,
  type TranscriptSegmentRow,
  findSessionSelfReport,
  upsertSessionSelfReport,
} from "@/server/repositories/session-analysis-repository";

type Client = SupabaseClient<Database>;
type SessionRow = Database["public"]["Tables"]["multimodal_sessions"]["Row"];



export type SessionAnalysisErrorCode =
  | "SESSION_NOT_FOUND"
  | "INVALID_STATE"
  | "PEDROCORE_UNAVAILABLE"
  | "PEDROCORE_INVALID_OUTPUT"
  | "ANALYSIS_PERSISTENCE_FAILURE";

export class SessionAnalysisServiceError extends Error {
  constructor(
    public readonly code: SessionAnalysisErrorCode,
    public readonly status: number,
  ) {
    super(code);
    this.name = "SessionAnalysisServiceError";
  }
}

export interface SessionAnalysisDependencies {
  createPedroCoreClient: () => ElyraPedroCoreClient;
}

const defaultDependencies: SessionAnalysisDependencies = {
  createPedroCoreClient: () =>
    new ElyraPedroCoreClient(pedroCoreConfigFromEnvironment()),
};

const uuidSchema = z.string().uuid();

/** Estados a partir dos quais a captura ja terminou e pode ser processada. */
const PROCESSABLE_STATUSES = new Set(["completed"]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Carrega a sessao do proprio dono.
 *
 * `SESSION_NOT_FOUND` cobre os tres casos — inexistente, apagada e de outra
 * pessoa — de proposito: distinguir "nao existe" de "existe mas nao e sua"
 * confirmaria a existencia da sessao de outra pessoa.
 */
async function loadOwnedSession(
  client: Client,
  user: User,
  sessionId: string,
): Promise<SessionRow> {
  const session = await findMultimodalSession(client, uuidSchema.parse(sessionId));
  if (!session || session.user_id !== user.id || session.status === "deleted") {
    throw new SessionAnalysisServiceError("SESSION_NOT_FOUND", 404);
  }
  return session;
}

function consentedResources(session: SessionRow): Set<CaptureResource> {
  const resources = new Set<CaptureResource>();
  if (session.screen_consent) resources.add("screen");
  if (session.camera_consent) resources.add("camera");
  if (session.microphone_consent) resources.add("microphone");
  return resources;
}

/** Transcricao exige as duas autorizacoes; uma nao substitui a outra. */
function transcriptionAuthorized(session: SessionRow): boolean {
  return session.transcription_consent && session.microphone_consent;
}


async function auditAnalysisFailure(
  client: Client,
  session: SessionRow,
  correlationUuid: string,
  action: string,
) {
  try {
    await appendAudit(client, {
      actorUserId: session.user_id,
      action,
      entityType: "multimodal_session",
      entityId: session.id,
      correlationId: correlationUuid,
      outcome: "failure",
    });
  } catch {
    // Audit que falha nao pode virar sucesso nem expor conteudo.
  }
}

// ---------------------------------------------------------------------------
// Leitura do estado persistido
// ---------------------------------------------------------------------------

function transcriptView(
  session: SessionRow,
  row: SessionTranscriptRow | null,
): SessionAnalysisResult["transcript"] {
  const empty = {
    text: null,
    wordCount: null,
    voicedDurationMs: null,
    truncated: false,
    provenance: null,
  };

  if (!transcriptionAuthorized(session)) {
    return { state: "not_authorized", reason: "consent_missing", ...empty };
  }
  if (!row) return { state: "pending", reason: null, ...empty };

  const reason = (row.unavailable_reason ??
    null) as TranscriptUnavailableReason | null;

  if (row.status === "available") {
    return {
      state: "available",
      reason: null,
      text: row.content,
      wordCount: row.word_count,
      voicedDurationMs: row.voiced_duration_ms,
      truncated: row.truncated,
      provenance: transcriptProvenanceFromRow(row),
    };
  }
  if (row.status === "failed") return { state: "failed", reason, ...empty };
  if (row.status === "pending") return { state: "pending", reason: null, ...empty };
  // `unavailable` e `deleted` convergem: nao ha texto, e dizer qual dos dois
  // seria detalhe interno sem consequencia para quem le a tela.
  return { state: "unavailable", reason, ...empty };
}

/**
 * Qual modalidade produziu cada sinal.
 *
 * O mapa e o mesmo que os dois contratos ja usam para recusar sinal fabricado -
 * audio exige microfone, movimento exige camera. Escrever de novo aqui criaria
 * uma segunda verdade sobre a mesma relacao.
 */
/**
 * De que modalidade um sinal fala.
 *
 * Para os visuais, a resposta **nao** e `camera`: e a modalidade visual que o
 * produziu. Associar `head_movement_frequency` a cobertura da camera faria o
 * sinal viajar com "camera ligada 30 de 30 minutos" quando o rosto apareceu em
 * 6 - formalmente valido, e exatamente a leitura enganosa que a cobertura
 * existe para impedir.
 */
function signalModality(name: ObservableSignalName): ObservationModality {
  const visual = VISUAL_SIGNAL_MODALITY[name];
  if (visual) return visual;
  return name === "movement_frequency" ? "camera" : "microphone";
}

/**
 * A versao do extrator que produziu **esta** linha.
 *
 * Por linha, e nao por sessao: audio e visual tem aritmeticas independentes e
 * vao evoluir em ritmos diferentes. Uma versao unica na sessao inteira obrigaria
 * a marcar toda serie de audio como nova a cada ajuste de limiar de movimento,
 * e a mentir sobre qual conta produziu qual numero.
 */
function extractorVersionFor(name: string): string {
  return VISUAL_SIGNAL_MODALITY[name] || isVisualModalityName(name)
    ? VISUAL_EXTRACTOR_VERSION
    : FEATURE_EXTRACTOR_VERSION;
}

function isVisualModalityName(name: string): boolean {
  return name === "visual_face" || name === "visual_body" || name === "visual_hands";
}

function coverageRowToContract(row: SessionCoverageRow): CaptureCoverage {
  return captureCoverageSchema.parse({
    modality: row.modality as ObservationModality,
    outcome: row.outcome as CaptureCoverage["outcome"],
    reason: row.reason as CaptureCoverage["reason"],
    coverageMs: row.coverage_ms,
    sessionDurationMs: row.session_duration_ms,
  });
}


function usableForBaseline(coverageOutcome: string | null | undefined): boolean {
  // `undefined` e `null` sao a mesma afirmacao - "cobertura nao registrada" -, e
  // distingui-los aqui seria distinguir dois jeitos de nao saber a mesma coisa.
  return coverageOutcome == null || coverageOutcome === "full";
}

function featureRowToSignal(
  row: DerivedFeatureRow,
  coverage: CaptureCoverage | null = null,
): ObservableSignalContract {
  return {
    name: row.signal_name as ObservableSignalName,
    value: row.value,
    unit: row.unit as ObservableSignalContract["unit"],
    personalBaselineMean: row.personal_baseline_mean,
    personalBaselineSamples: row.personal_baseline_samples,
    deltaVsPersonalBaseline: row.delta_vs_personal_baseline,
    status: row.status as ObservableSignalContract["status"],
    coverage,
  };
}

function interpretationView(
  session: SessionRow,
  row: SessionInterpretationRow | null,
  featureCount: number,
  failure: AnalysisPartState | null,
  reason: InterpretationUnavailableReason | null = null,
): SessionAnalysisResult["interpretation"] {
  const empty = {
    output: null,
    providerUsed: null,
    model: null,
    createdAt: null,
  };
  if (!session.ai_analysis_consent) {
    // Nao e falha: e a pessoa nao tendo autorizado. Dizer "indisponivel" aqui
    // atribuiria ao sistema uma escolha que foi dela.
    return { state: "not_authorized", reason: "ai_not_authorized", ...empty };
  }
  if (row) {
    const parsed = elyraMultimodalOutputSchema.safeParse(row.payload);
    // Uma saida persistida que nao valida mais nao vira texto na tela: ela vira
    // `failed`. Renderizar um payload que o contrato recusa seria confiar num
    // dado que a fronteira ja nao aceitaria.
    // provider_used e metadata do Veltrix (ADR-0034): o formato e verificado,
    // o nome nao e decidido aqui. Um valor fora do formato e saida fora do
    // contrato, e nao e exibido.
    const providerUsed = veltrixProviderIdSchema.safeParse(row.provider_used);
    if (!parsed.success || !providerUsed.success) {
      return { state: "failed", reason: "contract_rejected", ...empty };
    }
    return {
      state: "available",
      reason: null,
      output: parsed.data,
      providerUsed: providerUsed.data,
      model: row.model,
      createdAt: row.created_at,
    };
  }
  if (failure) {
    return { state: failure, reason: reason ?? "service_unavailable", ...empty };
  }
  if (featureCount === 0) return { state: "pending", reason: null, ...empty };
  // Sinais existem e nenhuma interpretacao foi produzida para eles.
  return { state: "unavailable", reason: "no_useful_signals", ...empty };
}

function buildResult(
  session: SessionRow,
  transcript: SessionTranscriptRow | null,
  features: DerivedFeatureRow[],
  interpretation: SessionInterpretationRow | null,
  coverageRows: SessionCoverageRow[] = [],
  windowRows: SignalWindowRow[] = [],
  segmentRows: TranscriptSegmentRow[] = [],
  /**
   * Ja na forma do contrato, e nao a linha do banco: os dois caminhos que montam
   * o resultado tem fontes diferentes - a leitura vem da tabela, o processamento
   * vem da propria submissao - e converter na borda evita um segundo mapeamento.
   */
  selfReport: SessionSelfReport | null = null,
  failure: AnalysisPartState | null = null,
  /** A causa nomeada, quando houve falha. Ver `InterpretationOutcome`. */
  interpretationReason: InterpretationUnavailableReason | null = null,
): SessionAnalysisResult {
  const coverageByModality = new Map(
    coverageRows.map((row) => [
      row.modality as ObservationModality,
      coverageRowToContract(row),
    ]),
  );
  const signalsState: AnalysisPartState = !session.ai_analysis_consent
    ? "not_authorized"
    : features.length === 0
      ? "pending"
      : "available";

  const authorized =
    transcriptionAuthorized(session) || session.ai_analysis_consent;
  const persisted =
    transcript !== null || features.length > 0 || interpretation !== null;

  return sessionAnalysisResultSchema.parse({
    sessionId: session.id,
    state: !authorized ? "not_authorized" : persisted ? "available" : "pending",
    transcript: transcriptView(session, transcript),
    signalsState,
    signals: features.map((row) =>
      featureRowToSignal(
        row,
        coverageByModality.get(signalModality(row.signal_name as ObservableSignalName)) ??
          null,
      ),
    ),
    coverage: coverageRows.map(coverageRowToContract),
    windows: windowRows.map((row) => ({
      signal: row.signal_name as SignalWindowSubmission["signal"],
      startOffsetMs: row.start_offset_ms,
      endOffsetMs: row.end_offset_ms,
      value: row.value,
    })),
    selfReport,
    transcriptSegments: segmentRows.map((row) => ({
      index: row.segment_index,
      text: row.content,
      startOffsetMs: row.start_offset_ms,
      recognizedAtOffsetMs: row.recognized_at_offset_ms,
    })),
    interpretation: interpretationView(
      session,
      interpretation,
      features.length,
      failure,
      interpretationReason,
    ),
  });
}

/**
 * Le o resultado real de uma sessao. **Somente** o que foi persistido.
 *
 * Nao ha ramo neste caminho que produza conteudo sintetico: uma sessao sem
 * processamento devolve `pending`, e uma sessao sem consentimento devolve
 * `not_authorized`. Nenhum dos dois inventa metrica.
 */
export async function getSessionAnalysis(
  client: Client,
  user: User,
  sessionId: string,
): Promise<SessionAnalysisResult> {
  const session = await loadOwnedSession(client, user, sessionId);
  const [
    transcript,
    features,
    interpretation,
    coverageRows,
    windowRows,
    segmentRows,
    selfReportRow,
  ] = await Promise.all([
    findSessionTranscript(client, session.id),
    findSessionFeatures(client, session.id),
    findLatestInterpretation(client, session.id),
    findSessionCoverage(client, session.id),
    findSignalWindows(client, session.id),
    findTranscriptSegments(client, session.id),
    findSessionSelfReport(client, session.id),
  ]);
  return buildResult(
    session,
    transcript,
    features,
    interpretation,
    coverageRows,
    windowRows,
    segmentRows,
    selfReportRow
      ? {
          mood: selfReportRow.mood,
          perceivedAnxiety: selfReportRow.perceived_anxiety,
          energy: selfReportRow.energy,
        }
      : null,
  );
}

// ---------------------------------------------------------------------------
// Processamento
// ---------------------------------------------------------------------------

async function persistTranscript(
  client: Client,
  session: SessionRow,
  submission: z.infer<typeof sessionAnalysisSubmissionSchema>,
): Promise<SessionTranscriptRow | null> {
  if (!transcriptionAuthorized(session) || submission.transcript === null) {
    return null;
  }

  const started = new Date().toISOString();
  const job = await insertProcessingJob(client, {
    session_id: session.id,
    user_id: session.user_id,
    job_kind: "transcript_ingest",
    status: "running",
    attempts: 1,
    started_at: started,
  });

  try {
    const transcript = submission.transcript;
    const row = await upsertSessionTranscript(client, {
      session_id: session.id,
      user_id: session.user_id,
      ...(transcript.status === "available"
        ? {
            status: "available" as const,
            content: transcript.text,
            word_count: transcript.wordCount,
            voiced_duration_ms: transcript.voicedDurationMs,
            truncated: transcript.truncated,
            unavailable_reason: null,

            ...transcriptProvenanceColumns(transcript.provenance),
          }
        : {
            status: transcript.status,
            content: null,
            word_count: null,
            voiced_duration_ms: null,
            truncated: false,
            unavailable_reason: transcript.reason,
          }),
    });
    await updateProcessingJob(client, job.id, {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      error_code: null,
    });
    return row;
  } catch (error) {
    await updateProcessingJob(client, job.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_code: "transcript_persistence_failed",
    });
    throw error;
  }
}

/**
 * Deriva e persiste os sinais.
 *
 * A baseline pessoal e montada **aqui**, a partir de `derived_features` das
 * sessoes anteriores da propria pessoa. O navegador manda o valor medido e nada
 * mais: se ele pudesse mandar a media, poderia declarar qualquer sessao como
 * "dentro do normal".
 */
/**
 * Grava a cobertura declarada pelo navegador.
 *
 * Diferente da baseline, esta e uma das poucas coisas em que o **cliente e
 * autoridade**: ele presenciou o evento (a track encerrou, a gravacao bateu no
 * teto) e o servidor nao tem como reconstruir isso depois. O que protege a
 * afirmacao e o contrato - `captureCoverageSchema` recusa cobertura maior que a
 * sessao, motivo incompativel com desfecho e ausencia com tempo.
 *
 * Idempotente por `(session_id, modality)`: reprocessar a mesma sessao nao
 * duplica linha.
 */
async function persistCoverage(
  client: Client,
  session: SessionRow,
  submission: z.infer<typeof sessionAnalysisSubmissionSchema>,
): Promise<SessionCoverageRow[]> {
  if (submission.coverage.length === 0) return [];
  return upsertSessionCoverage(
    client,
    submission.coverage.map((item) => ({
      session_id: session.id,
      user_id: session.user_id,
      modality: item.modality,
      outcome: item.outcome,
      reason: item.reason,
      coverage_ms: item.coverageMs,
      session_duration_ms: item.sessionDurationMs,
      extractor_version: extractorVersionFor(item.modality),
    })),
  );
}

/**
 * Grava o detalhe temporal da sessao.
 *
 * Depende dos mesmos consentimentos do agregado: janela e detalhe do sinal
 * (`ai_analysis_consent`), segmento e detalhe da transcricao
 * (`transcription_consent`). Sem o consentimento correspondente, o detalhe **nao
 * nasce** - e nao "nasce e fica escondido", que e diferente.
 *
 * Uma falha aqui **nao** derruba a analise: o detalhe e um acrescimo sobre o
 * agregado, e perder o acrescimo nao pode custar a base. Ela e registrada e a
 * sessao segue - a mesma regra que 22A estabeleceu para o upload de midia.
 */
async function persistTemporalDetail(
  client: Client,
  session: SessionRow,
  submission: z.infer<typeof sessionAnalysisSubmissionSchema>,
): Promise<{ windowRows: SignalWindowRow[]; segmentRows: TranscriptSegmentRow[] }> {
  let windowRows: SignalWindowRow[] = [];
  let segmentRows: TranscriptSegmentRow[] = [];
  try {
    /*
      Autorrelato **nao** depende de consentimento de IA nem de captura: e o que
      a pessoa disse sobre a propria sessao, e ela sempre pode dizer. Amarra-lo a
      um consentimento de analise transformaria a fala dela em insumo de modelo,
      que e exatamente o contrario do que `ADR-0008` decidiu.
    */
    if (submission.selfReport) {
      await upsertSessionSelfReport(client, {
        session_id: session.id,
        user_id: session.user_id,
        mood: submission.selfReport.mood,
        perceived_anxiety: submission.selfReport.perceivedAnxiety,
        energy: submission.selfReport.energy,
      });
    }

    if (session.ai_analysis_consent) {
      windowRows = await replaceSignalWindows(
        client,
        session.id,
        submission.windows.map((window) => ({
          session_id: session.id,
          user_id: session.user_id,
          signal_name: window.signal,
          start_offset_ms: window.startOffsetMs,
          end_offset_ms: window.endOffsetMs,
          value: window.value,
          extractor_version: extractorVersionFor(window.signal),
        })),
      );
    }

    if (transcriptionAuthorized(session)) {
      segmentRows = await replaceTranscriptSegments(
        client,
        session.id,
        submission.transcriptSegments.map((segment) => ({
          session_id: session.id,
          user_id: session.user_id,
          segment_index: segment.index,
          content: segment.text,
          start_offset_ms: segment.startOffsetMs,
          recognized_at_offset_ms: segment.recognizedAtOffsetMs,
          extractor_version: FEATURE_EXTRACTOR_VERSION,
        })),
      );
    }
  } catch (error) {
    console.error("elyra.temporal_detail_failed", {
      session_id: session.id,
      reason: error instanceof Error ? error.name : "unknown",
    });
  }
  return { windowRows, segmentRows };
}

async function persistSignals(
  client: Client,
  session: SessionRow,
  submission: z.infer<typeof sessionAnalysisSubmissionSchema>,
  resources: Set<CaptureResource>,
): Promise<DerivedFeatureRow[]> {
  if (!session.ai_analysis_consent) return [];

  const usable = submission.measurements.filter((measurement) =>
    AUDIO_SIGNALS.has(measurement.name)
      ? resources.has("microphone")
      : resources.has("camera"),
  );
  if (usable.length === 0) return [];

  const started = new Date().toISOString();
  const job = await insertProcessingJob(client, {
    session_id: session.id,
    user_id: session.user_id,
    job_kind: "signal_extraction",
    status: "running",
    attempts: 1,
    started_at: started,
  });

  try {
    const history = await findSignalHistory(client, session.user_id, session.id);
    const byName = new Map<string, number[]>();
    for (const entry of history) {
      if (entry.value === null) continue;
      // A baseline pessoal nao mistura captura parcial com completa.
      if (!usableForBaseline(entry.coverage_outcome)) continue;
      const bucket = byName.get(entry.signal_name) ?? [];
      bucket.push(entry.value);
      byName.set(entry.signal_name, bucket);
    }

    const coverageByModality = new Map(
      submission.coverage.map((item) => [item.modality, item]),
    );

    const rows = usable.map((measurement) => {
      const coverage =
        coverageByModality.get(signalModality(measurement.name)) ?? null;
      const signal = buildObservableSignal(
        measurement.name,
        measurement.value,
        personalBaseline(byName.get(measurement.name) ?? []),
        coverage,
      );
      return {
        session_id: session.id,
        user_id: session.user_id,
        signal_name: signal.name,
        unit: SIGNAL_UNIT[signal.name],
        value: signal.value,
        status: signal.status,
        personal_baseline_mean: signal.personalBaselineMean,
        personal_baseline_samples: signal.personalBaselineSamples,
        delta_vs_personal_baseline: signal.deltaVsPersonalBaseline,
        coverage_ms: coverage?.coverageMs ?? null,
        coverage_outcome: coverage?.outcome ?? null,
        extractor_version: extractorVersionFor(signal.name),
      };
    });

    const persisted = await upsertDerivedFeatures(client, rows);
    await updateProcessingJob(client, job.id, {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      error_code: null,
    });
    return persisted;
  } catch (error) {
    await updateProcessingJob(client, job.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_code: "signal_extraction_failed",
    });
    throw error;
  }
}

/**
 * O desfecho da interpretacao, com a causa nomeada.
 *
 * Antes, tudo o que nao desse certo virava `unavailable` e o job registrava
 * `pedrocore_unavailable`. Credencial ausente, contrato recusado, provider fora
 * do ar e sessao sem sinal util compartilhavam um nome — e nenhum deles e "o
 * servico esta indisponivel". Quem investigasse tinha um unico rotulo para
 * quatro causas com quatro correcoes diferentes.
 */
interface InterpretationOutcome {
  row: SessionInterpretationRow | null;
  failure: AnalysisPartState | null;
  reason: InterpretationUnavailableReason | null;
}

/**
 * Chama a fronteira e persiste a interpretacao.
 *
 * Idempotencia duravel: o fingerprint e do **payload minimizado**, nao do
 * pedido HTTP. Reprocessar a mesma sessao com os mesmos sinais reencontra a
 * interpretacao existente e nao gera segunda chamada nem segunda linha.
 *
 * Falha da fronteira nao propaga excecao: vira `unavailable` e a sessao mantem
 * transcricao e sinais. Perder o determinismo local por causa de um provider
 * indisponivel seria transformar indisponibilidade em perda de dado.
 */
async function runInterpretation(
  client: Client,
  session: SessionRow,
  features: DerivedFeatureRow[],
  transcript: SessionTranscriptRow | null,
  submission: z.infer<typeof sessionAnalysisSubmissionSchema>,
  resources: Set<CaptureResource>,
  dependencies: SessionAnalysisDependencies,
): Promise<InterpretationOutcome> {
  if (!session.ai_analysis_consent || features.length === 0) {
    return { row: null, failure: null, reason: null };
  }

  const captured = submission.capturedResources.filter((resource) =>
    resources.has(resource),
  );
  if (captured.length === 0) {
    return { row: null, failure: null, reason: null };
  }

  const digest =
    transcript &&
    transcript.status === "available" &&
    transcript.content !== null &&
    transcript.word_count !== null &&
    transcript.voiced_duration_ms !== null
      ? {
          language: "pt-BR" as const,
          text: transcript.content,
          wordCount: transcript.word_count,
          voicedDurationMs: transcript.voiced_duration_ms,
          truncated: transcript.truncated,
        }
      : null;

  let input;
  try {
    const coverageByModality = new Map(
      submission.coverage.map((item) => [item.modality, item]),
    );
    input = buildMultimodalInput({
      sessionKind: session.kind as "guided" | "free" | "deep_checkin",
      capturedResources: captured,
      durationMs: submission.durationMs,
      /*
        A cobertura atravessa a fronteira junto do numero. Sem ela, o Veltrix
        interpretaria "movimento acima da media pessoal" sem saber que a camera
        cobriu 8 dos 30 minutos - e produziria uma frase confiante sobre uma
        fracao que ninguem declarou.
      */
      modalityCoverage: submission.coverage,
      // Autorrelato atravessa como SELF_REPORTED. Ele nunca corrige o sinal, e o
      // sinal nunca o corrige - divergencia entre os dois nao e erro de
      // percepcao de ninguem (ADR-0008).
      selfReport: submission.selfReport,
      windows: submission.windows,
      signals: features.map((row) =>
        featureRowToSignal(
          row,
          coverageByModality.get(
            signalModality(row.signal_name as ObservableSignalName),
          ) ?? null,
        ),
      ),
      transcript: digest,
      // O consentimento de transcricao governa o texto tambem na saida: sem ele
      // `buildMultimodalInput` zera o digest antes de montar o payload.
      transcriptAnalysisConsent: transcriptionAuthorized(session),
      // A fonte da verdade e a coluna da sessao, e nao o que o navegador
      // afirmou na submissao: o cliente ja provou a cobertura porque presenciou
      // o evento, mas consentimento nao e evento presenciado - e registro.
      /*
        `=== true`, e nao o valor cru.

        A coluna e `not null default false`, entao em producao ela nunca chega
        ausente. Mas ler o campo direto fazia um valor ausente virar `undefined`
        -> `ZodError` -> `catch` -> **a interpretacao inteira degradava para
        `failed`**. Uma trava de privacidade que derruba trabalho alheio quando
        nao tem o que travar erra duas vezes: nao protege nada a mais, e custa a
        analise que nao tinha nada de visual.

        Coagir para `false` mantem o fail-closed - ausencia de consentimento e
        ausencia de consentimento - sem transformar isso em falha de sessao.
      */
      visualAnalysisConsent: session.visual_analysis_consent === true,
    });
  } catch {
    // A projecao minimizada nao pode ser montada: o payload que iriamos enviar
    // e invalido segundo o nosso proprio contrato.
    return { row: null, failure: "failed", reason: "contract_rejected" };
  }

  const fingerprint = sha256(canonicalJson(input));
  const existing = await findInterpretationByFingerprint(
    client,
    session.id,
    fingerprint,
  );
  if (existing) return { row: existing, failure: null, reason: null };

  // Dois identificadores com naturezas diferentes, deliberadamente ligados: o
  // uuid e o que o banco aceita, e o prefixo e o que o contrato com o Veltrix
  // espera na chamada externa. Guardar o uuid dentro da string mantem os dois
  // rastreaveis um a partir do outro.
  const correlationUuid = randomUUID();
  const correlationId = `elyra-multimodal-${correlationUuid}`;
  const started = new Date().toISOString();
  const job = await insertProcessingJob(client, {
    session_id: session.id,
    user_id: session.user_id,
    job_kind: "session_interpretation",
    status: "running",
    attempts: 1,
    started_at: started,
  });

  // A RLS de `session_interpretations` exige consentimento de inferencia

  // analise por IA" desta sessao e a concessao explicita que o registra.
  await setAiInferenceConsent(client, true);

  let outcome;
  try {
    outcome = await dependencies
      .createPedroCoreClient()
      .interpretSessionSignals(
        input,
        correlationId,
        `elyra-multimodal-key-${fingerprint.slice(0, 32)}`,
      );
  } catch (error) {
    await updateProcessingJob(client, job.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      /*
        Configuracao ausente deixa de se disfarcar de indisponibilidade.

        As duas produzem "nao houve interpretacao", e tem correcoes opostas:
        uma se resolve configurando a instalacao, a outra so esperando o
        servico voltar. Registrar as duas com o mesmo codigo mandava quem
        investigasse esperar por algo que nunca ia mudar sozinho.
      */
      error_code:
        error instanceof PedroCoreTimeoutError
          ? "pedrocore_timeout"
          : error instanceof PedroCoreContractError
            ? "pedrocore_invalid_output"
            : error instanceof PedroCoreBlockedError
              ? "pedrocore_blocked"
              : error instanceof PedroCoreConfigurationError
                ? "pedrocore_configuration_missing"
                : "pedrocore_unavailable",
    });
    await auditAnalysisFailure(
      client,
      session,
      correlationUuid,
      "session_interpretation.failed",
    );
    if (error instanceof PedroCoreConfigurationError) {
      return {
        row: null,
        failure: "unavailable",
        reason: "configuration_missing",
      };
    }
    if (error instanceof PedroCoreTimeoutError) {
      return { row: null, failure: "unavailable", reason: "provider_timeout" };
    }
    if (error instanceof PedroCoreBlockedError) {
      /*
        O Veltrix respondeu, e recusou. Ele esta de pe — chamar isso de
        indisponibilidade do servico apontaria para o lugar errado.
      */
      return { row: null, failure: "unavailable", reason: "provider_unavailable" };
    }
    if (error instanceof PedroCoreUnavailableError) {
      return { row: null, failure: "unavailable", reason: "service_unavailable" };
    }
    if (error instanceof PedroCoreContractError) {
      return { row: null, failure: "failed", reason: "contract_rejected" };
    }
    throw error;
  }

  /*
    ## O portao de qualidade, antes de persistir

    O contrato ja recusou forma errada. Aqui a saida e confrontada com a
    **projecao que a produziu**: observacao que se apoia em sinal ausente,
    confianca `low` com linguagem categorica, cobertura parcial nao declarada,
    vocabulario clinico ou causal.

    Reprovado **nao vira sucesso com ressalva**. A interpretacao nao e
    persistida, e a tela diz que nao ha interpretacao - estado legitimo e
    dizivel, e nao falha escondida. Persistir uma saida reprovada e depois
    esconde-la na exibicao deixaria o artefato ruim vivo no banco, alcancavel
    pelo dossie profissional e pelo export do titular.
  */
  const quality = evaluateInterpretationQuality(input, outcome.elyra_multimodal);
  if (!quality.ok) {
    await updateProcessingJob(client, job.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_code: "quality_gate_rejected",
    });
    await auditAnalysisFailure(
      client,
      session,
      correlationUuid,
      "session_interpretation.quality_rejected",
    );
    console.error("elyra.interpretation_quality_rejected", {
      session_id: session.id,
      // Codigos do proprio gate; nunca o texto reprovado, que e conteudo.
      failures: quality.failures,
    });
    // Reprovado no portao NAO vira sucesso com ressalva.
    return { row: null, failure: "failed", reason: "quality_gate_rejected" };
  }

  try {
    const inserted = await insertSessionInterpretation(client, {
      session_id: session.id,
      user_id: session.user_id,
      contract_version: ELYRA_MULTIMODAL_CONTRACT_VERSION,
      signals_schema_version: SIGNALS_SCHEMA_VERSION,
      correlation_id: correlationId,
      request_fingerprint: fingerprint,
      provider_used: outcome.provider_used,
      model: outcome.model,
      confidence: outcome.elyra_multimodal.confidence,
      payload: outcome.elyra_multimodal as unknown as Json,
    });
    await updateProcessingJob(client, job.id, {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      error_code: null,
    });
    // `null` e corrida perdida para outra requisicao com o mesmo fingerprint:
    // a linha dela vale, e o resultado e o mesmo.
    return {
      row:
        inserted ??
        (await findInterpretationByFingerprint(client, session.id, fingerprint)),
      failure: null,
      reason: null,
    };
  } catch (error) {
    await updateProcessingJob(client, job.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_code: "interpretation_persistence_failed",
    });
    await auditAnalysisFailure(
      client,
      session,
      correlationUuid,
      "session_interpretation.persistence_failed",
    );
    throw error;
  }
}

/**
 * Executa o processamento pos-sessao completo.
 *
 * Idempotente e retry-safe: transcricao e sinais sao upsert por chave natural, e
 * a interpretacao e unica por `(session_id, request_fingerprint)`. Chamar duas
 * vezes com o mesmo payload nao duplica nada.
 */
export async function runSessionAnalysis(
  client: Client,
  user: User,
  sessionId: string,
  rawInput: unknown,
  dependencies: SessionAnalysisDependencies = defaultDependencies,
): Promise<SessionAnalysisResult> {
  const session = await loadOwnedSession(client, user, sessionId);
  if (!PROCESSABLE_STATUSES.has(session.status)) {
    throw new SessionAnalysisServiceError("INVALID_STATE", 409);
  }

  const submission = sessionAnalysisSubmissionSchema.parse(rawInput);
  const resources = consentedResources(session);


  const coverageRows = await persistCoverage(client, session, submission);
  const transcript = await persistTranscript(client, session, submission);
  const features = await persistSignals(
    client,
    session,
    submission,
    resources,
  );
  const { windowRows, segmentRows } = await persistTemporalDetail(
    client,
    session,
    submission,
  );

  const { row, failure, reason: interpretationReason } = await runInterpretation(
    client,
    session,
    features,
    transcript,
    submission,
    resources,
    dependencies,
  );

  return buildResult(
    session,
    transcript,
    features,
    row,
    coverageRows,
    windowRows,
    segmentRows,
    submission.selfReport,
    failure,
    interpretationReason,
  );
}

/**
 * Traduz a proveniencia do contrato para as colunas de `session_transcripts`.
 *
 * Existe como funcao nomeada para que a regra "detalhe so acompanha Whisper
 * local" seja testavel de um lado so. O banco tem a mesma regra em
 * `session_transcript_provenance_shape`; as duas pontas recusam o mesmo, e por
 * isso uma delas nao pode ser esquecida em silencio.
 */
function transcriptProvenanceColumns(provenance: AsrProvenance | null) {
  if (!provenance) return {};
  const local = provenance.engine === "local_whisper";
  return {
    source: provenance.engine,
    asr_model: local ? provenance.model : null,
    asr_quantization: local ? provenance.quantization : null,
    asr_runtime: local ? provenance.runtime : null,
    asr_runtime_version: local ? provenance.runtimeVersion : null,
    asr_vad: local ? provenance.vad : null,
  };
}


function transcriptProvenanceFromRow(
  row: SessionTranscriptRow,
): AsrProvenance | null {
  const engine = row.source;
  if (engine === "local_whisper") {
    // O banco garante que o detalhe existe para este motor; se algum dia nao
    // existir, ausencia e a resposta honesta, e nao um preenchimento.
    if (
      !row.asr_model ||
      !row.asr_quantization ||
      !row.asr_runtime ||
      !row.asr_runtime_version ||
      !row.asr_vad
    ) {
      return null;
    }
    return {
      engine: "local_whisper",
      model: row.asr_model,
      quantization: row.asr_quantization,
      runtime: row.asr_runtime,
      runtimeVersion: row.asr_runtime_version,
      vad: row.asr_vad,
    };
  }
  if (engine === "native_speech_recognition" || engine === "on_device_speech_api") {
    return {
      engine,
      model: null,
      quantization: null,
      runtime: null,
      runtimeVersion: null,
      vad: null,
    };
  }
  return null;
}
