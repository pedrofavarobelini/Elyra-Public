import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { OfflineBanner } from "@/components/layout/offline-banner";
import { ConnectivityContext } from "@/components/offline/connectivity";
import { OfflineGatewayContext } from "@/components/offline/offline-context";
import { LINK_STATE, type ConnectivityMonitor } from "@/lib/offline/connectivity";
import type { OfflineGateway } from "@/lib/offline/gateway";

/** Monitor de mentira, com o estado que o teste quiser. */
function fakeMonitor(state: (typeof LINK_STATE)[keyof typeof LINK_STATE]): ConnectivityMonitor {
  return {
    getState: () => state,
    subscribe: () => () => undefined,
    signalDown: () => undefined,
    signalUp: () => undefined,
    dispose: () => undefined,
  };
}

const fakeGateway = { mode: "online" } as unknown as OfflineGateway;

function renderWithCore(state: (typeof LINK_STATE)[keyof typeof LINK_STATE]) {
  return render(
    <ConnectivityContext.Provider value={fakeMonitor(state)}>
      <OfflineGatewayContext.Provider value={fakeGateway}>
        <OfflineBanner />
      </OfflineGatewayContext.Provider>
    </ConnectivityContext.Provider>,
  );
}

/**
 * O aviso de rede, provado pelo comportamento do navegador.
 *
 * Nao ha `setState` nem efeito aqui: o componente le um estado que vive fora do
 * React por `useSyncExternalStore`. O teste dirige os eventos reais
 * (`online`/`offline`) em vez de manipular estado interno — se a assinatura
 * quebrar, isto reprova.
 */

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => value,
  });
}

afterEach(() => {
  cleanup();
  setOnline(true);
});

describe("aviso de rede indisponivel", () => {
  it("nao ocupa espaco quando ha conexao", () => {
    setOnline(true);
    const { container } = render(<OfflineBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("aparece ao perder a conexao, e some ao recuperar", () => {
    setOnline(true);
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();

    setOnline(false);
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByTestId("offline-banner")).toBeVisible();

    setOnline(true);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });

  it("diz o que continua na tela, e nao promete envio automatico", () => {
    setOnline(false);
    render(<OfflineBanner />);
    const aviso = screen.getByTestId("offline-banner");

    expect(aviso).toHaveTextContent("Você está sem conexão.");
    expect(aviso).toHaveTextContent("continua nesta tela");
    /*
      A promessa que o aviso NAO pode fazer: reenvio sozinho. Retry silencioso
      em rede instavel duplica registro quando a primeira tentativa chegou e a
      resposta se perdeu.
    */
    expect(aviso).toHaveTextContent("nada é enviado sozinho");
    expect(aviso.textContent ?? "").not.toMatch(/enviaremos|reenviar automat/i);
  });

  it("com a camada offline, so a queda confirmada acende o aviso", () => {
    /*
      Rede que pisca: `navigator.onLine` ja diz "sem rede", mas o monitor ainda
      esta confirmando. Acender e apagar a faixa aqui seria flicker.
    */
    setOnline(false);
    const { container, unmount } = renderWithCore(LINK_STATE.ONLINE);
    expect(container).toBeEmptyDOMElement();
    unmount();

    renderWithCore(LINK_STATE.RECONNECTING);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    cleanup();

    renderWithCore(LINK_STATE.OFFLINE);
    const aviso = screen.getByTestId("offline-banner");
    expect(aviso).toHaveTextContent("guardam o que você registrar neste aparelho");
  });

  it("e anunciado como estado, e nao como alerta", () => {
    /*
      `status` com `aria-live="polite"`: a perda de rede nao interrompe quem
      esta digitando. `alert` roubaria o foco do leitor de tela no meio de uma
      frase.
    */
    setOnline(false);
    render(<OfflineBanner />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});
