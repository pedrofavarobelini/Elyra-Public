"use client";

import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

import {
  LINK_STATE,
  attachBrowserSignals,
  createConnectivityMonitor,
  type ConnectivityMonitor,
  type LinkState,
} from "@/lib/offline/connectivity";



export const ConnectivityContext = createContext<ConnectivityMonitor | null>(null);

const alwaysOnline = () => LINK_STATE.ONLINE;
const noop = () => () => undefined;

export function useLinkState(): LinkState {
  const monitor = useContext(ConnectivityContext);
  return useSyncExternalStore(
    monitor?.subscribe ?? noop,
    monitor?.getState ?? alwaysOnline,
    alwaysOnline,
  );
}

/** Cria o monitor da pagina e liga aos eventos do navegador. */
export function useConnectivityMonitor(initial: LinkState): ConnectivityMonitor {
  const [monitor] = useState(() => createConnectivityMonitor({ initial }));
  useEffect(() => {
    const detach = attachBrowserSignals(monitor);
    return () => {
      detach();
      monitor.dispose();
    };
  }, [monitor]);
  return monitor;
}

/** Destino interno de um clique em link, ou `null` se nao for navegacao da Elyra. */
export function internalDestination(event: MouseEvent): URL | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return null;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return null;
  return url;
}

/**
 * Enquanto a conexao nao esta confirmada, navegacoes internas vao por `handle`
 * em vez de esperar uma requisicao ao servidor que nao vai responder.
 */
export function useOfflineNavigation(
  monitor: ConnectivityMonitor,
  handle: (url: URL) => boolean,
) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (monitor.getState() === LINK_STATE.ONLINE) return;
      const url = internalDestination(event);
      if (url && handle(url)) event.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [monitor, handle]);
}
