import "server-only";

import {
  ELYRA_ORIGIN_SYSTEM,
  ELYRA_TEXTUAL_CONTRACT_VERSION,
  ELYRA_TEXTUAL_INPUT_VERSION,
  ELYRA_TEXTUAL_MESSAGE,
  ELYRA_TEXTUAL_OPERATION,
  ELYRA_TEXTUAL_TASK,
  PEDROCORE_MOCK_MODEL,
  PEDROCORE_MOCK_PROVIDER,
  elyraOrchestrateErrorSchema,
  elyraOrchestrateRequestSchema,
  elyraOrchestrateSuccessSchema,
  elyraTextualInputSchema,
  type ElyraOrchestrateRequest,
  type ElyraOrchestrateSuccess,
  type ElyraProviderMode,
  type ElyraTextualInput,
} from "@/lib/contracts/pedrocore";
import {
  ELYRA_MULTIMODAL_CONTRACT_VERSION,
  ELYRA_MULTIMODAL_MESSAGE,
  ELYRA_MULTIMODAL_OPERATION,
  ELYRA_MULTIMODAL_TASK,
  elyraMultimodalInputSchema,
  elyraMultimodalOrchestrateRequestSchema,
  elyraMultimodalOrchestrateSuccessSchema,
  type ElyraMultimodalInput,
  type ElyraMultimodalOrchestrateRequest,
  type ElyraMultimodalOrchestrateSuccess,
} from "@/lib/contracts/multimodal-signals";
import {
  ELYRA_LEARNING_CONTRACT_VERSION,
  ELYRA_LEARNING_MESSAGE,
  ELYRA_LEARNING_TASK,
  REVOKE_OPERATION,
  SUBMIT_OPERATION,
  elyraLearningOrchestrateRequestSchema,
  elyraLearningOrchestrateSuccessSchema,
  elyraLearningRevocationSchema,
  elyraLearningSubmissionSchema,
  type ElyraLearningOrchestrateRequest,
  type ElyraLearningReceipt,
  type ElyraLearningRevocation,
  type ElyraLearningSubmission,
} from "@/lib/contracts/learning";

const PEDROCORE_API_KEY_HEADER = "X-PedroCore-Api-Key";

const DEFAULT_TIMEOUT_MS = 8_000;
/**
 * Teto de espera da rota multimodal.
 *
 * Igual ao limite do servico: passar dele significaria a Elyra desistir de uma
 * resposta que ainda pode chegar, e ficar abaixo dele reintroduziria o mesmo
 * defeito em escala menor. Continua sendo um teto — espera infinita nao e
 * paciencia, e uma sessao presa.
 */
const MULTIMODAL_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 30_000;

type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export interface PedroCoreClientConfig {
  baseUrl: string;
  apiKey: string;
  providerMode: ElyraProviderMode;
  timeoutMs: number;
  /**
   * Orcamento da rota multimodal.
   *
   * Ausente = use `timeoutMs`. Isso mantem uma regra simples: **configuracao
   * explicita sempre vence**. Quem declarou `PEDROCORE_TIMEOUT_MS` recebe
   * exatamente esse valor nas duas rotas, para mais ou para menos; quem nao
   * declarou nada recebe o default de cada rota, que sao diferentes porque as
   * rotas sao diferentes.
   */
  multimodalTimeoutMs?: number;
}

export class PedroCoreConfigurationError extends Error {
  constructor() {
    super("Configuracao server-only do PedroCore indisponivel.");
    this.name = "PedroCoreConfigurationError";
  }
}

export class PedroCoreUnavailableError extends Error {
  constructor() {
    super("PedroCore indisponivel.");
    this.name = "PedroCoreUnavailableError";
  }
}

export class PedroCoreTimeoutError extends Error {
  constructor() {
    super("PedroCore excedeu o timeout sem retry.");
    this.name = "PedroCoreTimeoutError";
  }
}

export class PedroCoreContractError extends Error {
  constructor(message = "Resposta PedroCore invalida.") {
    super(message);
    this.name = "PedroCoreContractError";
  }
}

export class PedroCoreBlockedError extends Error {
  constructor(
    public readonly errorCode: string,
    message = "PedroCore bloqueou a operacao.",
  ) {
    super(message);
    this.name = "PedroCoreBlockedError";
  }
}

function normalizedBaseUrl(raw: string | undefined): string {
  if (!raw?.trim()) throw new PedroCoreConfigurationError();
  try {
    const url = new URL(raw.trim());
    if (!new Set(["http:", "https:"]).has(url.protocol)) {
      throw new PedroCoreConfigurationError();
    }
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    if (error instanceof PedroCoreConfigurationError) throw error;
    throw new PedroCoreConfigurationError();
  }
}

export function pedroCoreConfigFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PedroCoreClientConfig {
  const apiKey = environment.PEDROCORE_ELYRA_API_KEY?.trim();
  if (!apiKey) throw new PedroCoreConfigurationError();

  const rawMode = environment.PEDROCORE_PROVIDER_MODE?.trim().toLowerCase() ?? "mock";
  if (rawMode !== "mock" && rawMode !== "auto") {
    throw new PedroCoreConfigurationError();
  }
  const providerMode: ElyraProviderMode = rawMode;
  if (
    providerMode === "auto" &&
    (environment.PEDROCORE_ALLOW_REAL_PROVIDER !== "true" ||
      environment.ELYRA_RUNTIME_ENV === "production")
  ) {
    throw new PedroCoreConfigurationError();
  }

  const declaredTimeout = environment.PEDROCORE_TIMEOUT_MS?.trim();
  const timeoutMs = Number(declaredTimeout ?? DEFAULT_TIMEOUT_MS);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new PedroCoreConfigurationError();
  }

  return {
    baseUrl: normalizedBaseUrl(environment.PEDROCORE_BASE_URL),
    apiKey,
    providerMode,
    timeoutMs,
    /*
      Sem declaracao explicita, cada rota usa o seu proprio default: 8 s para a
      textual, 30 s para a multimodal — alinhado com o limite do servico.

      Com declaracao explicita, o valor declarado vale para as duas. Um
      `Math.max` aqui pareceria prudente e seria o mesmo defeito de sempre:
      ignorar em silencio uma configuracao que alguem escreveu de proposito.
    */
    multimodalTimeoutMs: declaredTimeout ? timeoutMs : MULTIMODAL_TIMEOUT_MS,
  };
}

export function buildElyraOrchestrateRequest(
  input: ElyraTextualInput,
  correlationId: string,
  idempotencyKey: string,
  providerMode: ElyraProviderMode,
): ElyraOrchestrateRequest {
  const context = elyraTextualInputSchema.parse(input);
  return elyraOrchestrateRequestSchema.parse({
    message: ELYRA_TEXTUAL_MESSAGE,
    mode: "tecnico",
    provider: providerMode,
    model: null,
    task_type: ELYRA_TEXTUAL_TASK,
    origin_system: ELYRA_ORIGIN_SYSTEM,
    allow_real_provider: providerMode === "auto",
    allow_mock_fallback: providerMode === "mock",
    correlation_id: correlationId,
    idempotency_key: idempotencyKey,
    context,
  });
}

/**
 * Monta a request multimodal. A politica de provider e a mesma da textual:
 * mock deterministico por padrao, provider real somente opt-in e **sem**
 * fallback silencioso — cair em mock nao e sucesso.
 */
export function buildElyraMultimodalRequest(
  input: ElyraMultimodalInput,
  correlationId: string,
  idempotencyKey: string,
  providerMode: ElyraProviderMode,
): ElyraMultimodalOrchestrateRequest {
  const context = elyraMultimodalInputSchema.parse(input);
  return elyraMultimodalOrchestrateRequestSchema.parse({
    message: ELYRA_MULTIMODAL_MESSAGE,
    mode: "tecnico",
    provider: providerMode,
    model: null,
    task_type: ELYRA_MULTIMODAL_TASK,
    origin_system: ELYRA_ORIGIN_SYSTEM,
    allow_real_provider: providerMode === "auto",
    allow_mock_fallback: providerMode === "mock",
    correlation_id: correlationId,
    idempotency_key: idempotencyKey,
    context,
  });
}

/**
 * Monta a request de learning governado.
 *
 * Diferente das outras duas capabilities, aqui o provider e fixo: `mock` sem
 * provider real e **sem** fallback. Governanca nao consulta modelo — consultar
 * um seria transformar uma decisao deterministica em opiniao.
 */
export function buildElyraLearningRequest(
  context: ElyraLearningSubmission | ElyraLearningRevocation,
  correlationId: string,
  idempotencyKey: string,
): ElyraLearningOrchestrateRequest {
  const validated =
    context.operation === SUBMIT_OPERATION
      ? elyraLearningSubmissionSchema.parse(context)
      : elyraLearningRevocationSchema.parse(context);

  return elyraLearningOrchestrateRequestSchema.parse({
    message: ELYRA_LEARNING_MESSAGE,
    mode: "tecnico",
    provider: "mock",
    model: null,
    task_type: ELYRA_LEARNING_TASK,
    origin_system: ELYRA_ORIGIN_SYSTEM,
    allow_real_provider: false,
    allow_mock_fallback: false,
    correlation_id: correlationId,
    idempotency_key: idempotencyKey,
    context: validated,
  });
}

export class ElyraPedroCoreClient {
  constructor(
    private readonly config: PedroCoreClientConfig,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  /**
   * Transporte unico das duas capabilities.
   *
   * Timeout sem retry, `cache: no-store`, credencial server-only e traducao de
   * bloqueio para erro tipado. Nada aqui conhece o contrato: quem chama valida
   * o corpo. Assim as duas capabilities compartilham disciplina de rede sem
   * compartilhar contrato.
   */
  private async dispatch(
    payload: unknown,
    /**
     * Orcamento desta chamada.
     *
     * Explicito por parametro, e nao lido de `config`, porque as duas rotas
     * tem ritmos diferentes: a textual e curta e a multimodal carrega uma
     * sessao inteira. Um unico numero serviria mal as duas — curto demais
     * derruba a multimodal antes do servico responder, longo demais esconde
     * uma rota textual degradada.
     */
    budgetMs: number = this.config.timeoutMs,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), budgetMs);

    let response: Response;
    try {
      response = await this.fetcher(
        `${this.config.baseUrl}/api/orchestrate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            [PEDROCORE_API_KEY_HEADER]: this.config.apiKey,
          },
          body: JSON.stringify(payload),
          cache: "no-store",
          signal: controller.signal,
        },
      );
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new PedroCoreTimeoutError();
      }
      throw new PedroCoreUnavailableError();
    } finally {
      globalThis.clearTimeout(timeout);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new PedroCoreContractError();
    }

    if (!response.ok) {
      const blocked = elyraOrchestrateErrorSchema.safeParse(body);
      if (blocked.success) {
        throw new PedroCoreBlockedError(
          blocked.data.error_code,
          blocked.data.blocked_reason,
        );
      }
      throw new PedroCoreContractError();
    }

    return body;
  }

  /**
   * Confere que a resposta corresponde ao MODO pedido, sem escolher provider.
   *
   * - `mock`: exatamente o mock deterministico.
   * - `auto`: inferencia real, de qualquer provider que o Veltrix tenha
   *   selecionado. Qual provider externo atende e decisao do Veltrix
   *   (catalogo, homologacao e matriz de autorizacao do projeto `elyra`);
   *   a Elyra nao conhece a lista e nao autoriza pelo nome (ADR-0034).
   *
   * Sem isto, "mock respondeu quando o real foi pedido" passaria como sucesso —
   * exatamente o fallback silencioso que a V1 proibe. O formato de
   * `provider_used`/`model` e os pseudo-providers ja foram recusados pelo
   * schema; aqui fica a regra que depende do modo.
   */
  private assertProviderMatches(outcome: {
    provider_used: string;
    model: string;
    fallback_used: boolean;
  }): void {
    const isMock =
      outcome.provider_used === PEDROCORE_MOCK_PROVIDER ||
      outcome.model === PEDROCORE_MOCK_MODEL;
    const matches =
      this.config.providerMode === "mock"
        ? outcome.provider_used === PEDROCORE_MOCK_PROVIDER &&
          outcome.model === PEDROCORE_MOCK_MODEL
        : !isMock;
    if (!matches || outcome.fallback_used) {
      throw new PedroCoreContractError("ELYRA_PROVIDER_MISMATCH");
    }
  }

  async interpretDeterministicReport(
    input: ElyraTextualInput,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<ElyraOrchestrateSuccess> {
    const payload = buildElyraOrchestrateRequest(
      input,
      correlationId,
      idempotencyKey,
      this.config.providerMode,
    );
    const body = await this.dispatch(payload);

    const parsed = elyraOrchestrateSuccessSchema.safeParse(body);
    if (!parsed.success) throw new PedroCoreContractError();
    const outcome = parsed.data;

    if (
      outcome.correlation_id !== correlationId ||
      outcome.elyra.correlationId !== correlationId ||
      outcome.elyra.contractVersion !== ELYRA_TEXTUAL_CONTRACT_VERSION ||
      outcome.elyra.operation !== ELYRA_TEXTUAL_OPERATION ||
      outcome.answer !== outcome.elyra.summary ||
      outcome.provider_requested !== payload.provider
    ) {
      throw new PedroCoreContractError();
    }

    this.assertProviderMatches(outcome);

    return outcome;
  }

  /**
   * Interpreta os sinais observaveis de uma sessao.
   *
   * `input` ja chega minimizado por `buildMultimodalInput`: sem midia, sem
   * caminho de Storage e sem identificador de pessoa usuaria. A resposta so e
   * aceita se a projecao tipada vier completa, com a correlacao pedida e com o
   * provider que a politica selecionou.
   */
  async interpretSessionSignals(
    input: ElyraMultimodalInput,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<ElyraMultimodalOrchestrateSuccess> {
    const payload = buildElyraMultimodalRequest(
      input,
      correlationId,
      idempotencyKey,
      this.config.providerMode,
    );
    /*
      A rota multimodal espera ate o limite do proprio servico. Desistir antes
      disso descartaria uma sessao inteira por um relogio mal ajustado, e nao
      por uma falha real do Veltrix.

      Um `PEDROCORE_TIMEOUT_MS` configurado acima disso continua valendo: quem
      declarou um orcamento maior deliberadamente nao e sobrescrito por um
      default.
    */
    const body = await this.dispatch(
      payload,
      this.config.multimodalTimeoutMs ?? this.config.timeoutMs,
    );

    const parsed = elyraMultimodalOrchestrateSuccessSchema.safeParse(body);
    if (!parsed.success) throw new PedroCoreContractError();
    const outcome = parsed.data;

    if (
      outcome.correlation_id !== correlationId ||
      outcome.elyra_multimodal.correlationId !== correlationId ||
      outcome.elyra_multimodal.contractVersion !==
        ELYRA_MULTIMODAL_CONTRACT_VERSION ||
      outcome.elyra_multimodal.operation !== ELYRA_MULTIMODAL_OPERATION ||
      outcome.answer !== outcome.elyra_multimodal.summary ||
      outcome.provider_requested !== payload.provider
    ) {
      throw new PedroCoreContractError();
    }

    this.assertProviderMatches(outcome);

    return outcome;
  }

  /**
   * Envia uma operacao governada de learning e devolve o recibo tipado.
   *
   * O recibo nunca traz o payload submetido: so o estado de governanca. E o
   * cliente recusa qualquer resposta que declare treino iniciado ou pesos
   * atualizados — a V1 nao treina, e isso e verificado, nao assumido.
   */
  private async dispatchLearning(
    context: ElyraLearningSubmission | ElyraLearningRevocation,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<ElyraLearningReceipt> {
    const payload = buildElyraLearningRequest(
      context,
      correlationId,
      idempotencyKey,
    );
    const body = await this.dispatch(payload);

    const parsed = elyraLearningOrchestrateSuccessSchema.safeParse(body);
    if (!parsed.success) throw new PedroCoreContractError();
    const outcome = parsed.data;
    const receipt = outcome.elyra_learning;

    if (
      outcome.correlation_id !== correlationId ||
      receipt.correlationId !== correlationId ||
      receipt.contractVersion !== ELYRA_LEARNING_CONTRACT_VERSION ||
      receipt.operation !== context.operation
    ) {
      throw new PedroCoreContractError();
    }

    // Redundante com o schema, e deliberadamente redundante: e a afirmacao

    if (receipt.trainingStarted || receipt.modelWeightsUpdated) {
      throw new PedroCoreContractError("ELYRA_LEARNING_TRAINING_NOT_ALLOWED");
    }

    return receipt;
  }

  async submitLearningCandidate(
    submission: ElyraLearningSubmission,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<ElyraLearningReceipt> {
    return this.dispatchLearning(submission, correlationId, idempotencyKey);
  }

  async revokeLearningCandidate(
    revocation: ElyraLearningRevocation,
    correlationId: string,
    idempotencyKey: string,
  ): Promise<ElyraLearningReceipt> {
    if (revocation.operation !== REVOKE_OPERATION) {
      throw new PedroCoreContractError();
    }
    return this.dispatchLearning(revocation, correlationId, idempotencyKey);
  }
}

export function createElyraTextualInput(
  report: unknown,
): ElyraTextualInput {
  return elyraTextualInputSchema.parse({
    contractVersion: ELYRA_TEXTUAL_CONTRACT_VERSION,
    inputSchemaVersion: ELYRA_TEXTUAL_INPUT_VERSION,
    operation: ELYRA_TEXTUAL_OPERATION,
    aiInferenceConsent: true,
    report,
  });
}
