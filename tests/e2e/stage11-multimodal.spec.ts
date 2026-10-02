import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";

import { DEFAULT_SESSION_SETUP } from "@/lib/contracts/session";

import {
  cleanupSessions,
  installMediaMocks,
  openEnabledSessions,
  setSessionsEnabled,
} from "./multimodal-mocks";

/**
 * L-268: estados negativos mostram a frase de capacidade (`captureCapability`,
 * commit 9eea00a) e `ended`/`error` compartilham o texto. O estado bruto fica em
 * `data-state`, para o teste distinguir `ended` de `error` como antes.
 */
const CAPTURE_TEXT = {
  granted: /^Captura ativa$/,
  cancelled: /não foi confirmado\. Você pode solicitar novamente/,
  denied: /^O navegador não possui acesso a .+ Revise as permissões do site/,
  ended: /não está disponível agora\. Tente novamente/,
} as const;

async function expectCaptureState(page: Page, resource: string, state: keyof typeof CAPTURE_TEXT) {
  const badge = page.getByTestId(`capture-state-${resource}`);
  await expect(badge).toHaveAttribute("data-state", state);
  await expect(badge).toHaveText(CAPTURE_TEXT[state]);
}

test.describe("Stage 11A - captura e midia", () => {
  test.beforeEach(async ({ page }) => {
    await cleanupSessions(page);
    await setSessionsEnabled(page, false);
  });

  test.afterEach(async ({ page }) => {
    await cleanupSessions(page);
    await setSessionsEnabled(page, false);
  });

  test("feature detection desabilita suporte ausente sem consultar user agent", async ({ page }) => {
    await installMediaMocks(page, { screenSupported: false });
    await openEnabledSessions(page);

    await expect(page.getByTestId("capability-screen")).toContainText(
      "Não suportado neste navegador",
    );
    await expect(
      page.getByRole("switch", { name: "Gravar/compartilhar tela" }),
    ).toBeDisabled();
    await expect(page.getByTestId("capability-camera")).toContainText("Suportado");
    await expect(page.getByTestId("capability-microphone")).toContainText("Suportado");
  });

  test("as sete combinacoes de captura permanecem independentes", async ({ page }) => {
    await installMediaMocks(page);
    await setSessionsEnabled(page, true);
    const combinations = [
      { screen: true, camera: false, microphone: false },
      { screen: false, camera: true, microphone: false },
      { screen: false, camera: false, microphone: true },
      { screen: false, camera: true, microphone: true },
      { screen: true, camera: false, microphone: true },
      { screen: true, camera: true, microphone: false },
      { screen: true, camera: true, microphone: true },
    ] as const;

    for (const capture of combinations) {
      const created = await page.request.post("/api/multimodal/sessions", {
        data: { ...DEFAULT_SESSION_SETUP, ...capture },
      });
      expect(created.ok()).toBe(true);
      const payload = (await created.json()) as { data: { id: string } };
      await gotoHydrated(page, `/sessoes/nova?id=${payload.data.id}`);
      await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();

      for (const resource of ["screen", "camera", "microphone"] as const) {
        if (capture[resource]) {
          await expect(page.getByTestId(`capture-state-${resource}`)).toHaveText("Captura ativa");
        } else {
          await expect(page.getByTestId(`capture-state-${resource}`)).toHaveCount(0);
        }
      }

      await gotoHydrated(page, "/sessoes");
      expect((await page.request.delete(`/api/multimodal/sessions/${payload.data.id}`)).ok()).toBe(true);
    }
  });

  for (const scenario of [
    {
      name: "screen cancelada nao impede camera autorizada",
      options: { cancelScreen: true },
      selected: ["screen", "camera"] as const,
      expected: { screen: "cancelled", camera: "granted" },
    },
    {
      name: "camera negada nao impede microfone autorizado",
      options: { denyCamera: true },
      selected: ["camera", "microphone"] as const,
      expected: { camera: "denied", microphone: "granted" },
    },
    {
      name: "microfone negado nao impede tela autorizada",
      options: { denyMicrophone: true },
      selected: ["microphone", "screen"] as const,
      expected: { microphone: "denied", screen: "granted" },
    },
  ]) {
    test(scenario.name, async ({ page }) => {
      await installMediaMocks(page, scenario.options);
      await openEnabledSessions(page);
      const labels = {
        screen: "Gravar/compartilhar tela",
        camera: "Usar câmera",
        microphone: "Usar microfone",
      } as const;
      for (const resource of scenario.selected) {
        await page.getByRole("switch", { name: labels[resource] }).click();
      }
      await page.getByRole("button", { name: "Iniciar sessão" }).click();
      await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
      for (const [resource, state] of Object.entries(scenario.expected)) {
        await expectCaptureState(page, resource, state);
      }
    });
  }

  test("encerramento da track vira estado explicito ended", async ({ page }) => {
    await installMediaMocks(page);
    await openEnabledSessions(page);
    await page.getByRole("switch", { name: "Usar microfone" }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
    await expect(page.getByTestId("capture-state-microphone")).toHaveText("Captura ativa");
    await page.evaluate(() => {
      (window as unknown as { __stage11EndTracks: () => void }).__stage11EndTracks();
    });
    await expectCaptureState(page, "microphone", "ended");
  });

  test("sem consentimento de Storage captura fica em memoria e zero asset e enviado", async ({ page }) => {
    await installMediaMocks(page);
    await openEnabledSessions(page);
    await page.getByRole("switch", { name: "Usar microfone" }).click();
    expect(await page.evaluate(() => (window as unknown as { __stage11MediaCalls: number }).__stage11MediaCalls)).toBe(0);

    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await expect(page).toHaveURL(/\/sessoes\/nova\?id=[0-9a-f-]+$/);
    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
    await expect(page.getByTestId("capture-state-microphone")).toHaveText("Captura ativa");
    expect(await page.evaluate(() => (window as unknown as { __stage11MediaCalls: number }).__stage11MediaCalls)).toBe(1);

    await page.getByRole("button", { name: "Finalizar sessão" }).click();
    await expect(page.getByRole("dialog")).toContainText("Nenhuma mídia será enviada");
    await page.getByRole("dialog").getByRole("button", { name: "Finalizar sessão" }).click();
    await expect(page.getByRole("heading", { name: "Análise da sessão", level: 1 })).toBeVisible();
    await expect(page.getByText("Nenhum asset foi enviado ao Storage")).toBeVisible();
    expect(await page.evaluate(
      () => (window as unknown as { __stage11StoppedTracks: number }).__stage11StoppedTracks,
    )).toBe(1);
  });

  test("asset valido usa Storage privado, URL assinada curta e cleanup idempotente", async ({ page }) => {
    await installMediaMocks(page);
    await openEnabledSessions(page);
    await page.getByRole("switch", { name: "Usar microfone" }).click();
    await page.getByRole("switch", { name: "Guardar gravação após análise" }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
    await expect(page.getByTestId("capture-state-microphone")).toHaveText("Captura ativa");
    await page.getByRole("button", { name: "Finalizar sessão" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Finalizar sessão" }).click();
    await expect(page.getByRole("heading", { name: "Análise da sessão", level: 1 })).toBeVisible();

    const id = page.url().split("/").at(-1) ?? "";
    const sessionResponse = await page.request.get(`/api/multimodal/sessions/${id}`);
    expect(sessionResponse.ok()).toBe(true);
    const sessionPayload = (await sessionResponse.json()) as {
      data: { assets: Array<{ id: string; status: string }> };
    };
    expect(sessionPayload.data.assets).toHaveLength(1);
    expect(sessionPayload.data.assets[0]?.status).toBe("stored");
    const signed = await page.request.post(
      `/api/multimodal/assets/${sessionPayload.data.assets[0]?.id}/signed-url`,
    );
    expect(signed.ok()).toBe(true);
    const signedPayload = (await signed.json()) as {
      data: { url: string; expiresIn: number };
    };
    expect(signedPayload.data.expiresIn).toBe(60);
    expect(signedPayload.data.url).toContain("token=");

    const firstCleanup = await page.request.delete(`/api/multimodal/sessions/${id}`);
    const secondCleanup = await page.request.delete(`/api/multimodal/sessions/${id}`);
    expect(firstCleanup.ok()).toBe(true);
    expect(secondCleanup.ok()).toBe(true);
    expect((await page.request.get(`/api/multimodal/sessions/${id}`)).status()).toBe(404);
  });

  test("cancelar seletor de tela e estado explicito nao derrubam a aplicacao", async ({ page }) => {
    await installMediaMocks(page, { cancelScreen: true });
    await openEnabledSessions(page);
    await page.getByRole("switch", { name: "Gravar/compartilhar tela" }).click();
    await page.getByRole("button", { name: "Iniciar sessão" }).click();
    await page.getByRole("button", { name: "Solicitar permissões e iniciar" }).click();
    await expectCaptureState(page, "screen", "cancelled");
    await expect(page.getByRole("heading", { name: "Nova sessão multimodal", level: 1 })).toBeVisible();
    await expect(page.getByText("Operação multimodal indisponível.")).toHaveCount(0);
  });

  test("MIME, assinatura e tamanho invalidos falham fechado sem metadata", async ({ page }) => {
    await installMediaMocks(page);
    await setSessionsEnabled(page, true);
    const created = await page.request.post("/api/multimodal/sessions", {
      data: {
        ...DEFAULT_SESSION_SETUP,
        microphone: true,
        keepRecording: true,
      },
    });
    expect(created.ok()).toBe(true);
    const createdPayload = (await created.json()) as { data: { id: string } };
    const id = createdPayload.data.id;
    expect((await page.request.patch(`/api/multimodal/sessions/${id}`, { data: { status: "capturing" } })).ok()).toBe(true);

    const invalid = await page.request.post("/api/multimodal/assets", {
      multipart: {
        sessionId: id,
        mediaKind: "microphone",
        durationMs: "1000",
        file: {
          name: "synthetic.webm",
          mimeType: "audio/webm",
          buffer: Buffer.from("not-a-media-container"),
        },
      },
    });
    expect(invalid.status()).toBe(415);
    const oversized = await page.request.post("/api/multimodal/assets", {
      multipart: {
        sessionId: id,
        mediaKind: "microphone",
        durationMs: "1000",
        file: {
          name: "oversized.webm",
          mimeType: "audio/webm",
          buffer: Buffer.alloc(32 * 1024 * 1024 + 1, 0x1a),
        },
      },
    });
    expect(oversized.status()).toBe(415);
    const detail = await page.request.get(`/api/multimodal/sessions/${id}`);
    const detailPayload = (await detail.json()) as { data: { assets: unknown[] } };
    expect(detailPayload.data.assets).toEqual([]);
  });
});
