import {
  CONNECTIVITY,
  OFFLINE_SCHEMA_VERSION,
  OUTBOX_KIND,
  OUTBOX_STATUS,
  SEND_TIMEOUT_MS,
  cycleRecordContent,
  fingerprint,
  goalStatusContent,
  journalContent,
  sleepContent,
  type Connectivity,
  type OutboxDomain,
  type OutboxKind,
  type OutboxOperation,
  type OutboxRequest,
  type PersonalSnapshot,
} from "@/lib/offline/contracts";
import {
  OfflineQuotaError,
  OfflineStorageUnavailableError,
  recoverInterrupted,
  type OfflineStore,
} from "@/lib/offline/db";
import {
  DRAIN_RESULT,
  createSyncEngine,
  enqueue,
  fetchSender,
  type Sender,
} from "@/lib/offline/sync-engine";
import { clearDeviceOnLogout } from "@/lib/offline/device-cleanup";
import { clearSupportNetworkCache } from "@/lib/support-network/offline-cache";



export const WRITE_STATUS = { SYNCED: "SYNCED", QUEUED: "QUEUED" } as const;

export type WriteResult =
  | { status: typeof WRITE_STATUS.SYNCED; body: unknown }
  | { status: typeof WRITE_STATUS.QUEUED; operation: OutboxOperation };

export interface WriteSpec {
  domain: OutboxDomain;
  kind: OutboxKind;
  entityId: string;
  dependsOn?: string | null;
  request: OutboxRequest;
  /** Coalesce: edicao seguida da mesma entidade substitui a pendente anterior. */
  coalesce?: boolean;
  /**
   * Campos que so vao quando a escrita entra na fila (ex.: hora/dia da acao).
   * Online, o servidor usa o proprio relogio, como na V1.
   */
  queuedBody?: Record<string, unknown>;
}

export class OfflineWriteUnavailableError extends Error {
  constructor(readonly reason: "storage" | "quota") {
    super(
      reason === "quota"
        ? "Este aparelho está sem espaço para guardar a alteração. O que você escreveu continua na tela."
        : "Sem conexão, e este navegador não permite guardar dados localmente. O que você escreveu continua na tela.",
    );
    this.name = "OfflineWriteUnavailableError";
  }
}

export class OnlineWriteError extends Error {
  /** Em 409, a versao atual no servidor (`conflict` da resposta), para recarregar. */
  constructor(message: string, readonly status: number, readonly conflict: unknown = undefined) {
    super(message);
    this.name = "OnlineWriteError";
  }
}

export interface GatewayState {
  connectivity: Connectivity;
  operations: OutboxOperation[];
  syncing: boolean;
  /** Ultimo drain terminou sem nada pendente. */
  lastSyncedAt: string | null;
  storageAvailable: boolean;
}

type Reconciler = (operation: OutboxOperation, body: unknown) => void;
type Listener = () => void;

export interface GatewayOptions {
  userId: string;
  store: OfflineStore;
  mode: "online" | "shell";
  send?: Sender;
  /** Conectividade real (monitor com histerese): offline confirmado enfileira direto. */
  isOffline?: () => boolean;
  /** Falha de rede vista pela fila: evidencia para o monitor confirmar a queda. */
  onNetworkFailure?: () => void;
}

export function createOfflineGateway(options: GatewayOptions) {
  const { userId, store, mode } = options;
  const send = options.send ?? fetchSender;
  const listeners = new Set<Listener>();
  let reconciler: Reconciler | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let state: GatewayState = {
    connectivity:
      typeof navigator !== "undefined" && navigator.onLine === false
        ? CONNECTIVITY.OFFLINE
        : CONNECTIVITY.ONLINE,
    operations: [],
    syncing: false,
    lastSyncedAt: null,
    storageAvailable: true,
  };

  function emit(patch: Partial<GatewayState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  async function refresh() {
    try {
      emit({ operations: await store.listOutbox(userId), storageAvailable: true });
    } catch (error) {
      if (error instanceof OfflineStorageUnavailableError) emit({ storageAvailable: false });
    }
  }

  const engine = createSyncEngine({
    store,
    userId,
    send,
    onAck: (operation, body) => reconciler?.(operation, body),
    onChange: () => {
      void refresh();
    },
  });

  function scheduleRetry(at: string | null) {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (!at || disposed) return;
    const delay = Math.max(0, Date.parse(at) - Date.now());
    // Um unico timer para o proximo prazo: nunca polling.
    retryTimer = setTimeout(() => void drain(), delay);
  }

  let draining: Promise<void> | null = null;

  function drain(): Promise<void> {
    if (disposed || state.syncing) return draining ?? Promise.resolve();
    draining = runDrain().finally(() => {
      draining = null;
    });
    return draining;
  }

  async function runDrain() {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      emit({ connectivity: CONNECTIVITY.OFFLINE });
      return;
    }
    emit({ syncing: true });
    try {
      const result = await engine.drain();
      await refresh();
      if (result.outcome === DRAIN_RESULT.AUTH_REQUIRED) {
        emit({ connectivity: CONNECTIVITY.AUTH_REQUIRED });
      } else if (result.outcome === DRAIN_RESULT.OFFLINE) {
        emit({ connectivity: CONNECTIVITY.OFFLINE });
        options.onNetworkFailure?.();
      } else if (result.outcome === DRAIN_RESULT.IDLE) {
        emit({
          connectivity: CONNECTIVITY.ONLINE,
          lastSyncedAt: state.operations.length === 0 ? new Date().toISOString() : state.lastSyncedAt,
        });
      }
      scheduleRetry(result.nextAttemptAt);
    } catch (error) {
      if (error instanceof OfflineStorageUnavailableError) emit({ storageAvailable: false });
    } finally {
      emit({ syncing: false });
    }
  }

  async function enqueueOrCoalesce(spec: WriteSpec) {
    const pending = await store.listOutbox(userId);
    const last = pending[pending.length - 1];
    if (
      spec.coalesce &&
      last &&
      last.domain === spec.domain &&
      last.entityId === spec.entityId &&
      last.status === OUTBOX_STATUS.PENDING &&
      last.kind !== OUTBOX_KIND.DELETE &&
      // OFF-2: so junta a mesma operacao (upsert com upsert). Juntar um PATCH de
      // status num POST de criacao pendente apagava a criacao da meta.
      last.request.method === spec.request.method &&
      last.request.path === spec.request.path
    ) {
      // Mantem a base da primeira edicao: o servidor compara com o estado de antes.
      const baseFingerprint = (last.request.body as Record<string, unknown>).baseFingerprint;
      const next: OutboxOperation = {
        ...last,
        request: {
          ...spec.request,
          body:
            baseFingerprint === undefined
              ? spec.request.body
              : { ...spec.request.body, baseFingerprint },
        },
      };
      await store.putOperation(next);
      return next;
    }
    return enqueue(store, { userId, ...spec, dependsOn: spec.dependsOn ?? null });
  }

  async function queue(spec: WriteSpec): Promise<WriteResult> {
    try {
      const { queuedBody, ...rest } = spec;
      const operation = await enqueueOrCoalesce(
        queuedBody
          ? { ...rest, request: { ...rest.request, body: { ...rest.request.body, ...queuedBody } } }
          : rest,
      );
      await refresh();
      requestPersistence();
      void drain();
      return { status: WRITE_STATUS.QUEUED, operation };
    } catch (error) {
      if (error instanceof OfflineQuotaError) throw new OfflineWriteUnavailableError("quota");
      if (error instanceof OfflineStorageUnavailableError) {
        emit({ storageAvailable: false });
        throw new OfflineWriteUnavailableError("storage");
      }
      throw error;
    }
  }

  async function write(spec: WriteSpec): Promise<WriteResult> {
    const offlineNow =
      mode === "shell" ||
      (typeof navigator !== "undefined" && navigator.onLine === false) ||
      options.isOffline?.() === true ||
      state.operations.length > 0;
    if (offlineNow) return queue(spec);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(spec.request.path, {
        method: spec.request.method,
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(spec.request.body),
        signal: controller.signal,
        credentials: "same-origin",
      });
    } catch {
      // A requisicao pode ter chegado e a resposta nao: a fila reenvia com o
      // mesmo ID, e o servidor reconhece.
      options.onNetworkFailure?.();
      return queue(spec);
    } finally {
      clearTimeout(timer);
    }
    const payload = (await response.json().catch(() => null)) as { data?: unknown; error?: string; conflict?: unknown } | null;
    if (!response.ok || !payload || payload.data === undefined) {
      throw new OnlineWriteError(payload?.error ?? "Não foi possível salvar.", response.status, payload?.conflict);
    }
    return { status: WRITE_STATUS.SYNCED, body: payload };
  }

  let persistenceRequested = false;
  function requestPersistence() {
    if (persistenceRequested) return;
    persistenceRequested = true;
    // So quando ha dado a proteger; recusa nao muda o funcionamento.
    void navigator.storage?.persist?.().catch(() => undefined);
  }

  /* ---------------- resolucao ---------------- */

  async function updateOperation(id: string, change: (op: OutboxOperation) => OutboxOperation | null) {
    const operation = (await store.listOutbox(userId)).find((item) => item.id === id);
    if (!operation) return null;
    const next = change(operation);
    if (next) await store.putOperation(next);
    else await store.deleteOperation(id);
    await refresh();
    return operation;
  }

  async function retry(id: string) {
    await updateOperation(id, (op) => ({
      ...op,
      status: OUTBOX_STATUS.PENDING,
      serverAttempts: 0,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
    }));
    void drain();
  }

  /** Descarta a alteracao local; a versao do servidor (se houver) entra na base. */
  async function discard(id: string) {
    const operation = await updateOperation(id, () => null);
    if (operation?.conflictCurrent) {
      reconciler?.(operation, { data: operation.conflictCurrent });
    }
    void drain();
  }

  /** Reenvia a minha versao tendo a versao atual do servidor como base. */
  async function keepMine(id: string) {
    const operation = (await store.listOutbox(userId)).find((item) => item.id === id);
    if (!operation) return;
    const current = operation.conflictCurrent as Record<string, unknown> | null;
    const base = current ? await fingerprint(contentOf(operation.domain, current)) : null;
    await updateOperation(id, (op) => ({
      ...op,
      status: OUTBOX_STATUS.PENDING,
      attempts: 0,
      serverAttempts: 0,
      nextAttemptAt: new Date().toISOString(),
      lastError: null,
      conflictCurrent: null,
      request: { ...op.request, body: { ...op.request.body, baseFingerprint: base } },
    }));
    void drain();
  }

  /** Diario: guarda a minha versao como anotacao nova e aceita a do servidor. */
  async function keepBoth(id: string) {
    const operation = (await store.listOutbox(userId)).find((item) => item.id === id);
    if (!operation) return;
    const body = operation.request.body as Record<string, unknown>;
    const copyId = globalThis.crypto.randomUUID();
    await store.deleteOperation(id);
    if (operation.conflictCurrent) reconciler?.(operation, { data: operation.conflictCurrent });
    await enqueue(store, {
      userId,
      domain: operation.domain,
      kind: OUTBOX_KIND.CREATE,
      entityId: copyId,
      request: {
        path: operation.request.path,
        method: operation.request.method,
        body: {
          ...body,
          id: copyId,
          title: `${String(body.title ?? "").trim() || "Sem título"} (cópia deste aparelho)`.slice(0, 120),
          baseFingerprint: null,
        },
      },
    });
    await refresh();
    void drain();
  }

  /* ---------------- ciclo de vida ---------------- */

  const onOnline = () => {
    emit({ connectivity: CONNECTIVITY.ONLINE });
    void drain();
  };
  const onOffline = () => emit({ connectivity: CONNECTIVITY.OFFLINE });
  const onVisible = () => {
    if (document.visibilityState === "visible") void drain();
  };

  async function start() {
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      document.addEventListener("visibilitychange", onVisible);
    }
    try {
      await recoverInterrupted(store, userId);
    } catch (error) {
      if (error instanceof OfflineStorageUnavailableError) emit({ storageAvailable: false });
    }
    await refresh();
    void drain();
  }

  function dispose() {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (typeof window !== "undefined") {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    }
  }

  /* ---------------- snapshot e identidade ---------------- */

  async function markVerified(identity: { displayName: string; initials: string }) {
    if (disposed) return;
    try {
      const previous = await store.getDevice();
      if (disposed) return;
      if (previous && previous.userId !== userId) {
        // Outra pessoa neste navegador: o snapshot dela sai; a fila dela fica
        // isolada ate ela voltar (Local-Data-Policy). A ultima lista da Rede de
        // Apoio (municipio consultado) tambem sai (OFF-4).
        await store.deleteSnapshot(previous.userId);
        clearSupportNetworkCache();
      }
      await store.putDevice({
        key: "current",
        userId,
        displayName: identity.displayName,
        initials: identity.initials,
        verifiedAt: new Date().toISOString(),
        schemaVersion: OFFLINE_SCHEMA_VERSION,
        appLockId: previous?.userId === userId ? (previous.appLockId ?? null) : null,
      });
      // Uma leitura iniciada antes do logout pode terminar depois da limpeza.
      if (disposed) {
        const current = await store.getDevice();
        if (current?.userId === userId) await store.deleteDevice();
      }
    } catch {
      emit({ storageAvailable: false });
    }
  }

  async function saveSnapshot(data: Record<string, unknown>) {
    if (disposed) return;
    const snapshot: PersonalSnapshot = { userId, savedAt: new Date().toISOString(), data };
    try {
      await store.putSnapshot(snapshot);
      // Fecha a corrida entre uma gravacao em voo e `clearLocal()`.
      if (disposed) await store.deleteSnapshot(userId);
    } catch {
      // Sem espaco ou sem IndexedDB: o app online segue; o shell offline so nao
      // tera o estado mais recente.
    }
  }

  /** Logout / exclusao de conta: apaga o que e desta pessoa neste aparelho. */
  async function clearLocal() {
    // Para tudo antes de apagar: nenhum envio em curso pode regravar a fila.
    dispose();
    await draining?.catch(() => undefined);
    await clearDeviceOnLogout({ userId, store });
    await refresh();
  }

  return {
    mode,
    userId,
    write,
    drain,
    retry,
    discard,
    keepMine,
    keepBoth,
    start,
    dispose,
    markVerified,
    saveSnapshot,
    clearLocal,
    setReconciler(next: Reconciler | null) {
      reconciler = next;
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
  };
}

export type OfflineGateway = ReturnType<typeof createOfflineGateway>;

/** Conteudo comparavel por dominio (base de conflito). */
export function contentOf(domain: OutboxDomain, entity: Record<string, unknown>): unknown {
  switch (domain) {
    case "journal":
      return journalContent(entity as Parameters<typeof journalContent>[0]);
    case "sleep":
      return sleepContent(entity as Parameters<typeof sleepContent>[0]);
    case "cycle_record":
      return cycleRecordContent(entity as Parameters<typeof cycleRecordContent>[0]);
    case "goal":
      return goalStatusContent(entity as Parameters<typeof goalStatusContent>[0]);
    default:
      return entity;
  }
}
