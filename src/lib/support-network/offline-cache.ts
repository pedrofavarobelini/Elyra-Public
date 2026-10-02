import type {
  SupportFacility,
  SupportMunicipalityType,
  SupportProvenance,
} from "@/lib/contracts/support-network";

/**
 * SUP-2 — ultima lista consultada, para ler sem rede (READ_ONLY_OFFLINE).
 *
 * Dado INSTITUCIONAL (unidades publicas + procedencia), nunca da pessoa:
 * - chave = municipio + filtro de tipo; nunca coordenada;
 * - TTL de 30 dias e no maximo 3 listas (a mais antiga sai);
 * - banco proprio (`elyra-support-network`), separado do nucleo pessoal
 *   (`elyra-offline`, ADR-0014) para nao mexer no schema versionado dele;
 * - apagado no logout, como o resto do que e local.
 * O service worker continua sem guardar `/api` (ONLINE_ONLY); tiles nunca.
 */

export const SUPPORT_CACHE_POLICY = { ttlDays: 30, maxEntries: 3 } as const;
export const SUPPORT_CACHE_DB = "elyra-support-network";
const STORE = "lists";
const DAY_MS = 86_400_000;

export type SupportCacheEntry = {
  key: string;
  municipalityCode: string;
  municipalityLabel: string;
  officialTypeCode: string | null;
  provenance: SupportProvenance | null;
  facilities: SupportFacility[];
  types: SupportMunicipalityType[];
  cachedAt: number;
};

export function supportCacheKey(municipalityCode: string, officialTypeCode: string | null): string {
  if (!/^[0-9]{6,7}$/.test(municipalityCode)) throw new Error("support_cache_key_invalid");
  return `${municipalityCode.slice(0, 6)}|${officialTypeCode ?? "*"}`;
}

export function isSupportCacheFresh(entry: Pick<SupportCacheEntry, "cachedAt">, now: number): boolean {
  return now - entry.cachedAt <= SUPPORT_CACHE_POLICY.ttlDays * DAY_MS && entry.cachedAt <= now + 60_000;
}

export interface SupportCacheBackend {
  all(): Promise<SupportCacheEntry[]>;
  put(entry: SupportCacheEntry): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export function createMemorySupportBackend(): SupportCacheBackend {
  const map = new Map<string, SupportCacheEntry>();
  return {
    all: async () => [...map.values()].map((entry) => structuredClone(entry)),
    put: async (entry) => void map.set(entry.key, structuredClone(entry)),
    remove: async (key) => void map.delete(key),
    clear: async () => map.clear(),
  };
}

function idbBackend(): SupportCacheBackend | null {
  if (typeof indexedDB === "undefined") return null;
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(SUPPORT_CACHE_DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  const run = async <T,>(mode: IDBTransactionMode, body: (store: IDBObjectStore) => IDBRequest<T>) => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = body(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  };
  return {
    all: () => run("readonly", (store) => store.getAll() as IDBRequest<SupportCacheEntry[]>),
    put: async (entry) => void (await run("readwrite", (store) => store.put(entry))),
    remove: async (key) => void (await run("readwrite", (store) => store.delete(key))),
    clear: async () => void (await run("readwrite", (store) => store.clear())),
  };
}

export function createSupportCache(backend: SupportCacheBackend | null = idbBackend()) {
  const safe = async <T,>(fallback: T, body: (b: SupportCacheBackend) => Promise<T>): Promise<T> => {
    if (!backend) return fallback;
    try {
      return await body(backend);
    } catch {
      // Cache e conveniencia: falhar aqui nunca derruba a lista online.
      return fallback;
    }
  };

  /** Vencidas somem; das validas ficam as `maxEntries` mais recentes. */
  const prune = async (b: SupportCacheBackend, now: number) => {
    const entries = await b.all();
    const fresh = entries.filter((entry) => isSupportCacheFresh(entry, now)).sort((x, y) => y.cachedAt - x.cachedAt);
    const keep = new Set(fresh.slice(0, SUPPORT_CACHE_POLICY.maxEntries).map((entry) => entry.key));
    for (const entry of entries) if (!keep.has(entry.key)) await b.remove(entry.key);
    return fresh.filter((entry) => keep.has(entry.key));
  };

  return {
    save: (entry: Omit<SupportCacheEntry, "key" | "cachedAt">, now = Date.now()) =>
      safe(undefined, async (b) => {
        await b.put({ ...entry, key: supportCacheKey(entry.municipalityCode, entry.officialTypeCode), cachedAt: now });
        await prune(b, now);
      }),
    load: (municipalityCode: string, officialTypeCode: string | null, now = Date.now()) =>
      safe<SupportCacheEntry | null>(null, async (b) => {
        const key = supportCacheKey(municipalityCode, officialTypeCode);
        return (await prune(b, now)).find((entry) => entry.key === key) ?? null;
      }),
    recent: (now = Date.now()) => safe<SupportCacheEntry[]>([], (b) => prune(b, now)),
    clear: () => safe(undefined, (b) => b.clear()),
  };
}

/** Logout: apaga o banco inteiro (nao espera; o navegador conclui sozinho). */
export function clearSupportNetworkCache(): void {
  try {
    if (typeof indexedDB !== "undefined") indexedDB.deleteDatabase(SUPPORT_CACHE_DB);
  } catch {
    // sem IndexedDB (modo privado restrito): nada a apagar.
  }
}
