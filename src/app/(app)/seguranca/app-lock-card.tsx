"use client";

import { LockKeyhole } from "lucide-react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  activateAppLockAction,
  disableAppLockAction,
  lockAppLockAction,
  updateAppLockIdlePolicyAction,
} from "@/app/app-lock-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconPill } from "@/components/ui/icon-pill";
import {
  APP_LOCK_IDLE_OPTIONS,
  APP_LOCK_STATE,
  isValidAppLockPin,
  type AppLockIdlePolicy,
  type AppLockSummary,
} from "@/lib/app-lock/contracts";
import { createLocalAppLock } from "@/lib/app-lock/crypto";
import {
  broadcastAppLock,
  alignLocalAppLock,
  lockLocalAppLock,
  persistLocalAppLock,
  removeLocalAppLock,
} from "@/lib/app-lock/local";
import { getOfflineStore } from "@/lib/offline/db";

function PinField({
  id,
  label,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label htmlFor={id} className="grid gap-1 text-sm font-medium text-ink">
      {label}
      <input
        id={id}
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        pattern="[0-9]*"
        minLength={6}
        maxLength={8}
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 8))}
        className="min-h-11 rounded-control border border-line bg-surface px-3 text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      />
    </label>
  );
}

export function AppLockCard({
  userId,
  initial,
}: {
  userId: string;
  initial: AppLockSummary;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState(initial);
  const [mode, setMode] = useState<"enable" | "disable" | null>(null);
  const [pin, setPin] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [idlePolicy, setIdlePolicy] = useState<AppLockIdlePolicy>(initial.idlePolicy);
  const enabled = summary.state !== APP_LOCK_STATE.DISABLED;

  const close = () => {
    setMode(null);
    setPin("");
    setConfirmation("");
  };

  async function enable() {
    if (!isValidAppLockPin(pin)) {
      setMessage("Use um PIN de 6 a 8 dígitos.");
      return;
    }
    if (pin !== confirmation) {
      setMessage("Os PINs não coincidem.");
      return;
    }
    setPending(true);
    setMessage(null);
    const store = getOfflineStore();
    const lockId = crypto.randomUUID();
    try {
      const local = await createLocalAppLock(userId, lockId, pin, new Date(), idlePolicy);
      await persistLocalAppLock(store, local);
      const result = await activateAppLockAction({ lockId, pin, idlePolicy });
      if (result.status !== "done") {
        await removeLocalAppLock(store, userId);
        setMessage(result.message);
        return;
      }
      setSummary(result.summary);
      broadcastAppLock(userId, result.summary);
      setMessage("App Lock ativado neste acesso.");
      close();
    } catch {
      await removeLocalAppLock(store, userId).catch(() => undefined);
      setMessage("O armazenamento seguro local não está disponível. O App Lock não foi ativado.");
    } finally {
      setPending(false);
      setPin("");
      setConfirmation("");
    }
  }

  async function lockNow() {
    setPending(true);
    setMessage(null);
    try {
      const result = await lockAppLockAction();
      if (result.status !== "done") {
        setMessage(result.message);
        return;
      }
      await lockLocalAppLock(getOfflineStore(), userId).catch(() => undefined);
      broadcastAppLock(userId, result.summary);
      router.push("/bloqueio" as Route);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function disable() {
    if (!isValidAppLockPin(pin)) {
      setMessage("Use o PIN atual de 6 a 8 dígitos.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const result = await disableAppLockAction(pin);
      if (result.status !== "done") {
        if ("summary" in result) setSummary(result.summary);
        setMessage(result.message);
        return;
      }
      await removeLocalAppLock(getOfflineStore(), userId);
      setSummary(result.summary);
      broadcastAppLock(userId, result.summary);
      setMessage("App Lock removido deste acesso.");
      close();
    } catch {
      setMessage("Não foi possível remover o App Lock agora.");
    } finally {
      setPending(false);
      setPin("");
    }
  }

  async function changeIdlePolicy(next: AppLockIdlePolicy) {
    setIdlePolicy(next);
    if (!enabled) return;
    setPending(true);
    setMessage(null);
    try {
      const result = await updateAppLockIdlePolicyAction(next);
      if (result.status !== "done") {
        setIdlePolicy(summary.idlePolicy);
        setMessage(result.message);
        return;
      }
      await alignLocalAppLock(getOfflineStore(), userId, result.summary);
      setSummary(result.summary);
      broadcastAppLock(userId, result.summary);
      setMessage("Tempo de inatividade atualizado neste acesso.");
    } catch {
      setIdlePolicy(summary.idlePolicy);
      setMessage("Não foi possível atualizar o tempo de inatividade.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card id="app-lock" className="scroll-mt-20">
      <CardHeader>
        <div className="flex items-start gap-3">
          <IconPill tone="brand"><LockKeyhole className="size-5" aria-hidden="true" /></IconPill>
          <div>
            <CardTitle>App Lock</CardTitle>
            <CardDescription>
              Um PIN da Elyra bloqueia esta interface. Ele não substitui login, MFA, Passkey ou o PIN do Windows.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="rounded-control border border-line bg-surface-muted px-3 py-2 text-sm">
          <p className="font-medium text-ink">Estado neste acesso</p>
          <p className="text-ink-muted">{enabled ? "Ativado e desbloqueado" : "Desativado"}</p>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="app-lock-idle-policy" className="text-sm font-medium text-ink">
            Bloquear após inatividade
          </label>
          <select
            id="app-lock-idle-policy"
            value={idlePolicy}
            disabled={pending}
            onChange={(event) => void changeIdlePolicy(event.target.value as AppLockIdlePolicy)}
            className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            {APP_LOCK_IDLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <p className="text-xs text-ink-subtle">
            A atividade real renova o prazo neste aparelho. “Nunca automaticamente” mantém o bloqueio manual, o logout e a expiração da sessão.
          </p>
        </div>
        {message ? <p role="status" aria-live="polite" className="text-sm text-ink-muted">{message}</p> : null}
        <div className="flex flex-wrap gap-2">
          {enabled ? (
            <>
              <Button type="button" onClick={() => void lockNow()} disabled={pending}>Bloquear agora</Button>
              <Button type="button" variant="secondary" onClick={() => setMode("disable")} disabled={pending}>
                Remover App Lock
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => setMode("enable")} disabled={pending}>Ativar App Lock</Button>
          )}
        </div>
        <p className="text-xs text-ink-subtle">
          O prazo fica associado a esta sessão e sobrevive a reload, uso offline e outras abas. Logout apaga o App Lock e os dados offline deste acesso.
        </p>
      </CardContent>

      <Dialog open={mode === "enable"} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar PIN da Elyra</DialogTitle>
            <DialogDescription>Use de 6 a 8 dígitos. Este PIN vale somente para esta sessão e nunca é salvo em texto puro.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <PinField id="app-lock-pin" label="Novo PIN" value={pin} onChange={setPin} autoFocus />
            <PinField id="app-lock-confirm" label="Confirmar PIN" value={confirmation} onChange={setConfirmation} />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close}>Cancelar</Button>
            <Button type="button" disabled={pending} onClick={() => void enable()}>
              {pending ? "Ativando…" : "Ativar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={mode === "disable"} onOpenChange={(open) => { if (!open) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover App Lock</DialogTitle>
            <DialogDescription>Informe o PIN atual. O login da conta continuará ativo.</DialogDescription>
          </DialogHeader>
          <PinField id="app-lock-current-pin" label="PIN atual" value={pin} onChange={setPin} autoFocus />
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={close}>Cancelar</Button>
            <Button type="button" disabled={pending} onClick={() => void disable()}>
              {pending ? "Removendo…" : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
