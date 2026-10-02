"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

import { useLinkState } from "@/components/offline/connectivity";
import { useOfflineGateway } from "@/components/offline/offline-context";
import { LINK_STATE } from "@/lib/offline/connectivity";

import {
  isBrowserOnline,
  serverNetworkSnapshot,
  subscribeToNetworkStatus,
} from "@/lib/network-status";


export function OfflineBanner() {
  const browserOnline = useSyncExternalStore(
    subscribeToNetworkStatus,
    isBrowserOnline,
    serverNetworkSnapshot,
  );

  // e sincroniza sozinho, com ID estavel (sem duplicar). Sem ela, vale a regra V1.
  const offlineCore = useOfflineGateway() !== null;
  const link = useLinkState();

  if (offlineCore ? link !== LINK_STATE.OFFLINE : browserOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="offline-banner"
      className="border-b border-attention bg-attention-soft px-4 py-2 text-sm text-ink sm:px-6"
    >
      <p className="mx-auto flex max-w-[100rem] items-center gap-2">
        <WifiOff aria-hidden="true" className="size-4 shrink-0" />
        {offlineCore
          ? "Você está sem conexão. Diário, humor, metas e ciclo guardam o que você registrar neste aparelho e sincronizam quando a rede voltar. As outras áreas precisam de conexão."
          : "Você está sem conexão. O que você escreveu continua nesta tela, e nada é enviado sozinho — toque em salvar de novo quando a rede voltar."}
      </p>
    </div>
  );
}
