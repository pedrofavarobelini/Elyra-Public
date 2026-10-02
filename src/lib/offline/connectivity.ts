

export const LINK_STATE = {
  ONLINE: "ONLINE",
  RECONNECTING: "RECONNECTING",
  OFFLINE: "OFFLINE",
} as const;
export type LinkState = (typeof LINK_STATE)[keyof typeof LINK_STATE];

export const CONFIRM_MS = 1_500;
export const PROBE_TIMEOUT_MS = 4_000;
export const RECHECK_BASE_MS = 3_000;
export const RECHECK_MAX_MS = 30_000;

type Timer = ReturnType<typeof setTimeout>;

export interface ConnectivityOptions {
  initial: LinkState;
  probe?: () => Promise<boolean>;
  setTimer?: (callback: () => void, ms: number) => Timer;
  clearTimer?: (timer: Timer) => void;
}

export async function probeServer(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetch("/sw.js", {
      method: "HEAD",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function createConnectivityMonitor(options: ConnectivityOptions) {
  const probe = options.probe ?? probeServer;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const listeners = new Set<() => void>();
  let state: LinkState = options.initial;
  let timer: Timer | null = null;
  let recheckDelay = RECHECK_BASE_MS;
  let checking = false;
  // Sinal que chegou durante uma sonda: roda de novo ao terminar, em vez de
  // descartar (uma queda no meio de uma sonda boa ficava invisivel; OFF-4).
  let rerun = false;
  let disposed = false;

  function set(next: LinkState) {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  function schedule(ms: number) {
    if (timer) clearTimer(timer);
    timer = disposed ? null : setTimer(() => {
      timer = null;
      void check();
    }, ms);
  }

  async function check() {
    if (disposed) return;
    if (checking) {
      rerun = true;
      return;
    }
    checking = true;
    rerun = false;
    try {
      const ok = await probe();
      if (disposed) return;
      if (state === LINK_STATE.ONLINE) {
        if (ok) return;
        // Primeira falha: confirma antes de declarar queda.
        await wait(CONFIRM_MS);
        if (disposed || (await probe())) return;
        set(LINK_STATE.OFFLINE);
        recheckDelay = RECHECK_BASE_MS;
        schedule(recheckDelay);
        return;
      }
      if (state === LINK_STATE.OFFLINE) {
        if (ok) {
          set(LINK_STATE.RECONNECTING);
          schedule(CONFIRM_MS);
        } else {
          // Espera a atual e ja dobra a proxima, com teto.
          schedule(recheckDelay);
          recheckDelay = Math.min(RECHECK_MAX_MS, recheckDelay * 2);
        }
        return;
      }
      // RECONNECTING: a segunda resposta boa confirma.
      if (ok) {
        set(LINK_STATE.ONLINE);
      } else {
        set(LINK_STATE.OFFLINE);
        recheckDelay = RECHECK_BASE_MS;
        schedule(recheckDelay);
      }
    } finally {
      checking = false;
      if (rerun && !disposed) {
        rerun = false;
        void check();
      }
    }
  }

  function wait(ms: number) {
    return new Promise<void>((resolve) => setTimer(resolve, ms));
  }

  if (state === LINK_STATE.OFFLINE) schedule(0);

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Evidencia de queda (evento `offline`, falha de rede na fila): confirma. */
    signalDown() {
      if (state === LINK_STATE.ONLINE) void check();
    },
    /** Evidencia de volta (evento `online`, primeiro plano, gesto): confirma. */
    signalUp() {
      if (state !== LINK_STATE.ONLINE) {
        // A rede costuma levar alguns instantes para responder depois do evento.
        recheckDelay = RECHECK_BASE_MS;
        if (timer) clearTimer(timer);
        timer = null;
        void check();
      }
    },
    dispose() {
      disposed = true;
      if (timer) clearTimer(timer);
      listeners.clear();
    },
  };
}

export type ConnectivityMonitor = ReturnType<typeof createConnectivityMonitor>;

/** Liga o monitor aos eventos do navegador. Devolve a funcao de desligar. */
export function attachBrowserSignals(monitor: ConnectivityMonitor) {
  const onOffline = () => monitor.signalDown();
  const onOnline = () => monitor.signalUp();
  const onVisible = () => {
    if (document.visibilityState === "visible") monitor.signalUp();
  };
  window.addEventListener("offline", onOffline);
  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
