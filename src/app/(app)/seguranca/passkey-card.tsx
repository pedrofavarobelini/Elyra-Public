"use client";

import { Fingerprint, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  deletePasskeyAction,
  finishPasskeyRegistrationAction,
  startPasskeyRegistrationAction,
  type PasskeyInfo,
} from "@/app/passkey-actions";
import { Button } from "@/components/ui/button";
import { CapabilityNotice } from "@/components/capability-notice";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AppUser } from "@/lib/contracts/identity";
import {
  CAPABILITY_STATUS,
  passkeyCapability,
  passkeyOriginSupported,
} from "@/lib/capabilities";
import { browserSupportsPasskeys, createPasskey, PasskeyClientError } from "@/lib/passkeys";
import { InlineEmpty } from "@/components/states";

function browserMessage(error: unknown) {
  if (error instanceof PasskeyClientError && error.code === "cancelled") return "Cadastro cancelado. Nada mudou.";
  if (error instanceof PasskeyClientError && error.code === "unsupported") return "Este navegador não oferece WebAuthn.";
  if (error instanceof PasskeyClientError && error.code === "invalid_origin") return "Abra a Elyra pelo endereço seguro configurado para usar chaves de acesso.";
  if (error instanceof PasskeyClientError && error.code === "not_available") return "O aparelho não encontrou Windows Hello, biometria ou chave compatível.";
  return "Não foi possível concluir a cerimônia no aparelho.";
}

export function PasskeyCard({
  available,
  initialPasskeys,
  owner,
}: {
  available: boolean;
  initialPasskeys: PasskeyInfo[];
  owner: AppUser;
}) {
  const [passkeys, setPasskeys] = useState(initialPasskeys);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [browserSupported, setBrowserSupported] = useState<boolean | null>(null);
  const [originSupported, setOriginSupported] = useState<boolean | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setBrowserSupported(browserSupportsPasskeys());
      setOriginSupported(passkeyOriginSupported(window.location.hostname));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const capability = passkeyCapability(available, browserSupported, originSupported ?? true);
  const canRegister = capability.status === CAPABILITY_STATUS.SUPPORTED;

  async function register() {
    setPending(true);
    setMessage(null);
    try {
      const started = await startPasskeyRegistrationAction();
      if (started.status === "error") return setMessage(started.message);
      const credential = await createPasskey(started.options);
      const finished = await finishPasskeyRegistrationAction({ challengeId: started.challengeId, credential });
      if (finished.status === "error") return setMessage(finished.message);
      if (finished.passkey) setPasskeys((current) => [...current, finished.passkey!]);
      setMessage("Chave de acesso cadastrada. Ela já pode ser usada para entrar.");
    } catch (error) {
      setMessage(browserMessage(error));
    } finally {
      setPending(false);
    }
  }

  async function remove(id: string) {
    setPending(true);
    setMessage(null);
    const result = await deletePasskeyAction(id);
    if (result.status === "error") setMessage(result.message);
    else {
      setPasskeys((current) => current.filter((item) => item.id !== id));
      setMessage("Chave removida. As outras formas de entrar continuam disponíveis.");
    }
    setPending(false);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <IconPill tone="brand"><Fingerprint /></IconPill>
          <div className="min-w-0">
            <CardTitle>Chaves de acesso</CardTitle>
            <CardDescription>
              Use o autenticador do aparelho, como Windows Hello, sem entregar PIN ou biometria à Elyra.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-control border border-line bg-surface-muted px-3 py-2 text-sm">
          <p className="font-medium text-ink">Conta que receberá a chave</p>
          <p className="break-all text-ink-muted">{owner.name} · {owner.email}</p>
        </div>
        {!canRegister ? (
          <CapabilityNotice assessment={capability} />
        ) : passkeys.length === 0 ? (
          <InlineEmpty>Nenhuma chave cadastrada. Senha, Google e MFA continuam disponíveis.</InlineEmpty>
        ) : (
          <ul className="divide-y divide-line">
            {passkeys.map((passkey, index) => (
              <li key={passkey.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{passkey.friendlyName || `Chave ${index + 1}`}</p>
                  <p className="text-xs text-ink-muted">Cadastrada em {new Intl.DateTimeFormat("pt-BR").format(new Date(passkey.createdAt))}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => remove(passkey.id)} aria-label={`Remover ${passkey.friendlyName || `chave ${index + 1}`}`}>
                  <Trash2 aria-hidden="true" /> Remover
                </Button>
              </li>
            ))}
          </ul>
        )}
        {message ? <p role="status" className="text-sm text-ink-muted">{message}</p> : null}
        <div>
          <Button type="button" variant="secondary" disabled={!canRegister || pending} onClick={() => setConfirming(true)}>
            {pending ? "Aguardando o aparelho..." : "Cadastrar nova chave"}
          </Button>
        </div>
        <p className="text-xs text-ink-subtle">Passkeys exigem rede e origem segura. Elas não substituem o bloqueio do aparelho nem o logout.</p>
      </CardContent>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar conta da chave</DialogTitle>
            <DialogDescription>
              O Windows Hello será vinculado a <strong>{owner.name}</strong> ({owner.email}).
              Confirme somente se esta é a conta que você pretende usar.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirming(false);
                void register();
              }}
            >
              Cadastrar para esta conta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
