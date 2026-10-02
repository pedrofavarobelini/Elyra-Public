import { expect, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";

/** MediaDevices/MediaRecorder sinteticos e deterministas; nunca contam como QA fisico. */
export async function installDeterministicMedia(page: Page) {
  /*
    A resposta da sonda de reconhecimento de fala, definida aqui em vez de
    deixada para a API real do navegador.

    `SpeechRecognition.available()` derruba o processo de renderizacao no
    Chromium headless deste ambiente (`L-119`) - um crash que nenhum `try/catch`
    do produto captura. Desde que o preflight de transcricao foi antecipado,
    ligar "Gerar transcricao" dispara a sonda, e a aba morria em qualquer spec
    que tocasse esse toggle.

    Nao e defeito do produto: no Chrome real a mesma chamada funciona. Definir a
    resposta aqui exercita o caminho de verdade - sonda positiva, nativo pronto -
    sem depender da API que mata a aba.

    Fica junto dos mocks de midia porque a razao e a mesma: tornar deterministico
    o que o ambiente headless nao entrega de forma confiavel.
  */
  await page.addInitScript(() => {
    class SpeechProbeStub {
      static available = async () => "available";
      /* A capability de privacidade precisa ser observavel: ver `L-120`. */
      processLocally = false;
      lang = "";
      continuous = false;
      interimResults = true;
      onresult: unknown = null;
      onerror: unknown = null;
      onend: (() => void) | null = null;
      start() {}
      stop() {
        globalThis.setTimeout(() => this.onend?.(), 5);
      }
      abort() {
        this.onend?.();
      }
    }
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Object.defineProperty(window, name, {
        configurable: true,
        value: SpeechProbeStub,
      });
    }
  });

  await page.addInitScript(() => {
    class Track {
      addEventListener() {}
      stop() {}
    }
    class Stream {
      getTracks() { return [new Track()]; }
    }
    class Recorder {
      static isTypeSupported() { return true; }
      state: "inactive" | "recording" | "paused" = "inactive";
      readonly mimeType: string;
      private listeners = new Map<string, Array<(event: Event & { data?: Blob }) => void>>();
      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        this.mimeType = options?.mimeType ?? "video/webm";
      }
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        const callback = typeof listener === "function"
          ? listener
          : (event: Event) => listener.handleEvent(event);
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback as (event: Event & { data?: Blob }) => void]);
      }
      start() { this.state = "recording"; }
      pause() { this.state = "paused"; }
      resume() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        const type = this.mimeType.split(";", 1)[0] ?? "video/webm";
        const data = new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81])], { type });
        for (const listener of this.listeners.get("dataavailable") ?? []) listener(Object.assign(new Event("dataavailable"), { data }));
        for (const listener of this.listeners.get("stop") ?? []) listener(new Event("stop"));
      }
    }
    const media = async () => new Stream() as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: media, getDisplayMedia: media },
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: Recorder,
    });
  });
}

export async function resetMultimodalQa(page: Page) {
  const response = await page.request.get("/api/multimodal/sessions");
  if (response.ok()) {
    const payload = (await response.json()) as { data: Array<{ id: string }> };
    for (const session of payload.data) {
      await page.request.delete(`/api/multimodal/sessions/${session.id}`);
    }
  }
  const disabled = await page.request.patch("/api/me/preferences", {
    data: { sessionsEnabled: false },
  });
  if (!disabled.ok()) throw new Error("Nao foi possivel resetar o fixture multimodal.");
}


export async function installMediaMocks(
  page: Page,
  options: {
    screenSupported?: boolean;
    cancelScreen?: boolean;
    denyCamera?: boolean;
    denyMicrophone?: boolean;
  } = {},
) {
  await page.addInitScript((settings) => {
    (window as unknown as { __stage11MediaCalls: number }).__stage11MediaCalls = 0;
    (window as unknown as { __stage11StoppedTracks: number }).__stage11StoppedTracks = 0;
    const tracks: FakeTrack[] = [];

    class FakeTrack {
      private listeners = new Map<string, Array<() => void>>();
      addEventListener(type: string, listener: () => void) {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
      }
      stop() {
        (window as unknown as { __stage11StoppedTracks: number }).__stage11StoppedTracks += 1;
      }
      end() {
        for (const listener of this.listeners.get("ended") ?? []) listener();
      }
    }

    class FakeStream {
      private readonly tracks = [new FakeTrack()];
      constructor() {
        tracks.push(...this.tracks);
      }
      getTracks() {
        return this.tracks;
      }
    }

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }
      state: "inactive" | "recording" | "paused" = "inactive";
      readonly mimeType: string;
      private readonly listeners = new Map<string, Array<(event: Event & { data?: Blob }) => void>>();
      constructor(_stream: MediaStream, config?: MediaRecorderOptions) {
        this.mimeType = config?.mimeType ?? "video/webm";
      }
      addEventListener(
        type: string,
        listener: EventListenerOrEventListenerObject,
      ) {
        const callback = typeof listener === "function"
          ? listener
          : (event: Event) => listener.handleEvent(event);
        this.listeners.set(type, [
          ...(this.listeners.get(type) ?? []),
          callback as (event: Event & { data?: Blob }) => void,
        ]);
      }
      start() {
        this.state = "recording";
      }
      pause() {
        this.state = "paused";
      }
      resume() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        const type = this.mimeType.split(";", 1)[0] ?? "video/webm";
        const data = new Blob([
          new Uint8Array([
            0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81,
            0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81,
          ]),
        ], { type });
        for (const listener of this.listeners.get("dataavailable") ?? []) {
          listener(Object.assign(new Event("dataavailable"), { data }));
        }
        for (const listener of this.listeners.get("stop") ?? []) {
          listener(new Event("stop"));
        }
      }
    }

    // O Chromium headless pode nao expor um MediaStream nativo utilizavel em
    // `video.srcObject`. O fixture controla tambem essa borda visual para que
    // o teste exercite a orquestracao, sem fingir homologacao de hardware.
    const mediaSources = new WeakMap<HTMLMediaElement, unknown>();
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get() {
        return mediaSources.get(this);
      },
      set(value) {
        mediaSources.set(this, value);
      },
    });
    HTMLMediaElement.prototype.play = async () => undefined;

    (window as unknown as { __stage11EndTracks: () => void }).__stage11EndTracks = () => {
      for (const track of tracks) track.end();
    };

    const getUserMedia = async (constraints?: MediaStreamConstraints) => {
      (window as unknown as { __stage11MediaCalls: number }).__stage11MediaCalls += 1;
      if (
        (Boolean(constraints?.video) && settings.denyCamera)
        || (Boolean(constraints?.audio) && settings.denyMicrophone)
      ) {
        throw new DOMException("denied by synthetic user", "NotAllowedError");
      }
      return new FakeStream() as unknown as MediaStream;
    };
    const devices: {
      getUserMedia: typeof navigator.mediaDevices.getUserMedia;
      getDisplayMedia?: typeof navigator.mediaDevices.getDisplayMedia;
    } = { getUserMedia };
    if (settings.screenSupported !== false) {
      devices.getDisplayMedia = async () => {
        (window as unknown as { __stage11MediaCalls: number }).__stage11MediaCalls += 1;
        if (settings.cancelScreen) {
          throw new DOMException("cancelled by synthetic user", "NotAllowedError");
        }
        return new FakeStream() as unknown as MediaStream;
      };
    }
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: devices,
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });
  }, options);
}

export async function setSessionsEnabled(page: Page, enabled: boolean) {
  const response = await page.request.patch("/api/me/preferences", {
    data: { sessionsEnabled: enabled },
  });
  expect(response.ok()).toBe(true);
}

export async function cleanupSessions(page: Page) {
  const response = await page.request.get("/api/multimodal/sessions");
  if (!response.ok()) return;
  const payload = (await response.json()) as { data: Array<{ id: string }> };
  for (const session of payload.data) {
    const deleted = await page.request.delete(
      `/api/multimodal/sessions/${session.id}`,
    );
    expect(deleted.ok()).toBe(true);
  }
}

export async function openEnabledSessions(page: Page) {
  await setSessionsEnabled(page, true);
  await gotoHydrated(page, "/sessoes");
  await expect(
    page.getByRole("heading", { name: "Sessões multimodais", level: 2, exact: true }),
  ).toBeVisible();
}
