import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isReducedMotion, subscribeReducedMotion } from "./motion";
import { useChartAnimation, usePrefersReducedMotion } from "./use-reduced-motion";

let systemReduce = false;
const listeners = new Set<() => void>();

beforeEach(() => {
  systemReduce = false;
  listeners.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    get matches() {
      return query.includes("reduce") ? systemReduce : false;
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }));
  document.documentElement.setAttribute("data-elyra-motion", "system");
  Object.defineProperty(navigator, "webdriver", { value: false, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-elyra-motion");
});

describe("movimento reduzido: fonte unica (MOTION-GAP-01)", () => {
  it("sistema sem reduce e Elyra em system: anima", () => {
    expect(isReducedMotion()).toBe(false);
  });

  it("preferencia interna reduce vale mesmo com o sistema sem reduce", () => {
    document.documentElement.setAttribute("data-elyra-motion", "reduce");
    expect(isReducedMotion()).toBe(true);
  });

  it("sistema em reduce vale mesmo com a Elyra em system (a interna so reduz)", () => {
    systemReduce = true;
    expect(isReducedMotion()).toBe(true);
  });

  it("o hook reage a troca da preferencia interna sem recarregar", async () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    await act(async () => {
      document.documentElement.setAttribute("data-elyra-motion", "reduce");
      await Promise.resolve();
    });
    expect(result.current).toBe(true);
  });

  it("o hook reage a troca do sistema", () => {
    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);
    act(() => {
      systemReduce = true;
      for (const cb of listeners) cb();
    });
    expect(result.current).toBe(true);
  });

  it("grafico nao anima com a preferencia interna em reduce", () => {
    document.documentElement.setAttribute("data-elyra-motion", "reduce");
    const { result } = renderHook(() => useChartAnimation(30, true));
    expect(result.current).toBe(false);
  });

  it("grafico anima com dado real, sem reduce, fora de automacao", () => {
    const { result } = renderHook(() => useChartAnimation(30, true));
    expect(result.current).toBe(true);
  });

  it("cancelar a inscricao solta os dois ouvintes", () => {
    const cb = vi.fn();
    const off = subscribeReducedMotion(cb);
    expect(listeners.size).toBe(1);
    off();
    expect(listeners.size).toBe(0);
  });
});
