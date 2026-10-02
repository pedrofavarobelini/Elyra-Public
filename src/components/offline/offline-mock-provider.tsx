"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";

import {
  ConnectivityContext,
  useConnectivityMonitor,
  useOfflineNavigation,
} from "@/components/offline/connectivity";
import { OfflineGatewayContext } from "@/components/offline/offline-context";
import { LINK_STATE } from "@/lib/offline/connectivity";
import { getOfflineStore } from "@/lib/offline/db";
import { createOfflineGateway } from "@/lib/offline/gateway";
import { MockProvider } from "@/mocks/store";


export function OfflineMockProvider({
  children,
  ...props
}: Omit<ComponentProps<typeof MockProvider>, "gateway"> & {
  initialUser: NonNullable<ComponentProps<typeof MockProvider>["initialUser"]>;
}) {
  const userId = props.initialUser.id;
  const displayName = props.initialUser.name;
  const initials = props.initialUser.initials;
  const monitor = useConnectivityMonitor(LINK_STATE.ONLINE);
  const [gateway] = useState(() =>
    createOfflineGateway({
      userId,
      store: getOfflineStore(),
      mode: "online",
      isOffline: () => monitor.getState() !== LINK_STATE.ONLINE,
      onNetworkFailure: () => monitor.signalDown(),
    }),
  );

  useEffect(() => {
    void gateway.markVerified({ displayName, initials });
    void gateway.start();
    return () => gateway.dispose();
  }, [gateway, displayName, initials]);

  // Conexao confirmada de volta: sincroniza sem recarregar nada.
  useEffect(
    () =>
      monitor.subscribe(() => {
        if (monitor.getState() === LINK_STATE.ONLINE) void gateway.drain();
      }),
    [monitor, gateway],
  );

  const toShell = useCallback((url: URL) => {
    if (url.pathname === "/offline") return false;
    /*
      Carregamento de documento e o objetivo, nao um descuido: sem conexao o
      roteador do Next buscaria a rota no servidor e ficaria esperando. O service
      worker responde `/offline` do cache na hora.
    */
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/offline?de=${encodeURIComponent(url.pathname)}`);
    return true;
  }, []);
  useOfflineNavigation(monitor, toShell);

  return (
    <ConnectivityContext.Provider value={monitor}>
      <OfflineGatewayContext.Provider value={gateway}>
        <MockProvider {...props} gateway={gateway}>
          {children}
        </MockProvider>
      </OfflineGatewayContext.Provider>
    </ConnectivityContext.Provider>
  );
}
