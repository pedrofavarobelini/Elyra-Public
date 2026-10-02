import { describe, expect, it, vi } from "vitest";

import {
  canStartSession,
  captureErrorState,
  detectCaptureCapabilities,
  initialCaptureStates,
} from "@/lib/multimodal-capture";

describe("multimodal capture capabilities", () => {
  it("usa feature detection e nunca user agent", () => {
    const capabilities = detectCaptureCapabilities({
      secureContext: true,
      mediaRecorder: class {} as unknown as typeof MediaRecorder,
      mediaDevices: { getUserMedia: vi.fn(), getDisplayMedia: vi.fn() },
    });
    expect(capabilities).toEqual({
      screen: true,
      camera: true,
      microphone: true,
      mediaRecorder: true,
      secureContext: true,
    });
    expect(initialCaptureStates(capabilities)).toEqual({
      screen: "supported",
      camera: "supported",
      microphone: "supported",
    });
  });

  it("desabilita honestamente API ausente ou contexto inseguro", () => {
    expect(detectCaptureCapabilities({
      secureContext: false,
      mediaRecorder: class {} as unknown as typeof MediaRecorder,
      mediaDevices: { getUserMedia: vi.fn() },
    })).toMatchObject({ screen: false, camera: false, microphone: false });

    expect(detectCaptureCapabilities({
      secureContext: true,
      mediaRecorder: class {} as unknown as typeof MediaRecorder,
      mediaDevices: { getDisplayMedia: vi.fn() },
    })).toMatchObject({ screen: true, camera: false, microphone: false });

    expect(detectCaptureCapabilities({
      secureContext: true,
      mediaRecorder: class {} as unknown as typeof MediaRecorder,
    })).toMatchObject({ screen: false, camera: false, microphone: false });
  });

  it("distingue deny de cancelamento do seletor de tela", () => {
    const denied = { name: "NotAllowedError" };
    expect(captureErrorState("camera", denied)).toBe("denied");
    expect(captureErrorState("microphone", denied)).toBe("denied");
    expect(captureErrorState("screen", denied)).toBe("cancelled");
    expect(captureErrorState("screen", { name: "AbortError" })).toBe("cancelled");
    expect(captureErrorState("camera", { name: "NotFoundError" })).toBe("unsupported");
    expect(captureErrorState("camera", new Error("synthetic"))).toBe("error");
  });
});

/**
 * Finding do Human QA fisico em iPhone.
 *
 * Safari no iPhone expoe `getUserMedia` (camera e microfone) e **nao** expoe
 * `getDisplayMedia` (compartilhamento de tela). A degradacao correta e informar
 * a limitacao e seguir - nunca bloquear a sessao inteira, nunca chamar isso de
 * permissao negada, nunca prometer autorizacao futura.
 */
describe("iPhone / Safari - degradacao de compartilhamento de tela", () => {
  const iphone = detectCaptureCapabilities({
    secureContext: true,
    mediaRecorder: class {} as unknown as typeof MediaRecorder,
    // Exatamente o que o Safari do iPhone oferece: sem `getDisplayMedia`.
    mediaDevices: { getUserMedia: vi.fn() },
  });

  it("detecta tela como nao suportada sem derrubar camera e microfone", () => {
    expect(iphone).toMatchObject({
      screen: false,
      camera: true,
      microphone: true,
      secureContext: true,
    });
  });

  it("marca a tela como unsupported, que e estado distinto de denied", () => {
    const states = initialCaptureStates(iphone);
    expect(states.screen).toBe("unsupported");
    expect(states.camera).toBe("supported");
    expect(states.microphone).toBe("supported");
    // `unsupported` nunca pode ser confundido com recusa da pessoa: uma se
    // resolve trocando de navegador, a outra e uma decisao dela.
    expect(states.screen).not.toBe("denied");
  });

  it("SCREEN_UNSUPPORTED nao torna a sessao indisponivel", () => {
    const states = initialCaptureStates(iphone);
    expect(
      canStartSession({ screen: false, camera: true, microphone: false }, states),
    ).toBe(true);
    expect(
      canStartSession({ screen: false, camera: false, microphone: true }, states),
    ).toBe(true);
    // Mesmo com a tela autorizada, o que decide e haver algo suportado.
    expect(
      canStartSession({ screen: true, camera: true, microphone: false }, states),
    ).toBe(true);
  });

  it("so bloqueia quando nada do que foi autorizado e suportado", () => {
    const states = initialCaptureStates(iphone);
    expect(
      canStartSession({ screen: true, camera: false, microphone: false }, states),
    ).toBe(false);
    expect(
      canStartSession({ screen: false, camera: false, microphone: false }, states),
    ).toBe(false);
  });

  it("nao trata ausencia da API como permissao negada", () => {
    // `NotFoundError` e o que o navegador devolve quando a API nao existe ou
    // nao ha dispositivo: e limitacao, nao recusa.
    expect(captureErrorState("screen", { name: "NotFoundError" })).toBe(
      "unsupported",
    );
    expect(captureErrorState("screen", { name: "NotFoundError" })).not.toBe(
      "denied",
    );
  });
});
