import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceWorkerRegistrar } from "@/components/layout/service-worker-registrar";



type Listener = () => void;

function fakeServiceWorker(options: { controlled: boolean }) {
  const containerListeners = new Map<string, Listener>();
  const registrationListeners = new Map<string, Listener>();
  const workerListeners = new Map<string, Listener>();
  const installing = {
    state: "installing",
    postMessage: vi.fn(),
    addEventListener: (type: string, listener: Listener) => workerListeners.set(type, listener),
  };
  const registration = {
    waiting: null,
    installing,
    addEventListener: (type: string, listener: Listener) => registrationListeners.set(type, listener),
  };
  const container = {
    controller: options.controlled ? {} : null,
    register: vi.fn(async () => registration),
    addEventListener: (type: string, listener: Listener) => containerListeners.set(type, listener),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: container });
  return {
    installing,
    finishInstall() {
      installing.state = "installed";
      registrationListeners.get("updatefound")?.();
      workerListeners.get("statechange")?.();
    },
    takeControl() {
      containerListeners.get("controllerchange")?.();
    },
  };
}

const reload = vi.fn();

afterEach(() => {
  cleanup();
  reload.mockReset();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("ServiceWorkerRegistrar", () => {
  it("avisa versao nova e so recarrega depois do gesto", async () => {
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, reload } });
    const sw = fakeServiceWorker({ controlled: true });
    render(<ServiceWorkerRegistrar />);
    await act(async () => {
      window.dispatchEvent(new Event("load"));
      await Promise.resolve();
    });
    await act(async () => sw.finishInstall());

    const prompt = await screen.findByRole("status");
    expect(prompt).toHaveTextContent("Nova versão da Elyra disponível");
    expect(prompt).toHaveTextContent("Suas alterações ficam guardadas");

    // Troca de controle sem gesto nao recarrega.
    sw.takeControl();
    expect(reload).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(sw.installing.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    sw.takeControl();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("primeira instalacao nao mostra aviso", async () => {
    const sw = fakeServiceWorker({ controlled: false });
    render(<ServiceWorkerRegistrar />);
    await act(async () => {
      window.dispatchEvent(new Event("load"));
      await Promise.resolve();
    });
    await act(async () => sw.finishInstall());
    expect(screen.queryByRole("status")).toBeNull();
  });
});
