import type { SupabaseClient, User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/repositories/multimodal-repository", () => ({
  findMultimodalSession: vi.fn(),
  insertProcessingJob: vi.fn(),
  updateProcessingJob: vi.fn(),
}));
vi.mock("@/server/repositories/session-analysis-repository", () => ({
  SessionAnalysisRepositoryError: class extends Error {},
  findInterpretationByFingerprint: vi.fn(),
  findLatestInterpretation: vi.fn(),
  findSessionFeatures: vi.fn(),
  findSessionTranscript: vi.fn(),
  findSignalHistory: vi.fn(),
  findSessionCoverage: vi.fn(),
  upsertSessionCoverage: vi.fn(),
  findSignalWindows: vi.fn(),
  findSessionSelfReport: vi.fn(),
  upsertSessionSelfReport: vi.fn(),
  findTranscriptSegments: vi.fn(),
  replaceSignalWindows: vi.fn(),
  replaceTranscriptSegments: vi.fn(),
  insertSessionInterpretation: vi.fn(),
  upsertDerivedFeatures: vi.fn(),
  upsertSessionTranscript: vi.fn(),
}));
vi.mock("@/server/repositories/ai-insights-repository", () => ({
  setAiInferenceConsent: vi.fn(),
}));
vi.mock("@/server/repositories/identity-repository", () => ({
  appendAudit: vi.fn(),
}));

import { multimodalOutputFixture } from "@/lib/contracts/multimodal-fixtures";
import { SIGNAL_UNIT } from "@/lib/contracts/multimodal-signals";
import type { Database, Json } from "@/lib/supabase/database.types";
import {
  PedroCoreContractError,
  PedroCoreUnavailableError,
  type ElyraPedroCoreClient,
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
  findSessionFeatures,
  findSessionTranscript,
  findSignalHistory,
  insertSessionInterpretation,
  upsertDerivedFeatures,
  upsertSessionTranscript,
  findSessionCoverage,
  upsertSessionCoverage,
  findSignalWindows,
  findTranscriptSegments,
  replaceSignalWindows,
  replaceTranscriptSegments,
  findSessionSelfReport,
  upsertSessionSelfReport,
} from "@/server/repositories/session-analysis-repository";
import {
  SessionAnalysisServiceError,
  getSessionAnalysis,
  runSessionAnalysis,
} from "@/server/services/session-analysis-service";



const user = { id: "11111111-1111-4111-8111-111111111111" } as User;
const sessionId = "22222222-2222-4222-8222-222222222222";
const client = {} as SupabaseClient<Database>;

type SessionRow = Database["public"]["Tables"]["multimodal_sessions"]["Row"];

function sessionRow(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: sessionId,
    user_id: user.id,
    kind: "guided",
    status: "completed",
    screen_consent: false,
    camera_consent: true,
    microphone_consent: true,
    transcription_consent: true,
    // Padrao desligado, como a coluna real: o caminho sem analise visual e o
    // que a maioria destes testes exercita, e ele precisa ser o default aqui
    // pelo mesmo motivo que e o default em producao.
    visual_analysis_consent: false,
    storage_consent: false,
    ai_analysis_consent: true,
    share_result_consent: false,
    share_transcript_consent: false,
    share_original_consent: false,
    training_eligibility_consent: false,
    started_at: "2026-08-28T10:00:00.000Z",
    ended_at: "2026-08-28T10:05:00.000Z",
    created_at: "2026-08-28T10:00:00.000Z",
    updated_at: "2026-08-28T10:05:00.000Z",
    ...overrides,
  } as SessionRow;
}

/**
 * Cobertura coerente com os recursos capturados.
 *
 * O contrato recusa recurso capturado sem cobertura declarada, e cobertura de
 * recurso que nao foi capturado. Derivar a cobertura da mesma lista em vez de
 * escrever as duas a mao e o que impede o helper de produzir uma submissao que
 * so o teste aceitaria.
 */
function coverageFor(resources: readonly string[], durationMs: number) {
  return (["screen", "camera", "microphone"] as const).map((modality) =>
    resources.includes(modality)
      ? { modality, outcome: "full", reason: null, coverageMs: durationMs, sessionDurationMs: durationMs }
      : { modality, outcome: "absent", reason: "not_requested", coverageMs: 0, sessionDurationMs: durationMs },
  );
}

function submission(overrides: Record<string, unknown> = {}) {
  const durationMs = (overrides.durationMs as number | undefined) ?? 300_000;
  const capturedResources =
    (overrides.capturedResources as string[] | undefined) ?? ["camera", "microphone"];
  return {
    durationMs,
    capturedResources,
    transcript: {
      status: "available",
      text: "Falei sobre o meu dia inteiro hoje.",
      wordCount: 7,
      voicedDurationMs: 60_000,
      truncated: false,
    },
    measurements: [
      { name: "speech_rate", value: 130 },
      { name: "pause_count", value: 4 },
      { name: "movement_frequency", value: 0.3 },
    ],
    coverage: coverageFor(capturedResources, durationMs),
    ...overrides,
  };
}

let interpret: ReturnType<typeof vi.fn>;

function dependencies() {
  return {
    createPedroCoreClient: () =>
      ({ interpretSessionSignals: interpret }) as unknown as ElyraPedroCoreClient,
  };
}

/** Espelha o que o banco devolveria depois do upsert de sinais. */
function featureRowsFromUpsert(input: Record<string, unknown>[]) {
  return input.map((row, index) => ({
    id: `feature-${index}`,
    created_at: "2026-08-28T10:06:00.000Z",
    updated_at: "2026-08-28T10:06:00.000Z",
    extractor_version: "elyra-signals/v1",
    ...row,
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  interpret = vi.fn(async (_input, correlationId: string) => ({
    provider_used: "mock" as const,
    model: "pedrocore-mock",
    elyra_multimodal: multimodalOutputFixture(correlationId),
  }));

  vi.mocked(findMultimodalSession).mockResolvedValue(sessionRow());
  vi.mocked(insertProcessingJob).mockImplementation(
    async (_client, input) =>
      ({ id: `job-${input.job_kind}`, status: "running" }) as never,
  );
  vi.mocked(updateProcessingJob).mockResolvedValue(undefined);
  vi.mocked(findSignalHistory).mockResolvedValue([]);
  vi.mocked(findSessionCoverage).mockResolvedValue([]);
  vi.mocked(findSignalWindows).mockResolvedValue([]);
  vi.mocked(findSessionSelfReport).mockResolvedValue(null);
  vi.mocked(upsertSessionSelfReport).mockResolvedValue({} as never);
  vi.mocked(findTranscriptSegments).mockResolvedValue([]);
  vi.mocked(replaceSignalWindows).mockResolvedValue([]);
  vi.mocked(replaceTranscriptSegments).mockResolvedValue([]);
  vi.mocked(upsertSessionCoverage).mockImplementation(
    async (_client, input) =>
      input.map((row, index) => ({ ...row, id: `coverage-${index}` })) as never,
  );
  vi.mocked(findSessionTranscript).mockResolvedValue(null);
  vi.mocked(findSessionFeatures).mockResolvedValue([]);
  vi.mocked(findLatestInterpretation).mockResolvedValue(null);
  vi.mocked(findInterpretationByFingerprint).mockResolvedValue(null);
  vi.mocked(setAiInferenceConsent).mockResolvedValue("consent-event" as never);

  vi.mocked(upsertSessionTranscript).mockImplementation(
    async (_client, input) =>
      ({
        id: "transcript-1",
        created_at: "2026-08-28T10:06:00.000Z",
        updated_at: "2026-08-28T10:06:00.000Z",
        language: "pt-BR",
        source: "on_device_speech_api",
        extractor_version: "elyra-signals/v1",
        deleted_at: null,
        ...input,
      }) as never,
  );
  vi.mocked(upsertDerivedFeatures).mockImplementation(
    async (_client, input) => featureRowsFromUpsert(input as never) as never,
  );
  vi.mocked(insertSessionInterpretation).mockImplementation(
    async (_client, input) =>
      ({
        id: "interpretation-1",
        created_at: "2026-08-28T10:06:30.000Z",
        ...input,
      }) as never,
  );
});

describe("runSessionAnalysis - caminho completo", () => {
  it("persiste transcricao, sinais e interpretacao numa unica passagem", async () => {
    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission(),
      dependencies(),
    );

    expect(upsertSessionTranscript).toHaveBeenCalledTimes(1);
    expect(upsertDerivedFeatures).toHaveBeenCalledTimes(1);
    expect(interpret).toHaveBeenCalledTimes(1);
    expect(insertSessionInterpretation).toHaveBeenCalledTimes(1);

    expect(result.state).toBe("available");
    expect(result.transcript.state).toBe("available");
    expect(result.transcript.text).toBe("Falei sobre o meu dia inteiro hoje.");
    expect(result.signalsState).toBe("available");
    expect(result.signals).toHaveLength(3);
    expect(result.interpretation.state).toBe("available");
    expect(result.interpretation.providerUsed).toBe("mock");
  });

  it("registra um job por finalidade", async () => {
    await runSessionAnalysis(client, user, sessionId, submission(), dependencies());
    const kinds = vi
      .mocked(insertProcessingJob)
      .mock.calls.map(([, input]) => input.job_kind);
    expect(kinds).toEqual([
      "transcript_ingest",
      "signal_extraction",
      "session_interpretation",
    ]);
  });

  it("nao envia midia, caminho de Storage nem identificador de pessoa", async () => {
    await runSessionAnalysis(client, user, sessionId, submission(), dependencies());
    const payload = JSON.stringify(interpret.mock.calls[0]![0]);
    expect(payload).not.toContain(user.id);
    expect(payload).not.toContain(sessionId);
    expect(payload).not.toContain("storage");
  });
});

describe("runSessionAnalysis - consentimento", () => {
  it("nao escreve transcricao sem consentimento de transcricao", async () => {
    vi.mocked(findMultimodalSession).mockResolvedValue(
      sessionRow({ transcription_consent: false }),
    );
    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission(),
      dependencies(),
    );
    expect(upsertSessionTranscript).not.toHaveBeenCalled();
    expect(result.transcript.state).toBe("not_authorized");
    expect(result.transcript.text).toBeNull();
  });

  it("nao escreve transcricao sem consentimento de microfone", async () => {
    vi.mocked(findMultimodalSession).mockResolvedValue(
      sessionRow({ microphone_consent: false }),
    );
    await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission({
        capturedResources: ["camera"],
        transcript: null,
        measurements: [{ name: "movement_frequency", value: 0.3 }],
      }),
      dependencies(),
    );
    expect(upsertSessionTranscript).not.toHaveBeenCalled();
  });

  it("nao deriva sinais nem chama a fronteira sem consentimento de IA", async () => {
    vi.mocked(findMultimodalSession).mockResolvedValue(
      sessionRow({ ai_analysis_consent: false }),
    );
    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission(),
      dependencies(),
    );
    expect(upsertDerivedFeatures).not.toHaveBeenCalled();
    expect(interpret).not.toHaveBeenCalled();
    // Consentir transcricao nao consente analise: uma porta nao abre a outra.
    expect(upsertSessionTranscript).toHaveBeenCalledTimes(1);
    expect(result.signalsState).toBe("not_authorized");
    expect(result.interpretation.state).toBe("not_authorized");
  });

  it("descarta sinal de audio quando o microfone nao foi consentido", async () => {
    vi.mocked(findMultimodalSession).mockResolvedValue(
      sessionRow({ microphone_consent: false, transcription_consent: false }),
    );
    await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission({
        capturedResources: ["camera"],
        transcript: null,
        measurements: [{ name: "movement_frequency", value: 0.3 }],
      }),
      dependencies(),
    );
    const rows = vi.mocked(upsertDerivedFeatures).mock.calls[0]![1];
    expect(rows.map((row) => row.signal_name)).toEqual(["movement_frequency"]);
  });

  it("nao envia a transcricao ao PedroCore sem consentimento de transcricao", async () => {
    vi.mocked(findMultimodalSession).mockResolvedValue(
      sessionRow({ transcription_consent: false }),
    );
    await runSessionAnalysis(client, user, sessionId, submission(), dependencies());
    expect(interpret.mock.calls[0]![0].session.transcript).toBeNull();
  });
});

describe("runSessionAnalysis - transcricao indisponivel", () => {
  it("persiste indisponibilidade sem texto quando a API nao existe", async () => {
    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission({
        transcript: {
          status: "unavailable",
          reason: "speech_api_unsupported",
        },
      }),
      dependencies(),
    );

    const written = vi.mocked(upsertSessionTranscript).mock.calls[0]![1];
    expect(written).toMatchObject({
      status: "unavailable",
      content: null,
      word_count: null,
      voiced_duration_ms: null,
      unavailable_reason: "speech_api_unsupported",
    });
    expect(result.transcript.state).toBe("unavailable");
    expect(result.transcript.text).toBeNull();
    // A sessao segue valida: sinais e interpretacao continuam acontecendo.
    expect(result.signalsState).toBe("available");
    expect(result.interpretation.state).toBe("available");
  });
});

describe("runSessionAnalysis - baseline pessoal", () => {
  it("marca insufficient_baseline sem historico, e nao 'dentro da media'", async () => {
    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission(),
      dependencies(),
    );
    for (const signal of result.signals) {
      expect(signal.status).toBe("insufficient_baseline");
      expect(signal.deltaVsPersonalBaseline).toBeNull();
      expect(signal.personalBaselineSamples).toBe(0);
    }
  });

  it("deriva a baseline do historico do proprio usuario", async () => {
    vi.mocked(findSignalHistory).mockResolvedValue([
      { signal_name: "speech_rate", value: 100 },
      { signal_name: "speech_rate", value: 120 },
    ] as never);

    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission({ measurements: [{ name: "speech_rate", value: 130 }] }),
      dependencies(),
    );

    const signal = result.signals[0]!;
    expect(signal.status).toBe("available");
    expect(signal.personalBaselineMean).toBe(110);
    expect(signal.personalBaselineSamples).toBe(2);
    expect(signal.deltaVsPersonalBaseline).toBe(20);
  });


  it("nao deixa captura parcial anterior entrar na baseline pessoal", async () => {
    vi.mocked(findSignalHistory).mockResolvedValue([
      { signal_name: "speech_rate", value: 100, coverage_outcome: "full" },
      { signal_name: "speech_rate", value: 120, coverage_outcome: "full" },
      // Esta puxaria a media de 110 para 90 se fosse aceita.
      { signal_name: "speech_rate", value: 30, coverage_outcome: "partial" },
    ] as never);

    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission({ measurements: [{ name: "speech_rate", value: 130 }] }),
      dependencies(),
    );

    const signal = result.signals[0]!;
    expect(signal.personalBaselineMean).toBe(110);
    expect(signal.personalBaselineSamples).toBe(2);
  });


  it("mantem historico anterior a Era 4, que nao tem cobertura registrada", async () => {
    vi.mocked(findSignalHistory).mockResolvedValue([
      { signal_name: "speech_rate", value: 100, coverage_outcome: null },
      { signal_name: "speech_rate", value: 120, coverage_outcome: null },
    ] as never);

    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission({ measurements: [{ name: "speech_rate", value: 130 }] }),
      dependencies(),
    );

    expect(result.signals[0]!.personalBaselineSamples).toBe(2);
  });

  it("exclui a propria sessao do historico", async () => {
    await runSessionAnalysis(client, user, sessionId, submission(), dependencies());
    expect(findSignalHistory).toHaveBeenCalledWith(client, user.id, sessionId);
  });

  it("ignora a baseline que o cliente tentar declarar", async () => {
    // O contrato de submissao ja recusa o campo; aqui garantimos que o valor
    // gravado vem sempre do historico, nunca do payload.
    await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission({ measurements: [{ name: "pause_count", value: 4 }] }),
      dependencies(),
    );
    const row = vi.mocked(upsertDerivedFeatures).mock.calls[0]![1][0]!;
    expect(row.personal_baseline_mean).toBeNull();
    expect(row.unit).toBe(SIGNAL_UNIT.pause_count);
  });
});

describe("runSessionAnalysis - idempotencia", () => {
  it("nao chama a fronteira quando ja existe interpretacao com o mesmo fingerprint", async () => {
    vi.mocked(findInterpretationByFingerprint).mockResolvedValue({
      id: "interpretation-existing",
      session_id: sessionId,
      user_id: user.id,
      contract_version: "elyra-multimodal/v1",
      signals_schema_version: "multimodal_signals/v1",
      correlation_id: "elyra-multimodal-existing",
      request_fingerprint: "f".repeat(64),
      provider_used: "mock",
      model: "pedrocore-mock",
      payload: multimodalOutputFixture(
        "elyra-multimodal-existing",
      ) as unknown as Json,
      created_at: "2026-08-28T10:06:30.000Z",
    } as never);

    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission(),
      dependencies(),
    );

    expect(interpret).not.toHaveBeenCalled();
    expect(insertSessionInterpretation).not.toHaveBeenCalled();
    expect(result.interpretation.state).toBe("available");
  });

  it("produz o mesmo fingerprint para a mesma submissao", async () => {
    await runSessionAnalysis(client, user, sessionId, submission(), dependencies());
    const first = vi.mocked(insertSessionInterpretation).mock.calls[0]![1]
      .request_fingerprint;

    vi.clearAllMocks();
    beforeEachState();
    await runSessionAnalysis(client, user, sessionId, submission(), dependencies());
    const second = vi.mocked(insertSessionInterpretation).mock.calls[0]![1]
      .request_fingerprint;

    expect(second).toBe(first);
  });

  it("resolve a corrida perdida lendo a linha vencedora", async () => {
    vi.mocked(insertSessionInterpretation).mockResolvedValue(null);
    vi.mocked(findInterpretationByFingerprint)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "interpretation-winner",
        session_id: sessionId,
        user_id: user.id,
        contract_version: "elyra-multimodal/v1",
        signals_schema_version: "multimodal_signals/v1",
        correlation_id: "elyra-multimodal-winner",
        request_fingerprint: "a".repeat(64),
        provider_used: "mock",
        model: "pedrocore-mock",
        payload: multimodalOutputFixture(
          "elyra-multimodal-winner",
        ) as unknown as Json,
        created_at: "2026-08-28T10:06:30.000Z",
      } as never);

    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission(),
      dependencies(),
    );
    expect(result.interpretation.state).toBe("available");
  });
});

describe("runSessionAnalysis - falha da fronteira", () => {
  it("degrada para indisponivel sem apagar transcricao e sinais", async () => {
    interpret.mockRejectedValue(new PedroCoreUnavailableError());

    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission(),
      dependencies(),
    );

    expect(result.transcript.state).toBe("available");
    expect(result.signalsState).toBe("available");
    expect(result.interpretation.state).toBe("unavailable");
    expect(result.interpretation.output).toBeNull();
    expect(insertSessionInterpretation).not.toHaveBeenCalled();
  });


  it("audita com uuid puro, e nao com o identificador prefixado do contrato", async () => {
    interpret.mockRejectedValue(new PedroCoreUnavailableError());

    await runSessionAnalysis(client, user, sessionId, submission(), dependencies());

    expect(appendAudit).toHaveBeenCalled();
    const [, entrada] = vi.mocked(appendAudit).mock.calls.at(-1)!;
    expect(entrada.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(entrada.correlationId).not.toContain("elyra-multimodal");
  });

  it("marca falha quando a saida nao respeita o contrato", async () => {
    interpret.mockRejectedValue(new PedroCoreContractError());
    const result = await runSessionAnalysis(
      client,
      user,
      sessionId,
      submission(),
      dependencies(),
    );
    expect(result.interpretation.state).toBe("failed");
  });

  it("marca o job como falho com codigo, sem conteudo", async () => {
    interpret.mockRejectedValue(new PedroCoreUnavailableError());
    await runSessionAnalysis(client, user, sessionId, submission(), dependencies());
    const failed = vi
      .mocked(updateProcessingJob)
      .mock.calls.find(([, , patch]) => patch.status === "failed");
    expect(failed?.[2].error_code).toBe("pedrocore_unavailable");
  });
});

describe("runSessionAnalysis - isolamento e estado", () => {
  it("recusa a sessao de outra pessoa como nao encontrada", async () => {
    vi.mocked(findMultimodalSession).mockResolvedValue(
      sessionRow({ user_id: "99999999-9999-4999-8999-999999999999" }),
    );
    await expect(
      runSessionAnalysis(client, user, sessionId, submission(), dependencies()),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND", status: 404 });
  });

  it("recusa sessao inexistente sem revelar de quem ela seria", async () => {
    vi.mocked(findMultimodalSession).mockResolvedValue(null);
    await expect(
      runSessionAnalysis(client, user, sessionId, submission(), dependencies()),
    ).rejects.toBeInstanceOf(SessionAnalysisServiceError);
  });

  it("recusa processar uma sessao que ainda esta capturando", async () => {
    vi.mocked(findMultimodalSession).mockResolvedValue(
      sessionRow({ status: "capturing" }),
    );
    await expect(
      runSessionAnalysis(client, user, sessionId, submission(), dependencies()),
    ).rejects.toMatchObject({ code: "INVALID_STATE", status: 409 });
  });

  it("recusa sessao excluida", async () => {
    vi.mocked(findMultimodalSession).mockResolvedValue(
      sessionRow({ status: "deleted" }),
    );
    await expect(
      runSessionAnalysis(client, user, sessionId, submission(), dependencies()),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });
});

describe("getSessionAnalysis", () => {
  it("devolve pendente, e nao resultado, quando nada foi processado", async () => {
    const result = await getSessionAnalysis(client, user, sessionId);
    expect(result.state).toBe("pending");
    expect(result.transcript.state).toBe("pending");
    expect(result.transcript.text).toBeNull();
    expect(result.signals).toEqual([]);
    expect(result.interpretation.output).toBeNull();
  });

  it("recusa saida persistida que nao valida mais no contrato", async () => {
    vi.mocked(findLatestInterpretation).mockResolvedValue({
      id: "interpretation-corrupted",
      session_id: sessionId,
      user_id: user.id,
      contract_version: "elyra-multimodal/v1",
      signals_schema_version: "multimodal_signals/v1",
      correlation_id: "elyra-multimodal-corrupted",
      request_fingerprint: "b".repeat(64),
      provider_used: "mock",
      model: "pedrocore-mock",
      payload: { summary: "payload que o contrato ja nao aceita" } as Json,
      created_at: "2026-08-28T10:06:30.000Z",
    } as never);

    const result = await getSessionAnalysis(client, user, sessionId);
    expect(result.interpretation.state).toBe("failed");
    expect(result.interpretation.output).toBeNull();
  });

  it("recusa ler a sessao de outra pessoa", async () => {
    vi.mocked(findMultimodalSession).mockResolvedValue(
      sessionRow({ user_id: "99999999-9999-4999-8999-999999999999" }),
    );
    await expect(
      getSessionAnalysis(client, user, sessionId),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND" });
  });
});

/** Restaura os mocks apos um `clearAllMocks` feito dentro de um teste. */
function beforeEachState() {
  interpret = vi.fn(async (_input, correlationId: string) => ({
    provider_used: "mock" as const,
    model: "pedrocore-mock",
    elyra_multimodal: multimodalOutputFixture(correlationId),
  }));
  vi.mocked(findMultimodalSession).mockResolvedValue(sessionRow());
  vi.mocked(insertProcessingJob).mockImplementation(
    async (_client, input) =>
      ({ id: `job-${input.job_kind}`, status: "running" }) as never,
  );
  vi.mocked(updateProcessingJob).mockResolvedValue(undefined);
  vi.mocked(findSignalHistory).mockResolvedValue([]);
  vi.mocked(findInterpretationByFingerprint).mockResolvedValue(null);
  vi.mocked(setAiInferenceConsent).mockResolvedValue("consent-event" as never);
  vi.mocked(upsertSessionTranscript).mockImplementation(
    async (_client, input) =>
      ({
        id: "transcript-1",
        created_at: "2026-08-28T10:06:00.000Z",
        updated_at: "2026-08-28T10:06:00.000Z",
        language: "pt-BR",
        source: "on_device_speech_api",
        extractor_version: "elyra-signals/v1",
        deleted_at: null,
        ...input,
      }) as never,
  );
  vi.mocked(upsertDerivedFeatures).mockImplementation(
    async (_client, input) => featureRowsFromUpsert(input as never) as never,
  );
  vi.mocked(insertSessionInterpretation).mockImplementation(
    async (_client, input) =>
      ({
        id: "interpretation-1",
        created_at: "2026-08-28T10:06:30.000Z",
        ...input,
      }) as never,
  );
}
