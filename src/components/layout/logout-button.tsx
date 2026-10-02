"use client";

import { LogOut } from "lucide-react";
import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { signOutAction } from "@/app/(auth)/actions";
import { BrandLoader } from "@/components/brand/brand-loader";
import { useGatewayState, useOfflineGateway } from "@/components/offline/offline-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CONNECTIVITY } from "@/lib/offline/contracts";
import { clearDeviceOnLogout } from "@/lib/offline/device-cleanup";


export function LogoutButton() {
  const gateway = useOfflineGateway();
  const state = useGatewayState(gateway);
  const formRef = useRef<HTMLFormElement>(null);
  const cleared = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const pending = state.operations.length;

  const submitAfterClearing = async () => {
    await gateway?.clearLocal();
    cleared.current = true;
    setConfirming(false);
    formRef.current?.requestSubmit();
  };

  return (
    <>
      <form
        ref={formRef}
        action={signOutAction}
        onSubmit={(event) => {
          if (cleared.current) return;
          if (!gateway) {
            // OFF-4: sem gateway (area profissional), a mesma limpeza unica apaga
            // os dados pessoais deste aparelho antes de sair.
            event.preventDefault();
            void clearDeviceOnLogout().finally(() => {
              cleared.current = true;
              formRef.current?.requestSubmit();
            });
            return;
          }
          event.preventDefault();
          if (pending > 0) {
            setConfirming(true);
            return;
          }
          void submitAfterClearing();
        }}
      >
        <LogoutSubmit />
      </form>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Há alterações só neste aparelho</DialogTitle>
            <DialogDescription>
              {pending === 1 ? "1 alteração ainda não chegou" : `${pending} alterações ainda não chegaram`} à
              sua conta. Ao sair, a Elyra apaga deste aparelho o que é seu — inclusive o que não sincronizou.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button
              variant="secondary"
              disabled={state.connectivity === CONNECTIVITY.OFFLINE || state.syncing}
              onClick={() => void gateway?.drain()}
            >
              {state.syncing ? "Sincronizando…" : "Sincronizar agora"}
            </Button>
            <Button variant="destructive" onClick={() => void submitAfterClearing()}>
              Sair e apagar deste aparelho
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LogoutSubmit() {
  const { pending } = useFormStatus();
  return (
    <>
      <Button type="submit" variant="secondary" disabled={pending}>
        <LogOut aria-hidden="true" />
        Sair
      </Button>
      {pending ? (
        <div
          role="status"
          aria-live="polite"
          className="motion-fade-in fixed inset-0 z-[80] grid place-items-center bg-gradient-to-br from-identity-50/95 via-surface-brand/95 to-brand-100/95 backdrop-blur-sm"
        >
          <div className="flex flex-col items-center gap-3">
            <BrandLoader />
            <p className="text-sm font-medium text-ink">Saindo com segurança…</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
