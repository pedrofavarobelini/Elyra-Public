import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONFIRM_MS,
  LINK_STATE,
  RECHECK_MAX_MS,
  createConnectivityMonitor,
} from "@/lib/offline/connectivity";



beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function monitorWith(initial: (typeof LINK_STATE)[keyof typeof LINK_STATE], answers: boolean[]) {
  const probe = vi.fn(async () => answers.shift() ?? false);
  return { probe, monitor: createConnectivityMonitor({ initial, probe }) };
}

describe("monitor de conectividade", () => {
  it("online: uma falha isolada nao derruba o estado (anti-flicker)", async () => {
    const { monitor, probe } = monitorWith(LINK_STATE.ONLINE, [false, true]);
    monitor.signalDown();
    await vi.advanceTimersByTimeAsync(CONFIRM_MS + 100);
    expect(monitor.getState()).toBe(LINK_STATE.ONLINE);
    expect(probe).toHaveBeenCalledTimes(2);
    monitor.dispose();
  });

  it("online: duas falhas confirmadas viram OFFLINE", async () => {
    const { monitor } = monitorWith(LINK_STATE.ONLINE, [false, false]);
    monitor.signalDown();
    await vi.advanceTimersByTimeAsync(10);
    // Antes da confirmacao, a tela nao muda.
    expect(monitor.getState()).toBe(LINK_STATE.ONLINE);
    await vi.advanceTimersByTimeAsync(CONFIRM_MS + 100);
    expect(monitor.getState()).toBe(LINK_STATE.OFFLINE);
    monitor.dispose();
  });

  it("offline: volta passa por RECONNECTING e so confirma com a segunda resposta", async () => {
    const { monitor } = monitorWith(LINK_STATE.OFFLINE, [false, true, true]);
    await vi.advanceTimersByTimeAsync(10);
    expect(monitor.getState()).toBe(LINK_STATE.OFFLINE);

    monitor.signalUp();
    await vi.advanceTimersByTimeAsync(10);
    expect(monitor.getState()).toBe(LINK_STATE.RECONNECTING);

    await vi.advanceTimersByTimeAsync(CONFIRM_MS + 100);
    expect(monitor.getState()).toBe(LINK_STATE.ONLINE);
    monitor.dispose();
  });

  it("volta que cai de novo nao declara ONLINE", async () => {
    const { monitor } = monitorWith(LINK_STATE.OFFLINE, [true, false]);
    await vi.advanceTimersByTimeAsync(10);
    expect(monitor.getState()).toBe(LINK_STATE.RECONNECTING);
    await vi.advanceTimersByTimeAsync(CONFIRM_MS + 100);
    expect(monitor.getState()).toBe(LINK_STATE.OFFLINE);
    monitor.dispose();
  });

  it("offline: reverificacao cresce e tem teto, sem polling agressivo", async () => {
    const { monitor, probe } = monitorWith(LINK_STATE.OFFLINE, []);
    await vi.advanceTimersByTimeAsync(10);
    const first = probe.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(probe.mock.calls.length).toBe(first + 1);
    // Em cinco minutos de queda, um punhado de sondas — nao uma por segundo.
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(probe.mock.calls.length).toBeLessThan(5 * 60_000 / RECHECK_MAX_MS + 8);
    monitor.dispose();
  });

  it("online e estavel: nenhuma sonda agendada", async () => {
    const { monitor, probe } = monitorWith(LINK_STATE.ONLINE, []);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(probe).not.toHaveBeenCalled();
    monitor.dispose();
  });

  it("avisa os assinantes uma vez por mudanca e para ao descartar", async () => {
    const { monitor } = monitorWith(LINK_STATE.ONLINE, [false, false]);
    const listener = vi.fn();
    monitor.subscribe(listener);
    monitor.signalDown();
    await vi.advanceTimersByTimeAsync(CONFIRM_MS + 100);
    expect(listener).toHaveBeenCalledTimes(1);
    monitor.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("queda durante uma sonda em andamento nao se perde (fail-closed da OFF-4)", async () => {
    // Uma sonda comeca com rede (vai responder ok, devagar); no meio, a rede cai

    // verificacao em curso, e o estado ficava ONLINE sem rede.
    let network = true;
    let releaseSlow: (() => void) | null = null;
    const probe = vi.fn(async () => {
      if (probe.mock.calls.length === 1) {
        await new Promise<void>((resolve) => {
          releaseSlow = resolve;
        });
        return true;
      }
      return network;
    });
    const monitor = createConnectivityMonitor({ initial: LINK_STATE.ONLINE, probe });
    monitor.signalDown(); // sonda lenta em curso
    await vi.advanceTimersByTimeAsync(10);
    network = false;
    monitor.signalDown(); // o evento `offline` chega durante a sonda
    releaseSlow!();
    await vi.advanceTimersByTimeAsync(CONFIRM_MS * 2 + 100);
    expect(monitor.getState()).toBe(LINK_STATE.OFFLINE);
    monitor.dispose();
  });
});
