import { expect, test, type Page } from "@playwright/test";

import { installMediaMocks, openEnabledSessions, setSessionsEnabled } from "./multimodal-mocks";
import { openNav } from "./nav";
import { newAsrDiagnostic } from "../../src/lib/speech/physical-diagnostic";



const VISUAL_TOGGLE = "Analisar sinais visuais";

async function stubNativeAsrUnavailable(page: Page, answer: "unavailable" | "downloadable" = "unavailable") {
  await page.addInitScript((value) => {
    const stub = { available: async () => value };
    for (const name of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      const existing = (window as unknown as Record<string, unknown>)[name];
      if (typeof existing === "function") {
        Object.defineProperty(existing, "available", {
          value: stub.available,
          configurable: true,
        });
        Object.defineProperty(existing, "install", {
          value: async () => false,
          configurable: true,
        });
      }
    }
  }, answer);
}

test.describe("Stage 22-V - consentimento de analise visual", () => {
  test.afterEach(async ({ page }) => {
    await setSessionsEnabled(page, false);
  });

  test("diagnostico ASR QA atravessa navegacao somente com metricas sanitizadas", async ({ page }) => {
    await installMediaMocks(page);
    await openEnabledSessions(page);
    await page.getByRole("switch", { name: "Usar microfone" }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await expect(page.getByRole("button", { name: "Solicitar permissões e iniciar" })).toBeVisible();
    const id = new URL(page.url()).searchParams.get("id")!;
    // Fixture exclusivamente de transporte do snapshot; nao simula prova de voz/Whisper.
    const diagnostic = newAsrDiagnostic();
    Object.assign(diagnostic, { sessionDurationMs: 72201, pcmSampleCount: 0, pcmDurationMs: 0,
      pcmPeakAbs: 0, pcmRms: 0, finalTranscriptStatus: "failed" });
    await page.evaluate(({ id, diagnostic }) => {
      sessionStorage.setItem(`elyra:qa:asr:${id}`, JSON.stringify(diagnostic));
    }, { id, diagnostic });
    const diagnosticRequests: string[] = [];
    page.on("request", (request) => {
      if (/pcmSampleCount|firstObservedFailure/.test(request.postData() ?? "")) diagnosticRequests.push(request.url());
    });
    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
    await expect(page.getByTestId("capture-state-microphone")).toHaveText("Captura ativa");
    await page.getByRole("button", { name: "Finalizar sessão" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Finalizar sessão" }).click();
    await expect(page.getByRole("heading", { name: "Análise da sessão", level: 1 })).toBeVisible();
    const panel = page.getByTestId("asr-diagnostic-panel");
    if (process.env.NEXT_PUBLIC_ASR_QA_DIAGNOSTICS !== "1") {
      // Build normal: o mesmo snapshot local nao pode expor um painel de QA.
      await expect(panel).toHaveCount(0);
      expect(diagnosticRequests).toEqual([]);
      return;
    }
    await expect(panel).toContainText("session_duration_ms=72201");
    await expect(panel).toContainText("FIRST_BROKEN_LINK=PCM");
    const stored = await page.evaluate((id) => sessionStorage.getItem(`elyra:qa:asr:${id}`), id);
    const keys = Object.keys(JSON.parse(stored!));
    for (const forbidden of ["pcm", "audio", "rawText", "text", "discardedText", "waveform"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(diagnosticRequests).toEqual([]);
    await page.getByRole("button", { name: "Remover diagnóstico local" }).click();
    await expect(panel).toHaveCount(0);
    expect(await page.evaluate((id) => sessionStorage.getItem(`elyra:qa:asr:${id}`), id)).toBeNull();
  });

  test("nasce desligada e indisponivel sem camera", async ({ page }) => {
    await installMediaMocks(page);
    await openEnabledSessions(page);

    const toggle = page.getByRole("switch", { name: VISUAL_TOGGLE });
    await expect(toggle).toBeDisabled();
    await expect(toggle).not.toBeChecked();
  });

  test("a camera habilita a decisao, mas nao a toma", async ({ page }) => {
    await installMediaMocks(page);
    await openEnabledSessions(page);

    await page.getByRole("switch", { name: "Usar câmera" }).click();

    const toggle = page.getByRole("switch", { name: VISUAL_TOGGLE });
    await expect(toggle).toBeEnabled();

    await expect(toggle).not.toBeChecked();
  });

  test("desligar a camera desliga a analise visual junto", async ({ page }) => {
    await installMediaMocks(page);
    await openEnabledSessions(page);

    await page.getByRole("switch", { name: "Usar câmera" }).click();
    await page.getByRole("switch", { name: VISUAL_TOGGLE }).click();
    await expect(page.getByRole("switch", { name: VISUAL_TOGGLE })).toBeChecked();

    await page.getByRole("switch", { name: "Usar câmera" }).click();

    // Deixar a analise marcada com a camera desligada sugeriria que algo
    // continua sendo observado.
    const toggle = page.getByRole("switch", { name: VISUAL_TOGGLE });
    await expect(toggle).not.toBeChecked();
    await expect(toggle).toBeDisabled();
  });

  test("o texto diz o que a analise faz e o que ela nao faz", async ({ page }) => {
    await installMediaMocks(page);
    await openEnabledSessions(page);

    /*
      Sem esta frase, ligar a camera viraria consentimento presumido para
      observacao corporal. Ela precisa dizer tres coisas: o que e medido, onde e
      processado, e que nao ha leitura de emocao.
    */
    const linha = page.getByText(
      "Mede movimento de cabeça, corpo e mãos no seu aparelho.",
      { exact: false },
    );
    await expect(linha).toBeVisible();
    await expect(linha).toContainText("Não identifica emoção");
    await expect(linha).toContainText("não envia imagem");
  });

  test("sem consentimento visual a sessao nao mostra estado de analise", async ({ page }) => {
    await installMediaMocks(page);
    await openEnabledSessions(page);

    await page.getByRole("switch", { name: "Usar câmera" }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
    await expect(page.getByTestId("capture-state-camera")).toHaveText("Captura ativa");

    // Camera ativa, analise visual nao autorizada: nenhum indicador de analise.
    await expect(page.getByTestId("visual-analysis-state")).toHaveCount(0);
  });

  test("keepRecording e screen desligados: zero asset e zero captura de tela", async ({
    page,
  }) => {
    /*
      A regressao que a validacao fisica #1 obrigou.

      A sessao fisica gravou camera, microfone **e tela** porque os tres toggles
      estavam ligados quando ela foi criada - o banco registrou fielmente o que
      o cliente mandou. Nao houve defeito de codigo, e e exatamente por isso que
      este teste existe: a configuracao pretendida do reteste precisa ser
      verificavel por maquina, e nao pela memoria de quem clicou.
    */
    await installMediaMocks(page);
    await openEnabledSessions(page);

    await page.getByRole("switch", { name: "Usar câmera" }).click();
    await page.getByRole("switch", { name: "Usar microfone" }).click();
    await page.getByRole("switch", { name: VISUAL_TOGGLE }).click();
    // IA ligada de proposito: sem ela nenhum sinal e derivado, e o teste nao
    // conseguiria provar que a medicao sobrevive a ausencia de midia.
    await page.getByRole("switch", { name: "Autorizar análise por IA" }).click();

    // O que precisa ficar **desligado**, verificado e nao suposto.
    await expect(
      page.getByRole("switch", { name: "Gravar/compartilhar tela" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("switch", { name: "Guardar gravação após análise" }),
    ).not.toBeChecked();

    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
    await expect(page.getByTestId("capture-state-camera")).toHaveText("Captura ativa");

    // Duas permissoes pedidas - camera e microfone. Nenhuma de tela.
    expect(
      await page.evaluate(
        () => (window as unknown as { __stage11MediaCalls: number }).__stage11MediaCalls,
      ),
    ).toBe(2);

    await page.getByRole("button", { name: "Finalizar sessão" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "Nenhuma mídia será enviada",
    );
    await page.getByRole("dialog").getByRole("button", { name: "Finalizar sessão" }).click();

    await expect(
      page.getByRole("heading", { name: "Análise da sessão", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Nenhum asset foi enviado ao Storage")).toBeVisible();

    /*
      Os recursos autorizados sao camera e microfone, e **so** eles: a tela nao
      aparece porque nunca foi consentida.
    */
    const autorizados = page.getByRole("heading", {
      name: "Recursos autorizados",
      level: 2,
    });
    await expect(autorizados).toBeVisible();
    const lista = page.getByRole("list").filter({ hasText: "Usar câmera" });
    await expect(lista).toContainText("Usar microfone");
    await expect(lista).not.toContainText("Gravar/compartilhar tela");

    /*
      E a medicao sobreviveu: sem nenhuma midia enviada, a sessao ainda produziu
      sinais. Midia e retencao; sinal e observacao, e uma nao depende da outra.
    */
    await expect(
      page.getByRole("heading", { name: "Sinais observáveis", level: 2 }),
    ).toBeVisible();
    await expect(
      page.getByText("A análise por IA não foi autorizada"),
    ).toHaveCount(0);
  });

  test("consentimento nao se herda: a proxima sessao nasce toda desligada", async ({
    page,
  }) => {
    /*
      O defeito de privacidade que a validacao fisica #1 expos, agora coberto.

      `sessionSetup` vive no provider e sobrevivia a navegacao dentro da SPA:
      criar uma sessao nao resetava nada, entao a seguinte nascia com camera,
      gravacao e tela ja marcadas. A pessoa autorizava uma vez e as sessoes
      seguintes herdavam - foi assim que a sessao fisica gravou tela e midia
      pretendendo nao gravar nada.
    */
    await installMediaMocks(page);
    await openEnabledSessions(page);

    // A. sessao 1 com permissoes sensiveis ligadas.
    await page.getByRole("switch", { name: "Usar câmera" }).click();
    await page.getByRole("switch", { name: "Gravar/compartilhar tela" }).click();
    await page.getByRole("switch", { name: "Guardar gravação após análise" }).click();
    await expect(
      page.getByRole("switch", { name: "Gravar/compartilhar tela" }),
    ).toBeChecked();

    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await expect(page).toHaveURL(/\/sessoes\/nova\?id=[0-9a-f-]+$/);

    /*
      A sessao criada mantem o que foi autorizado **para ela**: o reset e da
      preparacao da proxima, e nao do consentimento ja registrado. Com a tela
      consentida, a captura nao anuncia compartilhamento desativado.
    */
    await expect(
      page.getByText("Compartilhamento de tela desativado para esta sessão"),
    ).toHaveCount(0);

    /*
      B. Voltar pela navegacao do app, e **nao** por `page.goto`.

      O defeito so existe dentro de uma unica montagem da SPA: um recarregamento
      completo reinicializaria o estado React de graca e o teste passaria sem
      provar nada. A navegacao pelo drawer e o caminho real de quem usa.
    */
    const nav = await openNav(page);
    await nav.getByRole("link", { name: "Sessões", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Sessões multimodais", level: 2, exact: true }),
    ).toBeVisible();

    for (const nome of [
      "Gravar/compartilhar tela",
      "Usar câmera",
      "Usar microfone",
      "Gerar transcrição",
      VISUAL_TOGGLE,
      "Guardar gravação após análise",
      "Autorizar análise por IA",
    ]) {
      await expect(page.getByRole("switch", { name: nome }), nome).not.toBeChecked();
    }
  });

  test("ASR local: promessa sem prontidao bloqueia inicio; continuar sem exige decisao", async ({
    page,
  }) => {
    /*
      O ciclo de vida da UI do reconhecimento local, sem fingir voz humana.

      O que se prova aqui: o modelo **nao** baixa sozinho, a acao e explicita, e
      a sessao termina normalmente mesmo sem nunca preparar o ASR. O que **nao**
      se prova aqui e que o VAD aceita fala real - isso exige voz, e esta no
      roteiro fisico.
    */
    const externos: string[] = [];
    const HOSTS = [
      "huggingface.co",
      "hf.co",
      "cdn-lfs",
      "googleapis.com",
      "openai.com",
      "azure.com",
      "deepgram.com",
      "assemblyai.com",
    ];
    page.on("request", (request) => {
      const url = request.url();
      if (HOSTS.some((host) => url.includes(host))) externos.push(url);
    });

    /*
      A sonda de reconhecimento local e **controlada** aqui, e nao evitada.

      `SpeechRecognition.available()` existe neste Chromium e **derruba o
      processo de renderizacao** quando chamada em modo headless - reproduzido em
      isolamento. No Chrome real ela funciona: a validacao fisica #1 chamou esta
      mesma sonda e recebeu `unavailable`, com a tela mostrando a mensagem certa.
      E um risco do ambiente de teste, e nao do produto.

      Definir a resposta aqui exercita o caminho de verdade - sonda responde
      negativo, nativo e recusado, fallback local e oferecido - sem depender de
      uma API que mata a aba neste navegador.
    */
    await stubNativeAsrUnavailable(page);

    await installMediaMocks(page);
    await openEnabledSessions(page);

    await page.getByRole("switch", { name: "Usar microfone" }).click();
    await page.getByRole("switch", { name: "Gerar transcrição" }).click();
    // Regressao exata: antes da correcao este botao estava habilitado.
    await expect(page.getByRole("button", { name: "Iniciar sessão" })).toBeDisabled();
    await expect(page.getByTestId("transcription-preflight")).toHaveAttribute("data-state", "LOCAL_PREPARATION_REQUIRED");
    await expect(page.getByRole("button", { name: /^Preparar transcrição local/ })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __stage11MediaCalls: number }).__stage11MediaCalls)).toBe(0);
    const created = page.waitForRequest((request) => request.url().endsWith("/api/multimodal/sessions") && request.method() === "POST");
    await page.getByRole("button", { name: "Continuar sem transcrição" }).click();
    expect((await created).postDataJSON()).toMatchObject({ transcribe: false, shareTranscript: false, keepRecording: false });
    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
    await expect(page.getByTestId("capture-state-microphone")).toHaveText("Captura ativa");
    await expect(page.getByTestId("local-asr-state")).toHaveCount(0);

    // A sessao termina normalmente mesmo sem ASR: ASR_FAILURE != SESSION_FAILURE.
    await page.getByRole("button", { name: "Finalizar sessão" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Finalizar sessão" }).click();
    await expect(
      page.getByRole("heading", { name: "Análise da sessão", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("Nenhum asset foi enviado ao Storage")).toBeVisible();

    // Nenhum host externo de ASR foi tocado em nenhum momento.
    expect(externos).toEqual([]);
  });

  for (const native of ["unavailable", "downloadable"] as const) {
    test(`ASR ${native}: os botoes do preparo cabem no cartao de 320 px ao desktop`, async ({ page }) => {

      // em português" vazavam do cartão no celular (Button padrão é
      // whitespace-nowrap + altura fixa). Só layout; o fluxo não muda.
      await stubNativeAsrUnavailable(page, native);
      await installMediaMocks(page);
      await openEnabledSessions(page);
      await page.getByRole("switch", { name: "Usar microfone" }).click();
      await page.getByRole("switch", { name: "Gerar transcrição" }).click();
      const card = page.getByTestId("local-speech-preflight");
      const cta = native === "unavailable"
        ? page.getByRole("button", { name: /^Preparar transcrição local \(~\d+ MB\)$/ })
        : page.getByRole("button", { name: "Baixar reconhecimento em português" });
      await expect(cta).toBeVisible();

      for (const width of [320, 360, 390, 834, 1280]) {
        await page.setViewportSize({ width, height: 800 });
        await expect(cta).toBeVisible();
        const [cardBox, buttonBox] = await Promise.all([card.boundingBox(), cta.boundingBox()]);
        expect(cardBox && buttonBox, `caixas em ${width}px`).toBeTruthy();
        expect(buttonBox!.x, `esquerda em ${width}px`).toBeGreaterThanOrEqual(cardBox!.x - 0.5);
        expect(buttonBox!.x + buttonBox!.width, `direita em ${width}px`).toBeLessThanOrEqual(cardBox!.x + cardBox!.width + 0.5);
        expect(buttonBox!.height, `alvo de toque em ${width}px`).toBeGreaterThanOrEqual(width < 1024 ? 44 : 36);
        const clipped = await cta.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(clipped, `texto cortado em ${width}px`).toBeLessThanOrEqual(0);
        // Nenhum botão do cartão passa da borda da tela.
        const outside = await card.evaluate((el) => [...el.querySelectorAll("button")]
          .filter((b) => b.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
          .map((b) => b.textContent));
        expect(outside, `botões fora da tela em ${width}px`).toEqual([]);
      }
      // Comportamento intacto: nada baixa sozinho e "continuar sem" existe.
      await expect(cta).toBeEnabled();
      await expect(page.getByRole("button", { name: "Continuar sem transcrição" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Iniciar sessão" })).toBeDisabled();
    });
  }

  test("ASR nativo pronto nao prepara modelos locais", async ({ page }) => {
    await page.addInitScript(() => {
      class NativeStub { static available = async () => "available"; }
      Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: NativeStub });
      Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: NativeStub });
    });
    const assets: string[] = [];
    page.on("request", (r) => { if (new URL(r.url()).pathname.startsWith("/asr/")) assets.push(r.url()); });
    await installMediaMocks(page);
    await openEnabledSessions(page);
    await page.getByRole("switch", { name: "Usar microfone" }).click();
    await page.getByRole("switch", { name: "Gerar transcrição" }).click();
    await expect(page.getByTestId("transcription-preflight")).toHaveAttribute("data-state", "READY_NATIVE");
    await expect(page.getByRole("button", { name: /^Preparar transcrição local/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await expect(page).toHaveURL(/\/sessoes\/nova\?id=/);
    expect(assets).toEqual([]);
  });

  test("preparo explicito com VAD ausente preserva causa e bloqueia inicio", async ({ page }) => {
    await page.addInitScript(() => {
      class NativeStub { static available = async () => "unavailable"; }
      Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: NativeStub });
      Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: NativeStub });
    });
    let vadRequests = 0;
    await page.route("**/asr/vad/silero_vad.onnx", (route) => {
      vadRequests += 1;
      return route.fulfill({ status: 404, body: "" });
    });
    await installMediaMocks(page);
    await openEnabledSessions(page);
    await page.getByRole("switch", { name: "Usar microfone" }).click();
    await page.getByRole("switch", { name: "Gerar transcrição" }).click();
    const prepare = page.getByRole("button", { name: /^Preparar transcrição local/ });
    await expect(prepare).toBeVisible();
    expect(vadRequests).toBe(0);
    await prepare.click();
    await expect(page.getByTestId("transcription-preflight")).toHaveAttribute("data-failure", "local_asr_assets_missing");
    await expect(page.getByRole("button", { name: "Iniciar sessão" })).toBeDisabled();
    expect(vadRequests).toBe(1);
  });

  test("com consentimento a sessao mostra estado discreto, e nao painel de metricas", async ({
    page,
  }) => {
    await installMediaMocks(page);
    await openEnabledSessions(page);

    await page.getByRole("switch", { name: "Usar câmera" }).click();
    await page.getByRole("switch", { name: VISUAL_TOGGLE }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();

    const estado = page.getByTestId("visual-analysis-state");
    await expect(estado).toBeVisible();

    /*
      Estado discreto, e nao metrica ao vivo. Mostrar frequencia de movimento
      subindo e descendo durante a sessao convidaria a pessoa a se observar
      sendo medida, e a mudar justamente o comportamento que a medida descreve.
    */
    await expect(estado).not.toContainText(/\d/);

    // Falha do motor nao derruba a captura: a camera segue ativa em qualquer
    // um dos estados possiveis.
    await expect(page.getByTestId("capture-state-camera")).toHaveText("Captura ativa");
    // L-396: o estado e ao vivo; "preparando" e honesto enquanto o motor carrega
    // e precisa sair dele. Com os ativos presentes, o stream falso deste mock nunca
    // entrega quadro: "aguardando a imagem" e o estado correto (sem inferencia).
    await expect(estado).not.toHaveText(/preparando/, { timeout: 30_000 });
    const rotulo = (await estado.textContent()) ?? "";
    expect([
      "Análise visual ativa",
      "Análise visual: aguardando a imagem da câmera",
      "Análise visual reduzida para manter a sessão leve",
      "Análise visual pausada para manter a sessão responsiva",
      "Análise visual indisponível neste navegador",
      "Análise visual não pôde iniciar",
      "Análise visual não ativada",
      "Análise visual interrompida",
    ]).toContain(rotulo.trim());
  });
});
