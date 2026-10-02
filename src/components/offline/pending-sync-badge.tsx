"use client";

import { UploadCloud } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useOfflineGateway } from "@/components/offline/offline-context";
import { OUTBOX_STATUS } from "@/lib/offline/contracts";
import type { OfflineGateway } from "@/lib/offline/gateway";
import { useMockStore } from "@/mocks/store";


export function PendingSyncBadge({ entityId }: { entityId: string }) {
  const { isPendingSync } = useMockStore();
  if (!isPendingSync(entityId)) return null;
  return (
    <Badge tone="neutral" data-elyra-pending-sync="">
      <UploadCloud className="size-3" aria-hidden="true" />
      Aguardando sincronizar
    </Badge>
  );
}

/** A escrita que acabou de terminar ficou na fila (e nao chegou a conta)? */
export function wasQueued(gateway: OfflineGateway | null, entityId: string): boolean {
  if (!gateway) return false;
  return gateway
    .getState()
    .operations.some(
      (operation) =>
        (operation.entityId === entityId ||
          (operation.request.body as Record<string, unknown>).id === entityId) &&
        operation.status !== OUTBOX_STATUS.FAILED,
    );
}

export function useWasQueued() {
  const gateway = useOfflineGateway();
  return (entityId: string) => wasQueued(gateway, entityId);
}
