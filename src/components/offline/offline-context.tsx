"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

import type { GatewayState, OfflineGateway } from "@/lib/offline/gateway";

/**
 * Gateway offline disponivel para quem precisa agir sobre a fila fora do store:
 * indicador de sync, central de sync, logout e exclusao de conta.
 * Ausente (area profissional, testes) = nada offline aparece.
 */
export const OfflineGatewayContext = createContext<OfflineGateway | null>(null);

export function useOfflineGateway(): OfflineGateway | null {
  return useContext(OfflineGatewayContext);
}

/**
 * OFF-3: presente so dentro do shell offline — a tela esta lendo a copia local
 * gravada em `savedAt`. Relatorios e conteudo usam para nunca apresentar dado
 * antigo como atual, nem link externo como se houvesse rede.
 */
export const OfflineSnapshotContext = createContext<{ savedAt: string } | null>(null);

export function useOfflineSnapshot(): { savedAt: string } | null {
  return useContext(OfflineSnapshotContext);
}

/** "28/09, 14:05" — data e hora da copia local. */
export function formatSnapshotMoment(savedAt: string): string {
  return new Date(savedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const EMPTY: GatewayState = {
  connectivity: "ONLINE",
  operations: [],
  syncing: false,
  lastSyncedAt: null,
  storageAvailable: true,
};
const noop = () => () => undefined;
const empty = () => EMPTY;

export function useGatewayState(gateway: OfflineGateway | null): GatewayState {
  return useSyncExternalStore(
    gateway?.subscribe ?? noop,
    gateway?.getState ?? empty,
    gateway?.getState ?? empty,
  );
}
