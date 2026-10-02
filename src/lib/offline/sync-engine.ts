import {
  MAX_SERVER_ATTEMPTS,
  OUTBOX_STATUS,
  SEND_OUTCOME,
  SEND_TIMEOUT_MS,
  backoffDelay,
  classifySend,
  type OutboxDomain,
  type OutboxKind,
  type OutboxOperation,
  type OutboxRequest,
} from "@/lib/offline/contracts";
import type { OfflineStore } from "@/lib/offline/db";



export interface SendResult {
  /** `null` quando nada voltou (rede, timeout, abort). */
  status: number | null;
  body: unknown;
}

export type Sender = (request: OutboxRequest, signal: AbortSignal) => Promise<SendResult>;

export const DRAIN_RESULT = {
  IDLE: "IDLE",
  OFFLINE: "OFFLINE",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  BUSY: "BUSY",
} as const;
export type DrainOutcome = (typeof DRAIN_RESULT)[keyof typeof DRAIN_RESULT];

export interface DrainResult {
  outcome: DrainOutcome;
  acknowledged: number;
  /** Proximo prazo de retry agendado, se houver. */
  nextAttemptAt: string | null;
}

export interface SyncEngineOptions {
  store: OfflineStore;
  userId: string;
  send: Sender;
  /** Chamado a cada ACK com a resposta do servidor, para reconciliar estado local. */
  onAck?: (operation: OutboxOperation, body: unknown) => void | Promise<void>;
  onChange?: () => void;
  now?: () => Date;
  random?: () => number;
  timeoutMs?: number;
}

/** Transporte padrao: mesmo fetch das acoes online, com timeout. */
export const fetchSender: Sender = async (request, signal) => {
  try {
    const response = await fetch(request.path, {
      method: request.method,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(request.body),
      signal,
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch {
    return { status: null, body: null };
  }
};

export function createSyncEngine(options: SyncEngineOptions) {
  const { store, userId, send } = options;
  const now = options.now ?? (() => new Date());
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? SEND_TIMEOUT_MS;
  let running = false;

  async function sendWithTimeout(request: OutboxRequest): Promise<SendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await send(request, controller.signal);
    } catch {
      return { status: null, body: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async function drain(): Promise<DrainResult> {
    if (running) return { outcome: DRAIN_RESULT.BUSY, acknowledged: 0, nextAttemptAt: null };
    running = true;
    let acknowledged = 0;
    try {
      const operations = await store.listOutbox(userId);
      const blocked = new Set<string>();
      let nextAttemptAt: string | null = null;

      for (const operation of operations) {
        const chainBlocked =
          blocked.has(operation.entityId) ||
          (operation.dependsOn !== null && blocked.has(operation.dependsOn));

        if (
          operation.status === OUTBOX_STATUS.CONFLICT ||
          operation.status === OUTBOX_STATUS.FAILED ||
          chainBlocked
        ) {
          blocked.add(operation.entityId);
          continue;
        }

        const current = now();
        if (Date.parse(operation.nextAttemptAt) > current.getTime()) {
          // Ainda em espera: nada depois dela, da mesma entidade, pode passar.
          blocked.add(operation.entityId);
          if (!nextAttemptAt || operation.nextAttemptAt < nextAttemptAt) {
            nextAttemptAt = operation.nextAttemptAt;
          }
          continue;
        }

        await store.putOperation({ ...operation, status: OUTBOX_STATUS.SYNCING });
        options.onChange?.();
        const result = await sendWithTimeout(operation.request);
        const outcome = classifySend(result.status, operation.kind);
        const attempts = operation.attempts + 1;

        /*
          A operacao pode ter sido removida durante o envio (logout, descarte,
          exclusao de conta). Regrava-la aqui ressuscitaria dado que a pessoa
          mandou apagar: so o ACK ainda e aplicado, e nada mais volta a fila.
        */
        const stillQueued = (await store.listOutbox(userId)).some((item) => item.id === operation.id);
        if (!stillQueued) {
          if (outcome === SEND_OUTCOME.ACK) {
            acknowledged += 1;
            await options.onAck?.(operation, result.body);
          }
          options.onChange?.();
          continue;
        }

        if (outcome === SEND_OUTCOME.ACK) {
          await store.deleteOperation(operation.id);
          acknowledged += 1;
          await options.onAck?.(operation, result.body);
          options.onChange?.();
          continue;
        }

        if (outcome === SEND_OUTCOME.NETWORK) {
          const retryAt = new Date(current.getTime() + backoffDelay(attempts, random)).toISOString();
          await store.putOperation({
            ...operation,
            status: OUTBOX_STATUS.PENDING,
            attempts,
            nextAttemptAt: retryAt,
            lastError: { code: "network", status: null },
          });
          options.onChange?.();
          return { outcome: DRAIN_RESULT.OFFLINE, acknowledged, nextAttemptAt: retryAt };
        }

        if (outcome === SEND_OUTCOME.AUTH) {
          await store.putOperation({
            ...operation,
            status: OUTBOX_STATUS.PENDING,
            attempts,
            lastError: { code: "auth_required", status: result.status },
          });
          options.onChange?.();
          return { outcome: DRAIN_RESULT.AUTH_REQUIRED, acknowledged, nextAttemptAt: null };
        }

        if (outcome === SEND_OUTCOME.CONFLICT) {
          await store.putOperation({
            ...operation,
            status: OUTBOX_STATUS.CONFLICT,
            attempts,
            lastError: { code: result.status === 404 ? "entity_gone" : "conflict", status: result.status },
            conflictCurrent: extractConflict(result.body),
          });
          blocked.add(operation.entityId);
          options.onChange?.();
          continue;
        }

        if (outcome === SEND_OUTCOME.PERMANENT) {
          await store.putOperation({
            ...operation,
            status: OUTBOX_STATUS.FAILED,
            attempts,
            lastError: { code: "rejected", status: result.status },
          });
          blocked.add(operation.entityId);
          options.onChange?.();
          continue;
        }

        // TRANSIENT
        const serverAttempts = operation.serverAttempts + 1;
        if (serverAttempts >= MAX_SERVER_ATTEMPTS) {
          await store.putOperation({
            ...operation,
            status: OUTBOX_STATUS.FAILED,
            attempts,
            serverAttempts,
            lastError: { code: "server_unavailable", status: result.status },
          });
        } else {
          const retryAt = new Date(current.getTime() + backoffDelay(serverAttempts, random)).toISOString();
          await store.putOperation({
            ...operation,
            status: OUTBOX_STATUS.PENDING,
            attempts,
            serverAttempts,
            nextAttemptAt: retryAt,
            lastError: { code: "server_unavailable", status: result.status },
          });
          if (!nextAttemptAt || retryAt < nextAttemptAt) nextAttemptAt = retryAt;
        }
        blocked.add(operation.entityId);
        options.onChange?.();
      }

      return { outcome: DRAIN_RESULT.IDLE, acknowledged, nextAttemptAt };
    } finally {
      running = false;
    }
  }

  return { drain };
}

function extractConflict(body: unknown): unknown {
  if (body && typeof body === "object" && "conflict" in body) {
    return (body as { conflict: unknown }).conflict ?? null;
  }
  return null;
}

/* -------------------------------------------------------------------------
   Criacao de operacoes
   ------------------------------------------------------------------------- */

/**
 * Enfileira com sequencia estritamente maior que a de qualquer operacao do
 * usuario. Duas acoes no mesmo milissegundo continuam em ordem.
 */
export async function enqueue(
  store: OfflineStore,
  input: Omit<Parameters<typeof newOperation>[0], "sequence">,
): Promise<OutboxOperation> {
  const existing = await store.listOutbox(input.userId);
  const last = existing.length > 0 ? existing[existing.length - 1]!.sequence : 0;
  const sequence = Math.max(last + 1, Date.now());
  const operation = newOperation({ ...input, sequence });
  await store.putOperation(operation);
  return operation;
}

export function newOperation(input: {
  sequence: number;
  userId: string;
  domain: OutboxDomain;
  kind: OutboxKind;
  entityId: string;
  dependsOn?: string | null;
  request: OutboxRequest;
  now?: Date;
  id?: string;
}): OutboxOperation {
  const at = (input.now ?? new Date()).toISOString();
  return {
    id: input.id ?? globalThis.crypto.randomUUID(),
    userId: input.userId,
    domain: input.domain,
    kind: input.kind,
    entityId: input.entityId,
    dependsOn: input.dependsOn ?? null,
    request: input.request,
    sequence: input.sequence,
    createdAt: at,
    attempts: 0,
    serverAttempts: 0,
    nextAttemptAt: at,
    status: OUTBOX_STATUS.PENDING,
    lastError: null,
    conflictCurrent: null,
  };
}
