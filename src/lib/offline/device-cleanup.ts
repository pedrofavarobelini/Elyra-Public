import { clearLocalUserData, getOfflineStore, type OfflineStore } from "@/lib/offline/db";
import { clearSupportNetworkCache } from "@/lib/support-network/offline-cache";

/**
 * Limpeza unica de logout (OFF-4, OFF-GAP-03): todo caminho de saida apaga os
 * mesmos storages por usuario deste aparelho.
 *
 * - `elyra-offline`: outbox, snapshot, verificador do App Lock e o registro do
 *   aparelho da pessoa que sai (ADR-0014);
 * - `elyra-support-network`: a ultima lista da Rede de Apoio (municipio
 *   consultado e indicio de localizacao).
 *
 * Nao apaga: assets publicos (Cache Storage do worker) e a preferencia de
 * acessibilidade deste aparelho (texto, contraste, movimento), que nao e dado
 * sensivel.
 *
 * Sem `userId` conhecido (ex.: logout a partir da area profissional, que nao
 * monta o gateway pessoal), apaga os dados do usuario registrado no aparelho.
 */
export async function clearDeviceOnLogout(options: { userId?: string; store?: OfflineStore } = {}) {
  clearSupportNetworkCache();
  const store = options.store ?? safeStore();
  if (!store) return;
  try {
    const userId = options.userId ?? (await store.getDevice())?.userId;
    if (userId) await clearLocalUserData(store, userId);
  } catch {
    // Sem IndexedDB (modo privado restrito): nada a apagar.
  }
}

function safeStore(): OfflineStore | null {
  try {
    return typeof indexedDB === "undefined" ? null : getOfflineStore();
  } catch {
    return null;
  }
}
