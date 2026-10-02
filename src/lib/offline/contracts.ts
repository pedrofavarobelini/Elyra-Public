

/* -------------------------------------------------------------------------
   Estados
   ------------------------------------------------------------------------- */

/** Estado de uma entidade do ponto de vista da sincronizacao. */
export const SYNC_STATE = {
  LOCAL_ONLY: "LOCAL_ONLY",
  PENDING_SYNC: "PENDING_SYNC",
  SYNCING: "SYNCING",
  SYNCED: "SYNCED",
  CONFLICT: "CONFLICT",
  SYNC_FAILED: "SYNC_FAILED",
} as const;
export type SyncState = (typeof SYNC_STATE)[keyof typeof SYNC_STATE];

/** Estado persistido de uma operacao na outbox. */
export const OUTBOX_STATUS = {
  PENDING: "PENDING",
  SYNCING: "SYNCING",
  FAILED: "FAILED",
  CONFLICT: "CONFLICT",
} as const;
export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

export const OUTBOX_KIND = {
  CREATE: "CREATE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
} as const;
export type OutboxKind = (typeof OUTBOX_KIND)[keyof typeof OUTBOX_KIND];

export const OUTBOX_DOMAIN = {
  JOURNAL: "journal",
  CHECKIN: "checkin",
  SLEEP: "sleep",
  GOAL: "goal",
  GOAL_PROGRESS: "goal_progress",
  CYCLE_RECORD: "cycle_record",
} as const;
export type OutboxDomain = (typeof OUTBOX_DOMAIN)[keyof typeof OUTBOX_DOMAIN];

export const CONNECTIVITY = {
  ONLINE: "ONLINE",
  OFFLINE: "OFFLINE",
  AUTH_REQUIRED: "AUTH_REQUIRED",
} as const;
export type Connectivity = (typeof CONNECTIVITY)[keyof typeof CONNECTIVITY];

/* -------------------------------------------------------------------------
   Limites
   ------------------------------------------------------------------------- */

/** Dias desde a ultima verificacao online em que o shell abre o nucleo pessoal. */
export const OFFLINE_GRACE_DAYS = 14;
/** Tentativas para erro transitorio de servidor (queda de rede nao conta). */
export const MAX_SERVER_ATTEMPTS = 8;
export const SEND_TIMEOUT_MS = 15_000;
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 5 * 60_000;
export const OFFLINE_SCHEMA_VERSION = 2;

/* -------------------------------------------------------------------------
   Registros persistidos
   ------------------------------------------------------------------------- */

export interface OutboxRequest {
  path: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  body: Record<string, unknown>;
}

export interface OutboxError {
  /** Codigo tecnico; nunca conteudo pessoal. */
  code: string;
  status: number | null;
}

export interface OutboxOperation {
  id: string;
  userId: string;
  domain: OutboxDomain;
  kind: OutboxKind;
  /** ID estavel da entidade ou chave natural (noite, data). */
  entityId: string;
  /** Entidade da qual esta depende (ex.: progresso → meta criada offline). */
  dependsOn: string | null;
  request: OutboxRequest;
  /** Ordem FIFO estrita por usuario (monotonica); `createdAt` e informativo. */
  sequence: number;
  createdAt: string;
  attempts: number;
  serverAttempts: number;
  nextAttemptAt: string;
  status: OutboxStatus;
  lastError: OutboxError | null;
  /** Versao do servidor quando houve conflito (para resolucao). */
  conflictCurrent: unknown;
}

export interface DeviceRecord {
  key: "current";
  userId: string;
  displayName: string;
  initials: string;
  /** Ultima abertura autenticada online neste aparelho. */
  verifiedAt: string;
  schemaVersion: number;
  /** Lock esperado no shell. Se existir sem verificador, o offline falha fechado. */
  appLockId?: string | null;
}

/** Ultimo estado local do nucleo pessoal (cache de leitura). */
export interface PersonalSnapshot {
  userId: string;
  savedAt: string;
  data: Record<string, unknown>;
}

/* -------------------------------------------------------------------------
   Regras puras
   ------------------------------------------------------------------------- */

/** O shell pode abrir o nucleo pessoal deste aparelho? */
export function canOpenOffline(
  device: DeviceRecord | null,
  now: Date = new Date(),
): boolean {
  if (!device) return false;
  const verified = Date.parse(device.verifiedAt);
  if (Number.isNaN(verified)) return false;
  const ageMs = now.getTime() - verified;
  return ageMs >= 0 && ageMs <= OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000;
}

/** Espera antes da proxima tentativa: exponencial, teto de 5 min, jitter de ±20%. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(Math.min(BACKOFF_MAX_MS, base * jitter));
}

export const SEND_OUTCOME = {
  ACK: "ACK",
  NETWORK: "NETWORK",
  AUTH: "AUTH",
  CONFLICT: "CONFLICT",
  PERMANENT: "PERMANENT",
  TRANSIENT: "TRANSIENT",
} as const;
export type SendOutcome = (typeof SEND_OUTCOME)[keyof typeof SEND_OUTCOME];


export function classifySend(status: number | null, kind: OutboxKind): SendOutcome {
  if (status === null) return SEND_OUTCOME.NETWORK;
  if (status >= 200 && status < 300) return SEND_OUTCOME.ACK;
  if (status === 401 || status === 403) return SEND_OUTCOME.AUTH;
  if (status === 409) return SEND_OUTCOME.CONFLICT;
  if (status === 404) {
    return kind === OUTBOX_KIND.DELETE ? SEND_OUTCOME.ACK : SEND_OUTCOME.CONFLICT;
  }
  if (status === 408 || status === 429 || status >= 500) return SEND_OUTCOME.TRANSIENT;
  return SEND_OUTCOME.PERMANENT;
}

/* -------------------------------------------------------------------------
   Impressao digital de conteudo (base de conflito)
   ------------------------------------------------------------------------- */

/** JSON canonico: chaves ordenadas, arrays preservados na ordem recebida. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/**
 * SHA-256 do JSON canonico. Mesma funcao no navegador e no servidor (Web Crypto
 * em ambos): o cliente envia a impressao do estado em que a edicao comecou, e o
 * servidor compara com a impressao do estado atual.
 */
export async function fingerprint(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* Campos que definem o conteudo de cada entidade editavel offline. */

export function journalContent(entry: {
  title: string;
  content: string;
  status: string;
  tagIds: readonly string[];
}) {
  return {
    title: entry.title,
    content: entry.content,
    status: entry.status,
    tagIds: [...entry.tagIds].sort(),
  };
}

export function sleepContent(record: {
  durationMinutes: number | null;
  quality: number | null;
}) {
  return { durationMinutes: record.durationMinutes, quality: record.quality };
}

export function cycleRecordContent(record: {
  flow: string | null;
  note: string | null;
  symptoms: readonly { symptomId: string; severity: string }[];
}) {
  return {
    flow: record.flow,
    note: record.note,
    symptoms: [...record.symptoms]
      .map((item) => ({ symptomId: item.symptomId, severity: item.severity }))
      .sort((a, b) => (a.symptomId < b.symptomId ? -1 : a.symptomId > b.symptomId ? 1 : 0)),
  };
}

export function goalStatusContent(goal: { status: string }) {
  return { status: goal.status };
}

/**
 * Conteudo da edicao de meta (OFF-2, L-408): titulo, alvo, unidade **e** status.
 * O status entra na base para que editar uma meta concluida/cancelada em outro
 * aparelho vire conflito visivel, e nao sobrescrita.
 */
export function goalEditContent(goal: { title: string; target: number; unit: string | null; status: string }) {
  return { title: goal.title.trim(), target: goal.target, unit: goal.unit?.trim() || null, status: goal.status };
}
