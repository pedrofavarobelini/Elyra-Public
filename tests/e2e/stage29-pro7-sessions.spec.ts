import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { measureDeadSpace } from "./dead-space";
import { gotoHydrated } from "./hydrated";
import {
  cleanupAccounts,
  createPersonalAccount,
  createProfessionalAccount,
  qaAdmin,
  signIn,
  type Admin,
  type QaAccount,
} from "./professional-fixtures";



const TZ = "America/Sao_Paulo";

/*
  PRO-Q: com o LiveKit local no ar a sala entra DE FATO na chamada. Mesmo
  dispositivo falso e permissoes do spec PRO-7R, para que ligar o microfone da
  chamada funcione como num aparelho real (o produto nunca liga sozinho).
*/
test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  },
});
const TOKEN_SHAPE = /[A-Za-z0-9_-]{43}/;

async function contextFor(browser: Browser, baseURL: string, account: QaAccount) {
  const context = await browser.newContext({
    timezoneId: TZ,
    locale: "pt-BR",
    storageState: { cookies: [], origins: [] },
    permissions: ["camera", "microphone"],
  });
  const page = await context.newPage();
  await signIn(page, baseURL, account);
  return { context, page };
}

async function scene(admin: Admin, project: string, created: string[], startsInMinutes = 5) {
  const pro = await createProfessionalAccount(admin, project, "Helena Sessao");
  const person = await createPersonalAccount(admin, project, "Marina Sessao");
  created.push(pro.userId, person.userId);
  const { data: connection, error } = await admin
    .from("professional_connections")
    .insert({
      client_user_id: person.userId,
      professional_user_id: pro.userId,
      invited_by_user_id: person.userId,
      status: "active",
      accepted_at: new Date(Date.now() - 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  const starts = new Date(Date.now() + startsInMinutes * 60_000);
  starts.setSeconds(0, 0);
  const { data: appointment, error: apptError } = await admin
    .from("appointments")
    .insert({
      connection_id: connection.id,
      client_user_id: person.userId,
      professional_user_id: pro.userId,
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 50 * 60_000).toISOString(),
      timezone: TZ,
      modality: "online",
      status: "confirmed",
      requested_by: person.userId,
      idempotency_key: crypto.randomUUID(),
      confirmed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (apptError) throw apptError;
  const { data: session } = await admin
    .from("professional_sessions")
    .select("id")
    .eq("appointment_id", appointment.id)
    .single();
  return { pro, person, connectionId: connection.id, appointmentId: appointment.id, sessionId: session!.id };
}

function watchForTokens(page: Page, leaks: string[]) {
  page.on("request", (request) => {
    if (TOKEN_SHAPE.test(request.url()) && request.url().includes("professional-sessions")) leaks.push(request.url());
    const body = request.postData() ?? "";
    if (/token/i.test(body)) leaks.push(`body:${request.url()}`);
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/api/professional-sessions")) return;
    const text = await response.text().catch(() => "");
    // PRO-7R: `/media` entrega, por desenho, o token CURTO do provider de midia
    // (JWT) e a chave E2EE ao participante autorizado - provado em

    // proibida em TODA resposta, inclusive ali.
    const pattern = response.url().endsWith("/media") ? /p_token|digest/ : /"token"|p_token/;
    if (pattern.test(text)) leaks.push(`response:${response.url()}`);
  });
}

async function cleanup(admin: Admin, created: string[]) {
  await admin.from("multimodal_sessions").delete().in("user_id", created);
  await admin.from("appointments").delete().in("client_user_id", created);
  await cleanupAccounts(admin, created);
}

test.describe("Stage 29 / PRO-7 - sala da sessao", () => {
  test("entrar, permissoes, transcricao so com consentimento, encerrar, reentrada recusada", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.setTimeout(240_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const { pro, person, sessionId, connectionId } = await scene(admin, testInfo.project.name, created);
      const stranger = await createPersonalAccount(admin, testInfo.project.name, "Outra Sessao");
      created.push(stranger.userId);
      const leaks: string[] = [];

      // 1. Pessoa: da Agenda para a sala; tudo desligado; entrar so registra presenca.
      const personSide = await contextFor(browser, baseURL, person);
      watchForTokens(personSide.page, leaks);
      await gotoHydrated(personSide.page, "/agenda");
      await personSide.page.getByTestId("agenda-mine").getByRole("link", { name: "Abrir sessão" }).click();
      await expect(personSide.page).toHaveURL(new RegExp(`/agenda/sessao/${sessionId}$`));
      await expect(personSide.page.getByRole("heading", { level: 1, name: "Sessão com Helena Sessao" })).toBeVisible();
      const consents = personSide.page.getByTestId("session-consents");
      await expect(consents.locator("[data-state='on']")).toHaveCount(0);
      await personSide.page.getByRole("button", { name: "Entrar na sessão" }).click();
      await expect(personSide.page.getByRole("status").filter({ hasText: "Você entrou na sessão." })).toBeVisible();
      await expect(personSide.page.getByText("Em andamento")).toBeVisible();
      await expect(consents.locator("[data-state='on']")).toHaveCount(0);

      // Permissoes por dialogo, uma a uma, com dependencia.
      await personSide.page.getByRole("button", { name: "Alterar permissões" }).click();
      const dialog = personSide.page.getByRole("dialog", { name: "Permissões desta sessão" });
      await expect(dialog.getByRole("switch", { name: "Transcrição", exact: true })).toBeDisabled();
      await dialog.getByRole("switch", { name: "Microfone", exact: true }).click();
      await expect(dialog.getByRole("switch", { name: "Microfone", exact: true })).toHaveAttribute("data-state", "checked");
      await dialog.getByRole("switch", { name: "Transcrição", exact: true }).click();
      await expect(dialog.getByRole("switch", { name: "Transcrição", exact: true })).toHaveAttribute("data-state", "checked");
      await dialog.getByRole("button", { name: "Concluir" }).click();
      await expect(consents.locator("[data-consent='allow_professional_transcript_access']")).toHaveAttribute("data-state", "off");

      // 2. Profissional: lista, sala, sem transcricao liberada.
      const proSide = await contextFor(browser, baseURL, pro);
      watchForTokens(proSide.page, leaks);
      await gotoHydrated(proSide.page, "/pro/sessoes");
      await proSide.page.getByRole("link", { name: "Abrir sessão" }).first().click();
      await expect(proSide.page).toHaveURL(new RegExp(`/pro/sessoes/${sessionId}$`));
      await expect(proSide.page.getByTestId("session-transcript")).toContainText("A pessoa não liberou a leitura da transcrição");
      await expect(proSide.page.getByRole("button", { name: "Alterar permissões" })).toHaveCount(0);
      const denied = await proSide.page.request.get(`/api/professional-sessions/${sessionId}/transcript`);
      expect(denied.status()).toBe(403);
      await proSide.page.getByRole("button", { name: "Entrar na sessão" }).click();
      await expect(proSide.page.getByRole("status").filter({ hasText: "Você entrou na sessão." })).toBeVisible();

      // Captura ligada + transcricao sintetica (o ASR real e do aparelho: QA fisico).
      const { data: capture, error: captureError } = await admin
        .from("multimodal_sessions")
        .insert({
          user_id: person.userId,
          kind: "free",
          microphone_consent: true,
          transcription_consent: true,
          professional_session_id: sessionId,
        })
        .select("id")
        .single();
      expect(captureError).toBeNull();
      await admin.from("session_transcripts").insert({
        session_id: capture!.id,
        user_id: person.userId,
        status: "available",
        content: "Texto sintetico da sessao de QA.",
        word_count: 6,
        voiced_duration_ms: 4000,
      });

      // 3. Pessoa libera a leitura; profissional le; a leitura entra na trilha do titular.
      await personSide.page.getByRole("button", { name: "Alterar permissões" }).click();
      await dialog.getByRole("switch", { name: "Profissional lê a transcrição" }).click();
      await expect(dialog.getByRole("switch", { name: "Profissional lê a transcrição" })).toHaveAttribute("data-state", "checked");
      await dialog.getByRole("button", { name: "Concluir" }).click();
      await gotoHydrated(proSide.page, `/pro/sessoes/${sessionId}`);
      await proSide.page.getByRole("button", { name: "Ler transcrição" }).click();
      await expect(proSide.page.getByTestId("transcript-text")).toHaveText("Texto sintetico da sessao de QA.");
      const { count: trail } = await admin
        .from("professional_access_log")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", person.userId)
        .eq("scope", "multimodal_transcript");
      expect(trail).toBe(1);

      // Revogar vale na proxima leitura.
      await personSide.page.getByRole("button", { name: "Alterar permissões" }).click();
      await dialog.getByRole("switch", { name: "Profissional lê a transcrição" }).click();
      await expect(dialog.getByRole("switch", { name: "Profissional lê a transcrição" })).toHaveAttribute("data-state", "unchecked");
      await dialog.getByRole("button", { name: "Concluir" }).click();
      expect((await proSide.page.request.get(`/api/professional-sessions/${sessionId}/transcript`)).status()).toBe(403);

      // 4. IDOR, anonimo, cache.
      const strangerSide = await contextFor(browser, baseURL, stranger);
      expect((await strangerSide.page.goto(`${baseURL}/agenda/sessao/${sessionId}`))?.status()).toBe(404);
      expect((await strangerSide.page.request.get(`/api/professional-sessions/${sessionId}`)).status()).toBe(404);
      expect(
        (await strangerSide.page.request.patch(`/api/professional-sessions/${sessionId}`, { data: { action: "enter" } })).status(),
      ).toBe(404);
      expect(
        (await strangerSide.page.request.put(`/api/professional-sessions/${sessionId}/consents`, {
          data: { consent: "allow_professional_transcript_access", value: true },
        })).status(),
      ).toBe(404);
      await strangerSide.context.close();
      const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      expect((await anon.request.get(`${baseURL}/api/professional-sessions/${sessionId}`)).status()).toBe(401);
      await anon.close();
      const detail = await personSide.page.request.get(`/api/professional-sessions/${sessionId}`);
      expect(detail.headers()["cache-control"]).toContain("no-store");
      expect(await detail.text()).not.toMatch(/token|digest/i);
      // O profissional nao muda consentimento da pessoa.
      expect(
        (await proSide.page.request.put(`/api/professional-sessions/${sessionId}/consents`, {
          data: { consent: "allow_audio", value: true },
        })).status(),
      ).toBe(404);

      // 5. Profissional encerra; reentrada recusada para os dois.
      await proSide.page.getByRole("button", { name: "Encerrar sessão" }).click();
      await proSide.page.getByRole("dialog", { name: "Encerrar sessão" }).getByRole("button", { name: "Encerrar sessão" }).click();
      await expect(proSide.page.getByRole("status").filter({ hasText: "Sessão encerrada." })).toBeVisible();
      await gotoHydrated(personSide.page, `/agenda/sessao/${sessionId}`);
      await expect(personSide.page.getByTestId("session-closed-note")).toContainText("Sessão concluída");
      await expect(personSide.page.getByRole("button", { name: /Entrar/ })).toHaveCount(0);
      const reentry = await personSide.page.request.patch(`/api/professional-sessions/${sessionId}`, { data: { action: "enter" } });
      expect(reentry.status()).toBe(409);

      // Trilha sem conteudo, com os eventos pedidos.
      const { data: events } = await admin.from("professional_session_events").select("event,detail").eq("session_id", sessionId);
      const names = new Set((events ?? []).map((item) => item.event));
      for (const expected of [
        "SESSION_ENTERED",
        "SESSION_STARTED",
        "SESSION_COMPLETED",
        "CONSENT_CHANGED",
        "PROFESSIONAL_VIEWED_SESSION_SUMMARY",
        "PROFESSIONAL_VIEWED_TRANSCRIPT",
      ]) {
        expect(names.has(expected), expected).toBe(true);
      }
      expect(JSON.stringify(events)).not.toContain("sintetico");
      expect(leaks, leaks.join("\n")).toEqual([]);
      expect(connectionId).toBeTruthy();

      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await cleanup(admin, created);
    }
  });

  test("Registrar usa a captura multimodal existente, ligada e limitada pelas permissoes", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.skip(testInfo.project.name !== "desktop", "fluxo de integracao: um projeto basta");
    test.setTimeout(180_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const { person, sessionId } = await scene(admin, testInfo.project.name, created);
      await admin.from("user_preferences").update({ sessions_enabled: true }).eq("user_id", person.userId);
      const personSide = await contextFor(browser, baseURL, person);
      await gotoHydrated(personSide.page, `/agenda/sessao/${sessionId}`);
      await expect(personSide.page.getByTestId("session-capture")).toContainText("dentro da sessão em andamento");
      await personSide.page.getByRole("button", { name: "Entrar na sessão" }).click();
      await expect(personSide.page.getByTestId("session-capture")).toContainText("Microfone e câmera estão desligados");

      // Sem allow_audio, o banco recusa mesmo uma chamada direta a API.
      const forged = await personSide.page.request.post("/api/multimodal/sessions", {
        data: {
          kind: "free", screen: false, camera: false, microphone: true, transcribe: false, visualAnalysis: false,
          keepRecording: false, aiAnalysis: false, shareResult: false, shareTranscript: false, shareRecording: false,
          trainingEligible: false, professionalSessionId: sessionId,
        },
      });
      expect(forged.ok()).toBe(false);

      await personSide.page.getByRole("button", { name: "Alterar permissões" }).click();
      const dialog = personSide.page.getByRole("dialog", { name: "Permissões desta sessão" });
      await dialog.getByRole("switch", { name: "Microfone", exact: true }).click();
      await expect(dialog.getByRole("switch", { name: "Microfone", exact: true })).toHaveAttribute("data-state", "checked");
      await dialog.getByRole("button", { name: "Concluir" }).click();
      /*
        PRO-Q: com o LiveKit local no ar a pessoa entra DE FATO na chamada, e a
        captura usa a trilha local da chamada (PRO-7R R4). A chamada entrou com
        o microfone desligado (nao havia permissao de audio) e o produto nao o
        liga sozinho: a pessoa liga por gesto. Sem LiveKit, nao ha chamada e
        esse passo nao existe. O teste cobre os dois caminhos.
      */
      const callMic = personSide.page.getByTestId("toggle-mic");
      const inCall = await callMic.waitFor({ state: "visible", timeout: 15_000 }).then(() => true, () => false);
      if (inCall && (await callMic.getAttribute("aria-pressed")) !== "true") {
        await callMic.click();
        await expect(callMic).toHaveAttribute("aria-pressed", "true");
      }
      await personSide.page.getByRole("button", { name: "Registrar agora" }).click();
      const capture = personSide.page.getByRole("dialog", { name: "Registrar nesta sessão" });
      await expect(capture.getByRole("switch", { name: "Câmera" })).toBeDisabled();
      await capture.getByRole("button", { name: "Começar registro" }).click();
      if (inCall) {
        // Em chamada: captura EMBUTIDA na sala, usando a trilha local (PRO-7R R4).
        await expect(personSide.page.getByTestId("embedded-capture")).toBeVisible();
      } else {
        // Sem chamada: a captura multimodal existente em pagina propria.
        await expect(personSide.page).toHaveURL(/\/sessoes\/nova\?id=/);
      }
      await expect
        .poll(async () => (await admin.from("multimodal_sessions").select("id").eq("user_id", person.userId)).data?.length ?? 0)
        .toBe(1);
      const { data: rows } = await admin
        .from("multimodal_sessions")
        .select("microphone_consent,camera_consent,screen_consent,transcription_consent,professional_session_id")
        .eq("user_id", person.userId);
      expect(rows).toEqual([
        {
          microphone_consent: true,
          camera_consent: false,
          screen_consent: false,
          transcription_consent: false,
          professional_session_id: sessionId,
        },
      ]);
      await personSide.context.close();
    } finally {
      await cleanup(admin, created);
    }
  });

  test("janela fechada: sem entrada, estado honesto", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.skip(testInfo.project.name !== "desktop", "estado: um projeto basta");
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const { person, sessionId } = await scene(admin, testInfo.project.name, created, 180);
      const personSide = await contextFor(browser, baseURL, person);
      await gotoHydrated(personSide.page, `/agenda/sessao/${sessionId}`);
      await expect(personSide.page.getByText("Agendada", { exact: true })).toBeVisible();
      await expect(personSide.page.getByTestId("session-closed-note")).toContainText("Ainda não é hora de entrar");
      await expect(personSide.page.getByRole("button", { name: /Entrar/ })).toHaveCount(0);
      const early = await personSide.page.request.patch(`/api/professional-sessions/${sessionId}`, { data: { action: "enter" } });
      expect(early.status()).toBe(409);
      await personSide.context.close();
    } finally {
      await cleanup(admin, created);
    }
  });

  test("axe, responsivo e evidencia visual das salas e da lista", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.setTimeout(240_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const { pro, person, sessionId } = await scene(admin, testInfo.project.name, created);
      const proSide = await contextFor(browser, baseURL, pro);
      const personSide = await contextFor(browser, baseURL, person);
      const shots = process.env.ELYRA_PRO7_SHOTS ?? testInfo.outputPath("pro7-visual");
      const widths: Record<string, number[]> = { desktop: [1440, 1920], tablet: [834], mobile: [360, 393, 412] };
      for (const [side, path] of [
        [personSide.page, `/agenda/sessao/${sessionId}`],
        [proSide.page, `/pro/sessoes/${sessionId}`],
        [proSide.page, "/pro/sessoes"],
      ] as Array<[Page, string]>) {
        for (const width of widths[testInfo.project.name] ?? [1440]) {
          await side.setViewportSize({ width, height: 900 });
          for (const scheme of ["light", "dark"] as const) {
            await side.emulateMedia({ colorScheme: scheme });
            await gotoHydrated(side, path);
            await expect(side.getByRole("heading", { level: 1 })).toHaveCount(1);
            const metrics = await measureDeadSpace(side);
            expect(metrics.horizontalOverflow, `${path} ${width}`).toBeLessThanOrEqual(0);
            await side.screenshot({
              path: `${shots}/${path.includes(sessionId) ? `${path.split("/")[1]}-sala` : "pro-lista"}-${width}-${scheme}.png`,
              fullPage: true,
            });
          }
          const results = await new AxeBuilder({ page: side }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
          expect(serious, `${path} ${width}: ${serious.map((item) => item.id).join(",")}`).toEqual([]);
        }
      }
      // Dialogo de permissoes: foco preso no dialogo e axe limpo.
      await personSide.page.setViewportSize({ width: 1440, height: 900 });
      await gotoHydrated(personSide.page, `/agenda/sessao/${sessionId}`);
      await personSide.page.getByRole("button", { name: "Alterar permissões" }).click();
      const dialog = personSide.page.getByRole("dialog", { name: "Permissões desta sessão" });
      await expect(dialog).toBeVisible();
      const dialogAxe = await new AxeBuilder({ page: personSide.page }).include("[role='dialog']").analyze();
      expect(dialogAxe.violations.filter((item) => item.impact === "serious" || item.impact === "critical")).toEqual([]);
      await personSide.page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await cleanup(admin, created);
    }
  });
});
