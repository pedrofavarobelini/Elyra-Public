"use client";

import { WifiOff } from "lucide-react";
import { useContext, useSyncExternalStore, type ReactNode } from "react";

import { ConnectivityContext } from "@/components/offline/connectivity";
import { LINK_STATE } from "@/lib/offline/connectivity";

/**
 * Acoes que so existem com rede (OFF-4): convite, vinculo, grants, agenda,
 * sala, recado. Sem conexao elas ficam **desabilitadas antes do clique**, com o
 * motivo em texto — nunca um botao que parece funcionar e falha depois.
 *
 * Usa o monitor com histerese do app pessoal quando existe; fora dele (area
 * profissional) cai para os eventos `online`/`offline` do navegador.
 */

function subscribeBrowser(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}
const browserState = () => (navigator.onLine === false ? LINK_STATE.OFFLINE : LINK_STATE.ONLINE);
const serverState = () => LINK_STATE.ONLINE;

export function useIsOffline(): boolean {
  const monitor = useContext(ConnectivityContext);
  const state = useSyncExternalStore(monitor?.subscribe ?? subscribeBrowser, monitor?.getState ?? browserState, serverState);
  // Fail-closed: "reconectando" ainda nao e rede confirmada para uma acao sensivel.
  return state !== LINK_STATE.ONLINE;
}

export const REQUIRES_CONNECTION_NOTE = "Sem conexão: esta ação precisa de internet. Nada foi alterado.";

export function RequiresConnection({ children, note = REQUIRES_CONNECTION_NOTE }: { children: ReactNode; note?: string }) {
  const offline = useIsOffline();
  return (
    <>
      {offline ? (
        <p
          role="status"
          data-testid="requires-connection-note"
          className="flex items-center gap-2 rounded-control bg-attention-soft px-3 py-2 text-sm text-ink"
        >
          <WifiOff className="size-4 shrink-0" aria-hidden="true" />
          {note}
        </p>
      ) : null}
      <fieldset disabled={offline} data-requires-connection={offline ? "offline" : "online"} className="contents">
        {children}
      </fieldset>
    </>
  );
}
