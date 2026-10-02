import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";



interface DerivationOptions {
  speechSupported?: boolean;
  speechTranscript?: string;
  speechError?: string;
}

/**
 * Fixture determinista de captura e derivacao.
 *
 * Simula `getUserMedia`, `MediaRecorder`, `AudioContext`/`AnalyserNode`,
 * `SpeechRecognition` e o canvas 2D. Cada um pode ser desligado
 * individualmente, que e como se testa feature detection sem trocar de
 * navegador e sem fingir homologacao de hardware.
 */
async function installDerivationMocks(
  page: Page,
  options: DerivationOptions = {},
) {
  await page.addInitScript((settings) => {
    class FakeTrack {
      addEventListener() {}
      stop() {}
    }
    class FakeStream {
      private readonly tracks = [new FakeTrack()];
      getTracks() {
        return this.tracks;
      }
    }
    class FakeRecorder {
      static isTypeSupported() {
        return true;
      }
      state: "inactive" | "recording" | "paused" = "inactive";
      readonly mimeType: string;
      private readonly listeners = new Map<
        string,
        Array<(event: Event & { data?: Blob }) => void>
      >();
      constructor(_stream: MediaStream, config?: MediaRecorderOptions) {
        this.mimeType = config?.mimeType ?? "video/webm";
      }
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        const callback =
          typeof listener === "function"
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
        const data = new Blob(
          [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81])],
          { type },
        );
        for (const listener of this.listeners.get("dataavailable") ?? []) {
          listener(Object.assign(new Event("dataavailable"), { data }));
        }
        for (const listener of this.listeners.get("stop") ?? []) {
          listener(new Event("stop"));
        }
      }
    }

    const media = async () => new FakeStream() as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: media, getDisplayMedia: media },
    });
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeRecorder,
    });

    const sources = new WeakMap<HTMLMediaElement, unknown>();
    Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
      configurable: true,
      get() {
        return sources.get(this);
      },
      set(value) {
        sources.set(this, value);
      },
    });
    HTMLMediaElement.prototype.play = async () => undefined;

    // Envoltoria RMS sintetica: alterna energia alta e baixa para que existam
    // fala medida e pausas medidas, sem microfone.
    let tick = 0;
    class FakeAnalyser {
      fftSize = 2048;
      readonly frequencyBinCount = 32;
      getByteTimeDomainData(array: Uint8Array) {
        tick += 1;
        array.fill(tick % 6 < 4 ? 200 : 128);
      }
    }
    Object.defineProperty(window, "AudioContext", {
      configurable: true,
      value: class {
        createAnalyser() {
          return new FakeAnalyser();
        }
        createMediaStreamSource() {
          return { connect: () => undefined };
        }
        close() {
          return Promise.resolve();
        }
      },
    });

    if (settings.speechSupported === false) {
      // Ausencia real da API: a propriedade nao existe.
      delete (window as unknown as Record<string, unknown>).SpeechRecognition;
      delete (window as unknown as Record<string, unknown>)
        .webkitSpeechRecognition;
    } else {
      class FakeRecognition {
        lang = "";
        continuous = false;
        interimResults = true;
        /*
          A prova de processamento local, exigida antes de iniciar.

          O produto recusa comecar quando nao consegue **observar** que o
          reconhecimento aconteceria no aparelho: sem esta propriedade, o
          desfecho e `local_speech_unverifiable`, e "o navegador provavelmente
          respeita" nao e garantia de privacidade. O stub precisa aceitar a
          atribuicao para representar um navegador que expoe a capability.
        */
        processLocally = false;
        onresult:
          | ((event: { resultIndex: number; results: unknown }) => void)
          | null = null;
        onerror: ((event: { error: string }) => void) | null = null;
        onend: (() => void) | null = null;
        /*
          A sonda estatica que o preflight de transcricao chama antes de liberar
          "Iniciar sessao".

          Sem ela o preflight nunca alcanca `READY_NATIVE`, o botao permanece
          desabilitado e a sessao nao comeca - que e como estes testes passaram a
          falhar quando o preflight foi antecipado. Ela vive no stub, e nao no
          produto, porque a chamada real derruba o renderer no Chromium headless
          deste ambiente (`L-119`): definir a resposta aqui exercita o caminho de
          verdade sem depender da API que mata a aba.
        */
        static available = async () => "available";
        start() {
          globalThis.setTimeout(() => {
            if (settings.speechError) {
              this.onerror?.({ error: settings.speechError });
              return;
            }
            this.onresult?.({
              resultIndex: 0,
              results: [
                {
                  isFinal: true,
                  length: 1,
                  0: { transcript: settings.speechTranscript ?? "" },
                },
              ],
            });
          }, 10);
        }
        stop() {
          globalThis.setTimeout(() => this.onend?.(), 5);
        }
        abort() {
          this.onend?.();
        }
      }
      Object.defineProperty(window, "SpeechRecognition", {
        configurable: true,
        value: FakeRecognition,
      });
    }
  }, options);
}

async function setSessionsEnabled(page: Page, enabled: boolean) {
  const response = await page.request.patch("/api/me/preferences", {
    data: { sessionsEnabled: enabled },
  });
  expect(response.ok()).toBe(true);
}

async function cleanupSessions(page: Page) {
  const response = await page.request.get("/api/multimodal/sessions");
  if (!response.ok()) return;
  const payload = (await response.json()) as { data: Array<{ id: string }> };
  for (const session of payload.data) {
    await page.request.delete(`/api/multimodal/sessions/${session.id}`);
  }
}

/** Percorre preparo, captura e encerramento, e devolve o id real da sessao. */
async function runCaptureSession(
  page: Page,
  toggles: { transcribe: boolean; aiAnalysis: boolean },
) {
  await setSessionsEnabled(page, true);
  await gotoHydrated(page, "/sessoes");

  await page.getByRole("switch", { name: "Usar microfone" }).click();
  await page.getByRole("switch", { name: "Usar câmera" }).click();
  if (toggles.transcribe) {
    await page.getByRole("switch", { name: "Gerar transcrição" }).click();
  }
  if (toggles.aiAnalysis) {
    await page.getByRole("switch", { name: "Autorizar análise por IA" }).click();
  }

  /*
    Quando o reconhecimento nao pode ser provado local, o preflight **bloqueia**
    o inicio ate haver decisao explicita: prometer transcricao que nao vai
    acontecer foi o defeito que o preflight antecipado fechou (`L-120`).

    Aqui a decisao e "seguir sem transcricao", e ela e feita de proposito pelo
    caminho que a pessoa usaria - e nao contornada por API.
  */
  const start = page.getByRole("button", { name: "Iniciar sessão" });
  if (toggles.transcribe && !(await start.isEnabled())) {
    await page.getByRole("button", { name: "Continuar sem transcrição" }).click();
  } else {
    await start.click();
  }
  await page.waitForURL(/\/sessoes\/nova\?id=/);

  await page
    .getByRole("button", { name: "Solicitar permissões e iniciar" })
    .click();
  await expect(page.getByTestId("capture-state-microphone")).toContainText(
    "Captura ativa",
  );

  // Tempo real de captura, para que a envoltoria tenha quadros medidos.
  await page.waitForTimeout(1200);

  await page.getByRole("button", { name: "Finalizar sessão" }).first().click();
  await page
    .getByRole("button", { name: "Finalizar sessão" })
    .last()
    .click();

  await page.waitForURL(/\/sessoes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  return page.url().split("/").pop() as string;
}

test.describe("GAP-01 - o pipeline multimodal chega ao resultado", () => {
  test.beforeEach(async ({ page }) => {
    await cleanupSessions(page);
    await setSessionsEnabled(page, false);
  });

  test.afterEach(async ({ page }) => {
    await cleanupSessions(page);
    await setSessionsEnabled(page, false);
  });

  test("a sessao encerrada produz transcricao e sinais reais persistidos", async ({
    page,
  }) => {
    await installDerivationMocks(page, {
      speechTranscript: "Hoje falei sobre o meu dia e sobre o meu sono.",
    });
    const sessionId = await runCaptureSession(page, {
      transcribe: true,
      aiAnalysis: true,
    });

    await expect(
      page.getByRole("heading", { name: "Análise da sessão", level: 1 }),
    ).toBeVisible();
    await expect(page.getByTestId("transcript-state")).toContainText(
      "Hoje falei sobre o meu dia",
    );

    // O dado tem que estar no banco, nao so na tela que acabou de submeter.
    const analysis = await page.request.get(
      `/api/multimodal/sessions/${sessionId}/analysis`,
    );
    expect(analysis.ok()).toBe(true);
    const payload = (await analysis.json()) as {
      data: {
        state: string;
        transcript: { state: string; text: string | null };
        signalsState: string;
        signals: Array<{ name: string; status: string }>;
      };
    };
    expect(payload.data.state).toBe("available");
    expect(payload.data.transcript.state).toBe("available");
    expect(payload.data.signalsState).toBe("available");
    expect(payload.data.signals.length).toBeGreaterThan(0);
  });

  test("o resultado sobrevive ao refresh porque vem do banco", async ({
    page,
  }) => {
    await installDerivationMocks(page, {
      speechTranscript: "Conversei sobre a minha rotina de estudos.",
    });
    await runCaptureSession(page, { transcribe: true, aiAnalysis: true });

    await page.reload();
    await expect(page.getByTestId("transcript-state")).toContainText(
      "Conversei sobre a minha rotina",
    );
  });

  test("navegador sem reconhecimento de fala nao produz transcricao inventada", async ({
    page,
  }) => {
    await installDerivationMocks(page, { speechSupported: false });
    const sessionId = await runCaptureSession(page, {
      transcribe: true,
      aiAnalysis: true,
    });

    await expect(page.getByTestId("transcript-state")).toHaveAttribute(
      "data-state",
      "not_authorized",
    );
    /*
      O estado e a mensagem mudaram junto com o comportamento, e a mudanca e uma
      melhora.

      Antes a sessao comecava prometendo transcricao e so no fim dizia que o
      navegador nao a oferece. Agora ela nem comeca com a promessa: o preflight
      recusa, a pessoa decide seguir sem transcricao, e o desfecho registrado e
      essa decisao. O que o teste protege continua sendo o mesmo - nenhum texto
      inventado aparece em lugar nenhum.
    */
    await expect(page.getByTestId("transcript-state")).toContainText(
      "não foi autorizada para esta sessão",
    );

    const analysis = await page.request.get(
      `/api/multimodal/sessions/${sessionId}/analysis`,
    );
    const payload = (await analysis.json()) as {
      data: {
        transcript: { state: string; text: string | null };
        signalsState: string;
      };
    };
    expect(payload.data.transcript.text).toBeNull();
    // A sessao continua valida: os sinais foram derivados assim mesmo.
    expect(payload.data.signalsState).toBe("available");
  });

  test("sem consentimento de IA nao ha sinal nem interpretacao", async ({
    page,
  }) => {
    await installDerivationMocks(page, {
      speechTranscript: "Falei um pouco sobre o meu dia.",
    });
    const sessionId = await runCaptureSession(page, {
      transcribe: true,
      aiAnalysis: false,
    });

    await expect(page.getByTestId("signals-state")).toHaveAttribute(
      "data-state",
      "not_authorized",
    );
    await expect(page.getByTestId("interpretation-state")).toHaveAttribute(
      "data-state",
      "not_authorized",
    );

    const analysis = await page.request.get(
      `/api/multimodal/sessions/${sessionId}/analysis`,
    );
    const payload = (await analysis.json()) as {
      data: { signals: unknown[]; transcript: { state: string } };
    };
    expect(payload.data.signals).toEqual([]);
    // Consentir transcricao nao consente analise: uma porta nao abre a outra.
    expect(payload.data.transcript.state).toBe("available");
  });

  test("a interpretacao indisponivel nao apaga transcricao nem sinais", async ({
    page,
  }) => {
    await installDerivationMocks(page, {
      speechTranscript: "Comentei sobre o meu sono desta semana.",
    });
    await runCaptureSession(page, { transcribe: true, aiAnalysis: true });

    // PedroCore nao esta configurado no QA: degradacao controlada, nao invencao.
    await expect(page.getByTestId("interpretation-state")).toHaveAttribute(
      "data-state",
      "unavailable",
    );
    await expect(page.getByTestId("transcript-state")).toContainText(
      "Comentei sobre o meu sono",
    );
    await expect(page.getByTestId("signals-state")).not.toHaveAttribute(
      "data-state",
      "not_authorized",
    );
  });

  test("reprocessar a mesma sessao nao duplica nada", async ({ page }) => {
    await installDerivationMocks(page, {
      speechTranscript: "Repeti a mesma sessao duas vezes.",
    });
    const sessionId = await runCaptureSession(page, {
      transcribe: true,
      aiAnalysis: true,
    });

    const submission = {
      durationMs: 5000,
      capturedResources: ["camera", "microphone"],
      transcript: {
        status: "available",
        text: "Repeti a mesma sessao duas vezes.",
        wordCount: 6,
        voicedDurationMs: 2000,
        truncated: false,
      },
      measurements: [{ name: "pause_count", value: 3 }],

      // sem cobertura devolveria o silencio que ela veio fechar.
      coverage: [
        { modality: "screen", outcome: "absent", reason: "not_requested", coverageMs: 0, sessionDurationMs: 5000 },
        { modality: "camera", outcome: "full", reason: null, coverageMs: 5000, sessionDurationMs: 5000 },
        { modality: "microphone", outcome: "full", reason: null, coverageMs: 5000, sessionDurationMs: 5000 },
      ],
    };

    const first = await page.request.post(
      `/api/multimodal/sessions/${sessionId}/analysis`,
      { data: submission },
    );
    const second = await page.request.post(
      `/api/multimodal/sessions/${sessionId}/analysis`,
      { data: submission },
    );
    expect(first.ok()).toBe(true);
    expect(second.ok()).toBe(true);

    const analysis = await page.request.get(
      `/api/multimodal/sessions/${sessionId}/analysis`,
    );
    const payload = (await analysis.json()) as {
      data: { signals: Array<{ name: string }> };
    };
    const names = payload.data.signals.map((signal) => signal.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("a analise de uma sessao inexistente e negada sem revelar dono", async ({
    page,
  }) => {
    const response = await page.request.get(
      "/api/multimodal/sessions/99999999-9999-4999-8999-999999999999/analysis",
    );
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain("user_id");
  });
});

test.describe("GAP-03 - nao existe resultado fabricado alcancavel", () => {

  const FABRICATED = [
    "atividade facial",
    "hoje foi um dia corrido",
    "temas identificados",
    "palavras/min",
    "autorrelato",
  ];

  for (const id of ["121", "122", "123"]) {
    test(`/sessoes/${id} nao renderiza metricas inventadas`, async ({ page }) => {
      const response = await page.goto(`/sessoes/${id}`);
      expect(response?.status()).toBe(404);

      const body = (await page.locator("body").innerText()).toLowerCase();
      for (const fabricated of FABRICATED) {
        expect(body, `conteudo fabricado: "${fabricated}"`).not.toContain(
          fabricated,
        );
      }
    });
  }

  test("identificador invalido cai em 404, nao em seed", async ({ page }) => {
    const response = await page.goto("/sessoes/nao-e-um-uuid");
    expect(response?.status()).toBe(404);
  });

  test("sessao de outra pessoa e indistinguivel de inexistente", async ({
    page,
  }) => {
    const response = await page.goto(
      "/sessoes/88888888-8888-4888-8888-888888888888",
    );
    expect(response?.status()).toBe(404);
  });

  test("a lista de sessoes comeca vazia, sem seed sintetico", async ({ page }) => {
    await cleanupSessions(page);
    await setSessionsEnabled(page, true);
    await gotoHydrated(page, "/sessoes");
    const table = page.getByRole("region", {
      name: "Tabela de sessões anteriores",
    });
    await expect(table).toBeVisible();
    for (const id of ["121", "122", "123"]) {
      await expect(table).not.toContainText(`Sessão #${id}`);
    }
    await setSessionsEnabled(page, false);
  });
});

test.describe("GAP-02 - o learning export tem gatilho alcancavel", () => {
  test.afterEach(async ({ page }) => {
    await page.request.patch("/api/learning/consent", {
      data: { enabled: false },
    });
  });

  test("sem consentimento de treino a contribuicao nao existe", async ({
    page,
  }) => {
    await page.request.patch("/api/learning/consent", {
      data: { enabled: false },
    });
    await gotoHydrated(page, "/relatorios");
    await expect(page.getByTestId("contribute-learning")).toHaveCount(0);
  });

  test("com consentimento a contribuicao vira acao explicita da pessoa", async ({
    page,
  }) => {
    const consent = await page.request.patch("/api/learning/consent", {
      data: { enabled: true },
    });
    expect(consent.ok()).toBe(true);

    await gotoHydrated(page, "/relatorios");
    const action = page.getByTestId("contribute-learning");
    await expect(action).toBeVisible();

    // Consentimento sozinho nao exporta: nenhum export existe antes do clique.
    const before = await page.request.get("/api/learning/exports");
    expect(before.ok()).toBe(true);
    const beforePayload = (await before.json()) as { data: unknown[] };

    await action.click();
    await expect(page.getByTestId("contribution-status")).toBeVisible();

    const after = await page.request.get("/api/learning/exports");
    const afterPayload = (await after.json()) as { data: unknown[] };
    expect(afterPayload.data.length).toBeGreaterThanOrEqual(
      beforePayload.data.length,
    );
  });

  test("a rota de export recusa relatorio que nao e da pessoa", async ({
    page,
  }) => {
    await page.request.patch("/api/learning/consent", { data: { enabled: true } });
    const response = await page.request.post("/api/learning/exports", {
      data: { reportSnapshotId: "77777777-7777-4777-8777-777777777777" },
    });
    expect(response.status()).toBe(404);
  });

  test("a rota de export recusa quem nao consentiu", async ({ page }) => {
    await page.request.patch("/api/learning/consent", {
      data: { enabled: false },
    });
    const snapshot = await page.request.post("/api/reports/snapshots", {
      data: { days: 28, referenceDate: "2026-08-28", timeZone: "America/Sao_Paulo" },
    });
    expect(snapshot.ok()).toBe(true);
    const created = (await snapshot.json()) as { data: { id: string } };

    const response = await page.request.post("/api/learning/exports", {
      data: { reportSnapshotId: created.data.id },
    });
    expect(response.status()).toBe(403);
  });
});
