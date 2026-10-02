"use client";

import { useEffect, useRef, useState } from "react";

import { touchAppLockAction } from "@/app/app-lock-actions";
import {
  APP_LOCK_ACTIVITY_THROTTLE_MS,
  APP_LOCK_STATE,
  effectiveAppLockState,
  type AppLockSummary,
} from "@/lib/app-lock/contracts";
import {
  APP_LOCK_CHANNEL,
  APP_LOCK_SOURCE_ID,
  alignLocalAppLock,
  broadcastAppLock,
  localAppLockSummary,
  touchLocalAppLock,
  type AppLockBroadcast,
} from "@/lib/app-lock/local";
import { getOfflineStore } from "@/lib/offline/db";

function goToLock() {
  window.location.replace(`/bloqueio?next=${encodeURIComponent(window.location.pathname)}`);
}

/**
 * Mantém prazo e abas alinhados; a autoridade de acesso continua no servidor.
 * Nenhum dado pessoal é recebido ou transmitido por este coordenador.
 */
export function AppLockCoordinator({
  userId,
  initial,
}: {
  userId: string;
  initial: AppLockSummary;
}) {
  const [summary, setSummary] = useState(initial);
  const lastTouch = useRef(0);

  useEffect(() => {
    const store = getOfflineStore();
    void alignLocalAppLock(store, userId, initial).catch(() => undefined);
  }, [initial, userId]);

  useEffect(() => {
    if (summary.state !== APP_LOCK_STATE.UNLOCKED || !summary.unlockedUntil) return;
    const remaining = Date.parse(summary.unlockedUntil) - Date.now();
    if (remaining <= 0) {
      goToLock();
      return;
    }
    const timer = window.setTimeout(goToLock, remaining);
    return () => window.clearTimeout(timer);
  }, [summary]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(APP_LOCK_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data as Partial<AppLockBroadcast> | null;
      if (message?.type !== "APP_LOCK_CHANGED" || message.userId !== userId || !message.summary) return;
      if (message.sourceId === APP_LOCK_SOURCE_ID) return;
      setSummary(message.summary);
      void alignLocalAppLock(getOfflineStore(), userId, message.summary).catch(() => undefined);
      if (message.summary.state === APP_LOCK_STATE.LOCKED || message.summary.state === APP_LOCK_STATE.COOLDOWN) {
        goToLock();
      }
    };
    return () => channel.close();
  }, [userId]);

  useEffect(() => {
    if (summary.state !== APP_LOCK_STATE.UNLOCKED) return;
    const store = getOfflineStore();

    const touch = (event?: Event) => {
      if (event && !event.isTrusted) return;
      const now = Date.now();
      if (now - lastTouch.current < APP_LOCK_ACTIVITY_THROTTLE_MS) return;
      lastTouch.current = now;
      void touchLocalAppLock(store, userId, new Date(now)).then((record) => {
        if (!record) return;
        const local = localAppLockSummary(record, new Date(now));
        setSummary(local);
        broadcastAppLock(userId, local);
      }).catch(() => undefined);
      void touchAppLockAction().then((result) => {
        if (result.status !== "done") return;
        setSummary(result.summary);
        broadcastAppLock(userId, result.summary);
      }).catch(() => undefined);
    };

    const visible = (event: Event) => {
      if (document.visibilityState !== "visible") return;
      void store.getAppLock(userId).then((record) => {
        if (record && effectiveAppLockState(record) !== APP_LOCK_STATE.UNLOCKED) goToLock();
        else touch(event);
      }).catch(() => goToLock());
    };

    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [summary.state, userId]);

  return null;
}
