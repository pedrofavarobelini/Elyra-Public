"use client";

import { useOfflineSnapshot } from "@/components/offline/offline-context";

/**
 * OFF-3: no shell offline, link externo nao finge que abre. O aviso fica ao
 * lado do link (texto, nao so cor); online nao renderiza nada.
 */
export function OfflineLinkNote() {
  if (useOfflineSnapshot() === null) return null;
  return (
    <span data-testid="external-offline-note" className="text-xs font-normal text-ink-muted">
      (precisa de internet)
    </span>
  );
}
