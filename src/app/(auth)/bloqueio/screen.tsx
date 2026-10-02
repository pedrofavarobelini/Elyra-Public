"use client";

import { LockKeyhole, LogOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { signOutAction } from "@/app/(auth)/actions";
import { unlockAppLockAction } from "@/app/app-lock-actions";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import type { AppLockSummary } from "@/lib/app-lock/contracts";
import { createLocalAppLock } from "@/lib/app-lock/crypto";
import { alignLocalAppLock, broadcastAppLock, persistLocalAppLock } from "@/lib/app-lock/local";
import { clearDeviceOnLogout } from "@/lib/offline/device-cleanup";
import { getOfflineStore } from "@/lib/offline/db";

export function AppLockScreen({
  userId,
  lockId,
  next,
  initial,
}: {
  userId: string;
  lockId: string;
  next: string;
  initial: AppLockSummary;
}) {
  const [pin, setPin] = useState("");
  const [summary, setSummary] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!summary.cooldownUntil) return;
    const firstTick = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(timer);
    };
  }, [summary.cooldownUntil]);

  const seconds = useMemo(() => summary.cooldownUntil
    ? Math.max(0, Math.ceil((Date.parse(summary.cooldownUntil) - now) / 1_000))
    : 0, [now, summary.cooldownUntil]);
  const cooling = Boolean(summary.cooldownUntil) && (now === 0 || seconds > 0);

  async function unlock() {
    setPending(true);
    setMessage(null);
    try {
      const result = await unlockAppLockAction(pin);
      if (result.status !== "done") {
        if ("summary" in result) {
          setSummary(result.summary);
          await alignLocalAppLock(getOfflineStore(), userId, result.summary).catch(() => undefined);
        }
        setMessage(result.message);
        setPin("");
        return;
      }
      const store = getOfflineStore();
      const local = await store.getAppLock(userId);
      if (!local || local.lockId !== lockId) {
        await persistLocalAppLock(
          store,
          await createLocalAppLock(userId, lockId, pin, new Date(), result.summary.idlePolicy),
        );
      } else {
        await alignLocalAppLock(store, userId, result.summary);
      }
      broadcastAppLock(userId, result.summary);
      window.location.replace(next);
    } catch {
      setMessage("Não foi possível verificar o PIN agora.");
    } finally {
      setPending(false);
      setPin("");
    }
  }

  async function prepareLogout() {
    // OFF-4: mesma limpeza de todo logout (inclui a lista da Rede de Apoio).
    await clearDeviceOnLogout({ userId, store: getOfflineStore() }).catch(() => undefined);
    formRef.current?.requestSubmit();
  }

  return (
    <main className="elyra-canvas flex min-h-dvh items-center justify-center px-4 py-10">
      <section aria-labelledby="app-lock-title" className="w-full max-w-md rounded-panel border border-line bg-surface p-6 shadow-raised sm:p-8">
        <Logo className="h-9" />
        <div className="mt-6 inline-flex size-12 items-center justify-center rounded-pill bg-brand-100 text-brand-700" aria-hidden="true">
          <LockKeyhole className="size-6" />
        </div>
        <h1 id="app-lock-title" className="mt-4 text-2xl font-semibold tracking-tight text-ink">Elyra bloqueada</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Digite o PIN local da Elyra para liberar esta interface. Este PIN não é a senha da conta nem o PIN do Windows.
        </p>

        <form
          className="mt-6 grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          <label htmlFor="unlock-pin" className="grid gap-1 text-sm font-medium text-ink">
            PIN da Elyra
            <input
              id="unlock-pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              pattern="[0-9]*"
              minLength={6}
              maxLength={8}
              autoFocus
              value={pin}
              disabled={pending || cooling}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
              className="min-h-12 rounded-control border border-line bg-surface px-3 text-lg tracking-[0.3em] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-60"
            />
          </label>
          {message ? <p role="alert" aria-live="assertive" className="text-sm text-danger">{message}</p> : null}
          {cooling ? <p role="status" aria-live="polite" className="text-sm text-ink-muted">
            {seconds > 0 ? `Tente novamente em ${seconds} s.` : "Aguarde para tentar novamente."}
          </p> : null}
          <Button type="submit" disabled={pending || cooling || pin.length < 6}>
            {pending ? "Verificando…" : "Desbloquear"}
          </Button>
        </form>

        <div className="mt-6 border-t border-line pt-4">
          <p className="text-xs text-ink-muted">
            Esqueceu o PIN? Saia e autentique a conta novamente. Os dados offline deste acesso serão apagados.
          </p>
          <form ref={formRef} action={signOutAction} className="mt-3">
            <Button type="button" variant="secondary" onClick={() => void prepareLogout()}>
              <LogOut className="size-4" aria-hidden="true" />
              Sair e entrar novamente
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}
