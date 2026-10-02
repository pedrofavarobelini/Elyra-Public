import {
  OFFLINE_SCHEMA_VERSION,
  OUTBOX_STATUS,
  type DeviceRecord,
  type OutboxOperation,
  type PersonalSnapshot,
} from "@/lib/offline/contracts";
import type { LocalAppLockRecord } from "@/lib/app-lock/contracts";



export const OFFLINE_DB_NAME = "elyra-offline";

export class OfflineStorageUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("offline_storage_unavailable");
    this.name = "OfflineStorageUnavailableError";
    this.cause = cause;
  }
}

export class OfflineQuotaError extends Error {
  constructor(cause?: unknown) {
    super("offline_storage_quota_exceeded");
    this.name = "OfflineQuotaError";
    this.cause = cause;
  }
}

export interface OfflineStore {
  getDevice(): Promise<DeviceRecord | null>;
  putDevice(device: DeviceRecord): Promise<void>;

  setDeviceAppLockId(userId: string, appLockId: string | null): Promise<void>;
  deleteDevice(): Promise<void>;
  getSnapshot(userId: string): Promise<PersonalSnapshot | null>;
  putSnapshot(snapshot: PersonalSnapshot): Promise<void>;
  deleteSnapshot(userId: string): Promise<void>;
  /** Operacoes do usuario em ordem FIFO (`sequence`). */
  listOutbox(userId: string): Promise<OutboxOperation[]>;
  putOperation(operation: OutboxOperation): Promise<void>;
  deleteOperation(id: string): Promise<void>;
  deleteOutbox(userId: string): Promise<void>;
  getAppLock(userId: string): Promise<LocalAppLockRecord | null>;
  putAppLock(record: LocalAppLockRecord): Promise<void>;
  deleteAppLock(userId: string): Promise<void>;
}

function fifo(a: OutboxOperation, b: OutboxOperation) {
  return a.sequence - b.sequence;
}

function isQuotaError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "QuotaExceededError"
  );
}

/* -------------------------------------------------------------------------
   Memoria (testes e fallback de leitura)
   ------------------------------------------------------------------------- */

export function createMemoryStore(): OfflineStore {
  let device: DeviceRecord | null = null;
  const snapshots = new Map<string, PersonalSnapshot>();
  const outbox = new Map<string, OutboxOperation>();
  const appLocks = new Map<string, LocalAppLockRecord>();
  const clone = <T,>(value: T): T => structuredClone(value);

  return {
    async getDevice() {
      return device ? clone(device) : null;
    },
    async putDevice(next) {
      device = clone(next);
    },
    async setDeviceAppLockId(userId, appLockId) {
      if (device?.userId === userId && device.appLockId !== appLockId) device = { ...device, appLockId };
    },
    async deleteDevice() {
      device = null;
    },
    async getSnapshot(userId) {
      const found = snapshots.get(userId);
      return found ? clone(found) : null;
    },
    async putSnapshot(snapshot) {
      snapshots.set(snapshot.userId, clone(snapshot));
    },
    async deleteSnapshot(userId) {
      snapshots.delete(userId);
    },
    async listOutbox(userId) {
      return [...outbox.values()].filter((op) => op.userId === userId).map(clone).sort(fifo);
    },
    async putOperation(operation) {
      outbox.set(operation.id, clone(operation));
    },
    async deleteOperation(id) {
      outbox.delete(id);
    },
    async deleteOutbox(userId) {
      for (const [id, op] of outbox) if (op.userId === userId) outbox.delete(id);
    },
    async getAppLock(userId) {
      const found = appLocks.get(userId);
      return found ? clone(found) : null;
    },
    async putAppLock(record) {
      appLocks.set(record.userId, clone(record));
    },
    async deleteAppLock(userId) {
      appLocks.delete(userId);
    },
  };
}

/* -------------------------------------------------------------------------
   IndexedDB
   ------------------------------------------------------------------------- */

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(isQuotaError(request.error) ? new OfflineQuotaError(request.error) : request.error);
  });
}

function done(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        isQuotaError(transaction.error)
          ? new OfflineQuotaError(transaction.error)
          : transaction.error ?? new Error("offline_transaction_aborted"),
      );
    transaction.onerror = () =>
      reject(
        isQuotaError(transaction.error)
          ? new OfflineQuotaError(transaction.error)
          : transaction.error ?? new Error("offline_transaction_error"),
      );
  });
}

let opening: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new OfflineStorageUnavailableError());
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_SCHEMA_VERSION);
    } catch (cause) {
      reject(new OfflineStorageUnavailableError(cause));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      // Esquema v1. Versoes futuras migram aqui, sem apagar a outbox.
      if (!db.objectStoreNames.contains("device")) db.createObjectStore("device", { keyPath: "key" });
      if (!db.objectStoreNames.contains("snapshots")) db.createObjectStore("snapshots", { keyPath: "userId" });
      if (!db.objectStoreNames.contains("outbox")) {
        const outbox = db.createObjectStore("outbox", { keyPath: "id" });
        outbox.createIndex("byUser", "userId", { unique: false });
      }
      if (!db.objectStoreNames.contains("appLocks")) {
        db.createObjectStore("appLocks", { keyPath: "userId" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Outra aba abriu versao nova: fecha para nao bloquear o upgrade dela.
      db.onversionchange = () => {
        db.close();
        opening = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(new OfflineStorageUnavailableError(request.error));
    request.onblocked = () => reject(new OfflineStorageUnavailableError("blocked"));
  }).catch((error) => {
    opening = null;
    throw error;
  });
  return opening;
}

export function createIndexedDbStore(): OfflineStore {
  async function read<T>(storeName: string, run: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await openDatabase();
    const transaction = db.transaction(storeName, "readonly");
    const result = await promisify(run(transaction.objectStore(storeName)));
    await done(transaction);
    return result;
  }

  async function write(storeName: string, run: (store: IDBObjectStore) => void) {
    const db = await openDatabase();
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(storeName, "readwrite");
      run(transaction.objectStore(storeName));
    } catch (error) {
      throw isQuotaError(error) ? new OfflineQuotaError(error) : error;
    }
    await done(transaction);
  }

  return {
    async getDevice() {
      return ((await read<DeviceRecord | undefined>("device", (s) => s.get("current"))) ?? null);
    },
    putDevice: (device) => write("device", (s) => s.put(device)),
    setDeviceAppLockId: (userId, appLockId) =>
      write("device", (s) => {
        const current = s.get("current");
        current.onsuccess = () => {
          const device = current.result as DeviceRecord | undefined;
          if (device?.userId === userId && device.appLockId !== appLockId) s.put({ ...device, appLockId });
        };
      }),
    deleteDevice: () => write("device", (s) => s.delete("current")),
    async getSnapshot(userId) {
      return (await read<PersonalSnapshot | undefined>("snapshots", (s) => s.get(userId))) ?? null;
    },
    putSnapshot: (snapshot) => write("snapshots", (s) => s.put(snapshot)),
    deleteSnapshot: (userId) => write("snapshots", (s) => s.delete(userId)),
    async listOutbox(userId) {
      const rows = await read<OutboxOperation[]>("outbox", (s) => s.index("byUser").getAll(userId));
      return rows.sort(fifo);
    },
    putOperation: (operation) => write("outbox", (s) => s.put(operation)),
    deleteOperation: (id) => write("outbox", (s) => s.delete(id)),
    async deleteOutbox(userId) {
      const rows = await read<OutboxOperation[]>("outbox", (s) => s.index("byUser").getAll(userId));
      await write("outbox", (s) => {
        for (const row of rows) s.delete(row.id);
      });
    },
    async getAppLock(userId) {
      return (await read<LocalAppLockRecord | undefined>("appLocks", (s) => s.get(userId))) ?? null;
    },
    putAppLock: (record) => write("appLocks", (s) => s.put(record)),
    deleteAppLock: (userId) => write("appLocks", (s) => s.delete(userId)),
  };
}

/** Apaga todo material local do titular, inclusive o verificador do App Lock. */
export async function clearLocalUserData(store: OfflineStore, userId: string): Promise<void> {
  await store.deleteOutbox(userId);
  await store.deleteSnapshot(userId);
  await store.deleteAppLock(userId);
  const device = await store.getDevice();
  if (device?.userId === userId) await store.deleteDevice();
}

let shared: OfflineStore | null = null;

/** Store do navegador. Em ambiente sem IndexedDB, as chamadas rejeitam com erro tipado. */
export function getOfflineStore(): OfflineStore {
  if (!shared) shared = createIndexedDbStore();
  return shared;
}

/** Operacao interrompida no meio do envio volta a ser pendente (reenvio e idempotente). */
export async function recoverInterrupted(store: OfflineStore, userId: string) {
  for (const operation of await store.listOutbox(userId)) {
    if (operation.status === OUTBOX_STATUS.SYNCING) {
      await store.putOperation({ ...operation, status: OUTBOX_STATUS.PENDING });
    }
  }
}
