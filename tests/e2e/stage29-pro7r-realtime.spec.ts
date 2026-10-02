import { execFileSync } from "node:child_process";

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
const LIVEKIT_HTTP = "http://127.0.0.1:7880";

test.use({
  launchOptions: {
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
  },
  permissions: ["camera", "microphone"],
});

async function livekitUp() {
  try {
    return (await fetch(`${LIVEKIT_HTTP}/`)).ok;
  } catch {
    return false;
  }
}

function realtime(command: "start" | "stop") {
  execFileSync(process.execPath, ["scripts/realtime.mjs", command], { stdio: "pipe", env: process.env, timeout: 90_000 });
}

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

async function scene(admin: Admin, project: string, created: string[]) {
  const pro = await createProfessionalAccount(admin, project, "Helena Chamada");
  const person = await createPersonalAccount(admin, project, "Marina Chamada");
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
  const starts = new Date(Date.now() + 5 * 60_000);
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
  const { data: session } = await admin.from("professional_sessions").select("id").eq("appointment_id", appointment.id).single();
  return { pro, person, connectionId: connection.id, appointmentId: appointment.id, sessionId: session!.id };
}

type Grant = { token: string; e2eeKey: string; generation: number };

/** Guarda as respostas de `join` (token + chave) para as provas de revogacao. */
function recordGrants(page: Page, grants: Grant[], secretsSeen: string[]) {
  page.on("response", async (response) => {
    if (!response.url().includes("/media") || response.request().method() !== "POST") return;
    const body = (await response.json().catch(() => null)) as { data?: { generation?: number; join?: { token: string; e2eeKey: string } } } | null;
    const join = body?.data?.join;
    if (join) {
      grants.push({ token: join.token, e2eeKey: join.e2eeKey, generation: body!.data!.generation! });
      expect(response.headers()["cache-control"]).toContain("no-store");
    }
  });
  page.on("console", (message) => secretsSeen.push(message.text()));
  page.on("request", (request) => secretsSeen.push(request.url()));
}

async function joinCall(page: Page) {
  const precall = page.getByTestId("pre-call");
  await expect(precall).toBeVisible();
  await expect(page.getByTestId("pre-call-e2ee")).toHaveAttribute("data-ok", "true");
  await page.getByTestId("join-call").click();
  const stage = page.getByTestId("call-stage");
  await expect(stage).toHaveAttribute("data-call-state", /connected|failed/, { timeout: 30_000 });
  if ((await stage.getAttribute("data-call-state")) === "failed") {
    // Diagnostico, nao segunda chance: o motivo exato vai para o erro.
    const reason = await page.getByTestId("call-failure").textContent().catch(() => null);
    throw new Error(`Chamada falhou ao entrar: ${reason ?? "sem motivo exibido"}`);
  }
  await expect(stage).toHaveAttribute("data-e2ee", "on");
}

async function remoteVideoPlaying(page: Page) {
  return page.getByTestId("remote-video").evaluate((video: HTMLVideoElement) => video.videoWidth > 0 && !video.paused);
}

async function cleanup(admin: Admin, created: string[]) {
  await admin.from("multimodal_sessions").delete().in("user_id", created);
  await admin.from("appointments").delete().in("client_user_id", created);
  await cleanupAccounts(admin, created);
}

test.describe("Stage 29 / PRO-7R - chamada em tempo real", () => {
  test.beforeAll(async () => {
    if (!(await livekitUp())) {
      throw new Error("LiveKit local nao esta respondendo em :7880. Rode `npm run realtime:start` antes deste spec.");
    }
  });

  test("chamada 1:1 com E2EE e TUDO desligado: midia flui e nada e registrado (gate critico)", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.skip(testInfo.project.name !== "desktop", "mecanica de chamada com dois contextos: desktop");
    test.setTimeout(300_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const { pro, person, sessionId, connectionId } = await scene(admin, testInfo.project.name, created);
      const stranger = await createProfessionalAccount(admin, testInfo.project.name, "Outro Pro");
      created.push(stranger.userId);
      const grants: Grant[] = [];
      const seen: string[] = [];

      // Pessoa: pre-call, previa local (nao registra), entra; sozinha na sala.
      const personSide = await contextFor(browser, baseURL, person);
      recordGrants(personSide.page, grants, seen);
      await gotoHydrated(personSide.page, `/agenda/sessao/${sessionId}`);
      await expect(personSide.page.getByTestId("pre-call-elyra")).toContainText("Nada ligado");
      await personSide.page.getByRole("button", { name: "Testar câmera e microfone" }).click();
      await expect(personSide.page.getByTestId("pre-call-mic").locator("[data-status]")).toHaveAttribute("data-status", "granted");
      await expect(personSide.page.getByTestId("pre-call-camera").locator("[data-status]")).toHaveAttribute("data-status", "granted");
      await expect(personSide.page.getByTestId("pre-call-service").locator("[data-status]")).toHaveAttribute("data-status", "available");
      await joinCall(personSide.page);
      await expect(personSide.page.getByTestId("remote-placeholder")).toHaveText("Aguardando o outro participante.");

      // Profissional entra: os dois recebem video e audio cifrados.
      const proSide = await contextFor(browser, baseURL, pro);
      recordGrants(proSide.page, grants, seen);
      await gotoHydrated(proSide.page, `/pro/sessoes/${sessionId}`);
      await joinCall(proSide.page);
      await expect(personSide.page.getByTestId("call-stage")).toHaveAttribute("data-remote-present", "true");
      await expect(proSide.page.getByTestId("call-stage")).toHaveAttribute("data-remote-present", "true");
      await expect.poll(() => remoteVideoPlaying(personSide.page), { timeout: 20_000 }).toBe(true);
      await expect.poll(() => remoteVideoPlaying(proSide.page), { timeout: 20_000 }).toBe(true);
      const remoteAudio = await personSide.page
        .getByTestId("remote-audio")
        .evaluate((audio: HTMLAudioElement) => (audio.srcObject as MediaStream | null)?.getAudioTracks().length ?? 0);
      expect(remoteAudio).toBe(1);
      await expect(personSide.page.getByTestId("call-announcer")).toContainText("Helena Chamada entrou na chamada.");
      // Presenca: sessao (Elyra) e chamada (midia) sao dois fatos com nomes diferentes.
      await expect(personSide.page.getByTestId("peer-call-presence")).toHaveText("Na chamada: conectado");

      // Microfone e camera da chamada: estado em texto do outro lado.
      await personSide.page.getByTestId("toggle-mic").click();
      await expect(proSide.page.getByText("Microfone desligado")).toBeVisible();
      await personSide.page.getByTestId("toggle-camera").click();
      await expect(proSide.page.getByTestId("remote-placeholder")).toHaveText("Câmera desligada.");
      await personSide.page.getByTestId("toggle-camera").click();
      await expect.poll(() => remoteVideoPlaying(proSide.page), { timeout: 20_000 }).toBe(true);

      // GATE CRITICO: chamada com microfone/camera e todos os consentimentos
      // desligados nao cria captura, transcricao, analise nem midia.
      const [captures, transcripts, media] = await Promise.all([
        admin.from("multimodal_sessions").select("id", { count: "exact", head: true }).in("user_id", [person.userId, pro.userId]),
        admin.from("session_transcripts").select("id", { count: "exact", head: true }).in("user_id", [person.userId, pro.userId]),
        admin.from("media_assets").select("id", { count: "exact", head: true }).in("user_id", [person.userId, pro.userId]),
      ]);
      expect(captures.count).toBe(0);
      expect(transcripts.count).toBe(0);
      expect(media.count).toBe(0);

      // Autorizacao: outro profissional e anonimo nao obtem midia (nem chave).
      const strangerSide = await contextFor(browser, baseURL, stranger);
      const strangerJoin = await strangerSide.page.request.post(`/api/professional-sessions/${sessionId}/media`, { data: { purpose: "join" } });
      expect(strangerJoin.status()).toBe(404);
      expect(await strangerJoin.text()).not.toMatch(/token|e2ee/i);
      await strangerSide.context.close();
      const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      expect((await anon.request.post(`${baseURL}/api/professional-sessions/${sessionId}/media`, { data: { purpose: "join" } })).status()).toBe(401);
      await anon.close();
      const forged = await personSide.page.request.post(`/api/professional-sessions/${sessionId}/media`, {
        data: { purpose: "join", room: "r_qualquer", identity: "admin" },
      });
      expect(forged.status()).toBe(400);

      // Sair e voltar: a outra parte ve a saida; reentrada pede token novo a Elyra.
      await personSide.page.getByTestId("leave-call").click();
      await expect(proSide.page.getByTestId("remote-placeholder")).toHaveText("Aguardando o outro participante.");
      await expect(proSide.page.getByTestId("call-announcer")).toContainText("Marina Chamada saiu da chamada.");
      await joinCall(personSide.page);
      await expect(proSide.page.getByTestId("call-stage")).toHaveAttribute("data-remote-present", "true");

      // REVOGACAO durante a chamada: vinculo pausado fora desta tela (sem o
      // atalho do servico). O heartbeat (<= 30 s) derruba os DOIS lados.
      const beforePause = grants.at(-1)!;
      const paused = await admin
        .from("professional_connections")
        .update({ status: "paused", paused_at: new Date().toISOString() })
        .eq("id", connectionId);
      expect(paused.error).toBeNull();
      for (const side of [personSide.page, proSide.page]) {
        await expect(side.getByTestId("call-notice")).toContainText("O acompanhamento não está ativo", { timeout: 45_000 });
        await expect(side.getByTestId("call-stage")).toHaveCount(0);
      }
      // O token antigo nao reconecta: a sala da geracao antiga nao existe mais.
      const replay = await fetch(`${LIVEKIT_HTTP}/rtc/validate?access_token=${beforePause.token}`);
      expect(replay.status).toBe(404);
      // Vinculo pausado: a Elyra recusa novo token.
      const deniedJoin = await personSide.page.request.post(`/api/professional-sessions/${sessionId}/media`, { data: { purpose: "join" } });
      expect((await deniedJoin.json()).data).toMatchObject({ status: "denied", reason: "relationship_inactive" });

      // Retomar: geracao nova => sala nova e CHAVE NOVA.
      await admin.from("professional_connections").update({ status: "active", paused_at: null }).eq("id", connectionId);
      await gotoHydrated(personSide.page, `/agenda/sessao/${sessionId}`);
      await joinCall(personSide.page);
      const afterResume = grants.at(-1)!;
      expect(afterResume.generation).toBeGreaterThan(beforePause.generation);
      expect(afterResume.e2eeKey).not.toBe(beforePause.e2eeKey);
      expect(new Set(grants.map((grant) => grant.e2eeKey)).size).toBe(new Set(grants.map((grant) => grant.generation)).size);

      // Encerrar pela Elyra: a chamada cai para a pessoa na hora (sala apagada).
      await gotoHydrated(proSide.page, `/pro/sessoes/${sessionId}`);
      await proSide.page.getByRole("button", { name: "Encerrar sessão" }).click();
      await proSide.page.getByRole("dialog", { name: "Encerrar sessão" }).getByRole("button", { name: "Encerrar sessão" }).click();
      await expect(personSide.page.getByTestId("call-notice")).toContainText(/sessão não está aberta|chamada caiu|encerrada/, { timeout: 20_000 });
      await expect(personSide.page.getByTestId("call-stage")).toHaveCount(0, { timeout: 20_000 });
      const afterEnd = await fetch(`${LIVEKIT_HTTP}/rtc/validate?access_token=${afterResume.token}`);
      expect(afterEnd.status).toBe(404);

      // Trilha: so metadado; token e chave nunca aparecem em URL nem console.
      const { data: events } = await admin.from("professional_session_events").select("event,detail").eq("session_id", sessionId);
      const names = new Set((events ?? []).map((item) => item.event));
      for (const expected of ["REALTIME_AUTHORIZED", "REALTIME_JOINED", "REALTIME_LEFT", "REALTIME_DENIED", "REALTIME_TERMINATED"]) {
        expect(names.has(expected), expected).toBe(true);
      }
      const trail = JSON.stringify(events);
      const everything = seen.join("\n");
      for (const grant of grants) {
        expect(trail).not.toContain(grant.e2eeKey);
        expect(everything).not.toContain(grant.e2eeKey);
        // O SDK leva o token ao servidor de midia; nunca a uma URL da Elyra.
        expect(seen.filter((line) => line.includes(grant.token) && !/^(ws|http):\/\/localhost:7880\//.test(line))).toEqual([]);
      }

      // Zero captura, do comeco ao fim.
      const finalCaptures = await admin
        .from("multimodal_sessions")
        .select("id", { count: "exact", head: true })
        .in("user_id", [person.userId, pro.userId]);
      expect(finalCaptures.count).toBe(0);

      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await cleanup(admin, created);
    }
  });

  test("registro durante a chamada: so o track local, sem getUserMedia novo; revogar para e a chamada segue", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.skip(testInfo.project.name !== "desktop", "integracao de captura: desktop");
    test.setTimeout(240_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const { pro, person, sessionId } = await scene(admin, testInfo.project.name, created);
      await admin.from("user_preferences").update({ sessions_enabled: true }).eq("user_id", person.userId);
      const personSide = await contextFor(browser, baseURL, person);
      // Conta cada getUserMedia da pagina: a captura embutida nao pode pedir de novo.
      await personSide.context.addInitScript(() => {
        const media = navigator.mediaDevices;
        const original = media.getUserMedia.bind(media);
        (window as unknown as { __gum: number }).__gum = 0;
        media.getUserMedia = (constraints) => {
          (window as unknown as { __gum: number }).__gum += 1;
          return original(constraints);
        };
      });
      await gotoHydrated(personSide.page, `/agenda/sessao/${sessionId}`);
      await joinCall(personSide.page);
      const proSide = await contextFor(browser, baseURL, pro);
      await gotoHydrated(proSide.page, `/pro/sessoes/${sessionId}`);
      await joinCall(proSide.page);
      await expect(personSide.page.getByTestId("call-stage")).toHaveAttribute("data-remote-present", "true");

      // Sem permissao de registro: a chamada funciona e registrar nao aparece.
      await expect(personSide.page.getByTestId("session-capture")).toContainText("Microfone e câmera estão desligados");
      await personSide.page.getByRole("button", { name: "Alterar permissões" }).click();
      const consents = personSide.page.getByRole("dialog", { name: "Permissões desta sessão" });
      await expect(consents).toContainText("A chamada funciona com tudo desligado.");
      await consents.getByRole("switch", { name: "Microfone", exact: true }).click();
      await expect(consents.getByRole("switch", { name: "Microfone", exact: true })).toHaveAttribute("data-state", "checked");
      await consents.getByRole("button", { name: "Concluir" }).click();

      await personSide.page.getByTestId("start-embedded-capture").click();
      const dialog = personSide.page.getByRole("dialog", { name: "Registrar nesta sessão" });
      await expect(dialog).toContainText("sem pedir de novo");
      await expect(dialog.getByRole("switch", { name: "Câmera" })).toBeDisabled();
      // Transcricao e IA so com o proprio consentimento.
      await expect(dialog.getByRole("switch", { name: "Transcrever no aparelho" })).toBeDisabled();
      await dialog.getByRole("button", { name: "Começar registro" }).click();
      const embedded = personSide.page.getByTestId("embedded-capture");
      await expect(embedded).toBeVisible();
      await expect(personSide.page).toHaveURL(new RegExp(`/agenda/sessao/${sessionId}$`));
      const gumBefore = await personSide.page.evaluate(() => (window as unknown as { __gum: number }).__gum);
      await embedded.getByRole("button", { name: "Iniciar registro" }).click();
      await expect(embedded.getByTestId("capture-state-microphone")).toHaveText("Captura ativa");
      const gumAfter = await personSide.page.evaluate(() => (window as unknown as { __gum: number }).__gum);
      expect(gumAfter, "a captura embutida nao chama getUserMedia").toBe(gumBefore);
      await expect(personSide.page.getByTestId("call-stage")).toHaveAttribute("data-call-state", "connected");
      await expect(proSide.page.getByTestId("call-stage")).toHaveAttribute("data-remote-present", "true");

      const { data: rows } = await admin
        .from("multimodal_sessions")
        .select("microphone_consent,camera_consent,screen_consent,transcription_consent,professional_session_id")
        .eq("user_id", person.userId);
      expect(rows).toEqual([
        { microphone_consent: true, camera_consent: false, screen_consent: false, transcription_consent: false, professional_session_id: sessionId },
      ]);

      // Microfone desligado NA CHAMADA encerra a fonte da captura tambem.
      await personSide.page.getByTestId("toggle-mic").click();
      await expect(embedded.getByTestId("capture-state-microphone")).not.toHaveText("Captura ativa");
      await personSide.page.getByTestId("toggle-mic").click();

      // Revogar a permissao: o registro para NA HORA e a chamada continua.
      await personSide.page.getByRole("button", { name: "Alterar permissões" }).click();
      await consents.getByRole("switch", { name: "Microfone", exact: true }).click();
      await expect(consents.getByRole("switch", { name: "Microfone", exact: true })).toHaveAttribute("data-state", "unchecked");
      await consents.getByRole("button", { name: "Concluir" }).click();
      await expect(embedded).toHaveCount(0);
      await expect(personSide.page.getByRole("status").filter({ hasText: "o registro parou. A chamada continua." })).toBeVisible();
      await expect(personSide.page.getByTestId("call-stage")).toHaveAttribute("data-call-state", "connected");
      await expect.poll(() => remoteVideoPlaying(proSide.page), { timeout: 20_000 }).toBe(true);

      // Nada da outra pessoa virou dado: o profissional nao tem captura; a pessoa
      // nao tem midia nem transcricao persistida.
      const [proCaptures, media, transcripts] = await Promise.all([
        admin.from("multimodal_sessions").select("id", { count: "exact", head: true }).eq("user_id", pro.userId),
        admin.from("media_assets").select("id", { count: "exact", head: true }).eq("user_id", person.userId),
        admin.from("session_transcripts").select("id", { count: "exact", head: true }).eq("user_id", person.userId),
      ]);
      expect(proCaptures.count).toBe(0);
      expect(media.count).toBe(0);
      expect(transcripts.count).toBe(0);
      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await cleanup(admin, created);
    }
  });

  test("gate de privacidade: VIDEO_CALL != GRAVACAO/TRANSCRICAO/IA; ligar tudo cria resultado; revogar leitura corta na hora", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.skip(testInfo.project.name !== "desktop", "mecanica de chamada com dois contextos: desktop");
    test.setTimeout(300_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const { pro, person, sessionId } = await scene(admin, testInfo.project.name, created);
      await admin.from("user_preferences").update({ sessions_enabled: true }).eq("user_id", person.userId);
      const both = [person.userId, pro.userId];
      async function artifacts() {
        const tables = ["multimodal_sessions", "media_assets", "session_transcripts", "derived_features", "session_interpretations", "processing_jobs"] as const;
        const counts = await Promise.all(
          tables.map((table) => admin.from(table).select("id", { count: "exact", head: true }).in("user_id", both)),
        );
        return Object.fromEntries(tables.map((table, index) => [table, counts[index]!.count]));
      }

      // Os dois na chamada, com camera e microfone DA CHAMADA ligados.
      const personSide = await contextFor(browser, baseURL, person);
      await gotoHydrated(personSide.page, `/agenda/sessao/${sessionId}`);
      await joinCall(personSide.page);
      const proSide = await contextFor(browser, baseURL, pro);
      await gotoHydrated(proSide.page, `/pro/sessoes/${sessionId}`);
      await joinCall(proSide.page);
      await expect(personSide.page.getByTestId("call-stage")).toHaveAttribute("data-remote-present", "true");
      await expect.poll(() => remoteVideoPlaying(personSide.page), { timeout: 20_000 }).toBe(true);
      await expect.poll(() => remoteVideoPlaying(proSide.page), { timeout: 20_000 }).toBe(true);

      // Mute/unmute e camera off/on: o outro lado ve o estado em texto e o video volta.
      await personSide.page.getByTestId("toggle-mic").click();
      await expect(proSide.page.getByText("Microfone desligado")).toBeVisible();
      await personSide.page.getByTestId("toggle-mic").click();
      await expect(proSide.page.getByText("Microfone desligado")).toHaveCount(0);
      await proSide.page.getByTestId("toggle-camera").click();
      await expect(personSide.page.getByTestId("remote-placeholder")).toHaveText("Câmera desligada.");
      await proSide.page.getByTestId("toggle-camera").click();
      await expect.poll(() => remoteVideoPlaying(personSide.page), { timeout: 20_000 }).toBe(true);

      // A. Chamada ativa + permissoes da Elyra TODAS desligadas = ZERO artefato.
      const { data: off } = await admin
        .from("professional_sessions")
        .select("allow_audio,allow_video,allow_transcription,allow_ai_derivation,allow_professional_transcript_access")
        .eq("id", sessionId)
        .single();
      expect(off).toEqual({
        allow_audio: false, allow_video: false, allow_transcription: false,
        allow_ai_derivation: false, allow_professional_transcript_access: false,
      });
      expect(await artifacts()).toEqual({
        multimodal_sessions: 0, media_assets: 0, session_transcripts: 0,
        derived_features: 0, session_interpretations: 0, processing_jobs: 0,
      });
      // Nem por fora da tela: o banco recusa captura ligada a esta sessao sem permissao.
      const sneaky = await admin.from("multimodal_sessions").insert({
        user_id: person.userId, kind: "free", microphone_consent: true, professional_session_id: sessionId,
      });
      expect(sneaky.error?.message).toContain("linked_session_consent");
      expect((await artifacts()).multimodal_sessions).toBe(0);
      expect((await proSide.page.request.get(`/api/professional-sessions/${sessionId}/transcript`)).status()).toBe(403);

      // B. Ligar explicitamente: microfone, camera, transcricao, IA e leitura do profissional.
      await personSide.page.getByRole("button", { name: "Alterar permissões" }).click();
      const consents = personSide.page.getByRole("dialog", { name: "Permissões desta sessão" });
      for (const name of ["Microfone", "Câmera", "Transcrição", "Análise por IA", "Profissional lê a transcrição"]) {
        const toggle = consents.getByRole("switch", { name, exact: true });
        await toggle.click();
        await expect(toggle).toHaveAttribute("data-state", "checked");
      }
      await consents.getByRole("button", { name: "Concluir" }).click();
      await expect(personSide.page.getByTestId("call-stage")).toHaveAttribute("data-call-state", "connected");

      // Registro pela tela, com o track local da chamada (microfone + camera).
      await personSide.page.getByTestId("start-embedded-capture").click();
      const register = personSide.page.getByRole("dialog", { name: "Registrar nesta sessão" });
      const cameraSwitch = register.getByRole("switch", { name: "Câmera" });
      await expect(cameraSwitch).toBeEnabled();
      if ((await cameraSwitch.getAttribute("data-state")) !== "checked") await cameraSwitch.click();
      await register.getByRole("button", { name: "Começar registro" }).click();
      const embedded = personSide.page.getByTestId("embedded-capture");
      await embedded.getByRole("button", { name: "Iniciar registro" }).click();
      await expect(embedded.getByTestId("capture-state-microphone")).toHaveText("Captura ativa");
      const { data: capture } = await admin
        .from("multimodal_sessions")
        .select("id,microphone_consent,camera_consent,professional_session_id")
        .eq("user_id", person.userId)
        .single();
      expect(capture).toMatchObject({ microphone_consent: true, camera_consent: true, professional_session_id: sessionId });

      // Resultados: o ASR real e do aparelho (QA fisico); aqui a transcricao e o
      // sinal de IA entram pelo banco e o guard ACEITA porque as permissoes estao ligadas.
      const transcript = await admin.from("session_transcripts").insert({
        session_id: capture!.id, user_id: person.userId, status: "available",
        content: "Texto sintetico da chamada de QA.", word_count: 6, voiced_duration_ms: 4000,
      });
      expect(transcript.error).toBeNull();
      const signal = await admin.from("derived_features").insert({
        session_id: capture!.id, user_id: person.userId, signal_name: "pause_count", unit: "count", value: 3, status: "available",
        personal_baseline_mean: 4, personal_baseline_samples: 3, delta_vs_personal_baseline: -1,
      });
      expect(signal.error).toBeNull();
      const read = await proSide.page.request.get(`/api/professional-sessions/${sessionId}/transcript`);
      expect(read.status()).toBe(200);
      expect(await read.text()).toContain("Texto sintetico da chamada de QA.");

      // C. Revogar a leitura do profissional: a proxima leitura ja e recusada.
      await personSide.page.getByRole("button", { name: "Alterar permissões" }).click();
      const readSwitch = consents.getByRole("switch", { name: "Profissional lê a transcrição", exact: true });
      await readSwitch.click();
      await expect(readSwitch).toHaveAttribute("data-state", "unchecked");
      await consents.getByRole("button", { name: "Concluir" }).click();
      const revoked = await proSide.page.request.get(`/api/professional-sessions/${sessionId}/transcript`);
      expect(revoked.status()).toBe(403);
      expect(await revoked.text()).not.toContain("sintetico");
      // Revogar IA: sinal novo e recusado na hora; a chamada segue dos dois lados.
      await personSide.page.getByRole("button", { name: "Alterar permissões" }).click();
      const aiSwitch = consents.getByRole("switch", { name: "Análise por IA", exact: true });
      await aiSwitch.click();
      await expect(aiSwitch).toHaveAttribute("data-state", "unchecked");
      await consents.getByRole("button", { name: "Concluir" }).click();
      const late = await admin.from("derived_features").insert({
        session_id: capture!.id, user_id: person.userId, signal_name: "pause_count", unit: "count", value: 4, status: "available",
        personal_baseline_mean: 4, personal_baseline_samples: 3, delta_vs_personal_baseline: 0,
      });
      expect(late.error?.message).toContain("linked_session_consent");
      await expect(personSide.page.getByTestId("call-stage")).toHaveAttribute("data-call-state", "connected");
      await expect(proSide.page.getByTestId("call-stage")).toHaveAttribute("data-remote-present", "true");

      // Nada do profissional virou dado, e a trilha registra a leitura sem conteudo.
      expect((await admin.from("multimodal_sessions").select("id", { count: "exact", head: true }).eq("user_id", pro.userId)).count).toBe(0);
      const { data: events } = await admin.from("professional_session_events").select("event,detail").eq("session_id", sessionId);
      expect((events ?? []).some((item) => item.event === "PROFESSIONAL_VIEWED_TRANSCRIPT")).toBe(true);
      expect(JSON.stringify(events)).not.toContain("sintetico");
      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await cleanup(admin, created);
    }
  });

  test("provider fora: aviso honesto, sem 500 nem tela branca; volta depois do reinicio", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.skip(testInfo.project.name !== "desktop", "controla o processo do LiveKit: um projeto");
    test.setTimeout(240_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const { person, sessionId, appointmentId } = await scene(admin, testInfo.project.name, created);
      const personSide = await contextFor(browser, baseURL, person);
      await gotoHydrated(personSide.page, `/agenda/sessao/${sessionId}`);
      const statuses: number[] = [];
      personSide.page.on("response", (response) => {
        if (response.url().endsWith("/media") && response.request().method() === "POST") statuses.push(response.status());
      });
      realtime("stop");
      try {
        await expect.poll(livekitUp, { timeout: 20_000 }).toBe(false);
        await personSide.page.getByTestId("join-call").click();
        await expect(personSide.page.getByTestId("call-notice")).toHaveText("Não foi possível iniciar a chamada.");
        expect(statuses).toContain(503);
        expect(statuses).not.toContain(500);
        await expect(personSide.page.getByRole("heading", { level: 1 })).toHaveText("Sessão com Helena Chamada");
        await expect(personSide.page.getByTestId("pre-call")).toBeVisible();
        const { data: appointment } = await admin.from("appointments").select("status").eq("id", appointmentId).single();
        expect(appointment?.status).toBe("confirmed");
        const { data: session } = await admin
          .from("professional_sessions")
          .select("status, allow_audio, allow_video")
          .eq("id", sessionId)
          .single();
        expect(session).toEqual({ status: "active", allow_audio: false, allow_video: false });
      } finally {
        realtime("start");
      }
      await expect.poll(livekitUp, { timeout: 60_000 }).toBe(true);
      await personSide.page.getByTestId("join-call").click();
      await expect(personSide.page.getByTestId("call-stage")).toHaveAttribute("data-call-state", "connected", { timeout: 30_000 });
      await personSide.context.close();
    } finally {
      await cleanup(admin, created);
    }
  });

  test("rede e provider: offline nao derruba a pagina; provider reinicia no meio da chamada e a reentrada passa pela Elyra", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.skip(testInfo.project.name !== "desktop", "rede simulada e processo do LiveKit: um projeto");
    test.setTimeout(300_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const { pro, person, sessionId } = await scene(admin, testInfo.project.name, created);
      const grants: Grant[] = [];
      const personSide = await contextFor(browser, baseURL, person);
      recordGrants(personSide.page, grants, []);
      await gotoHydrated(personSide.page, `/agenda/sessao/${sessionId}`);
      await joinCall(personSide.page);
      const proSide = await contextFor(browser, baseURL, pro);
      await gotoHydrated(proSide.page, `/pro/sessoes/${sessionId}`);
      await joinCall(proSide.page);
      await expect.poll(() => remoteVideoPlaying(personSide.page), { timeout: 20_000 }).toBe(true);

      // Offline por mais que o ciclo de releitura (15 s): a pagina da chamada
      // nao pode ser trocada pelo shell offline.
      await personSide.context.setOffline(true);
      await personSide.page.waitForTimeout(18_000);
      await expect(personSide.page).toHaveURL(new RegExp(`/agenda/sessao/${sessionId}$`));
      await expect(personSide.page.getByTestId("call-stage")).toBeVisible();
      await personSide.context.setOffline(false);
      await expect(personSide.page.getByTestId("call-stage")).toHaveAttribute("data-call-state", "connected", { timeout: 45_000 });

      // Provider cai no meio da chamada: "Reconectando" em texto; o provider
      // volta sem a sala (so a Elyra cria sala) e a reentrada pede a Elyra.
      realtime("stop");
      try {
        await expect(personSide.page.getByTestId("call-state")).toHaveText(/Reconectando|Desconectado/, { timeout: 30_000 });
      } finally {
        realtime("start");
      }
      await expect.poll(livekitUp, { timeout: 60_000 }).toBe(true);
      await expect(personSide.page.getByTestId("retry-call")).toBeVisible({ timeout: 120_000 });
      await expect(personSide.page.getByTestId("call-notice")).toContainText("A chamada caiu");
      await personSide.page.getByTestId("retry-call").click();
      await expect(personSide.page.getByTestId("call-stage")).toHaveAttribute("data-call-state", "connected", { timeout: 30_000 });
      // Mesma geracao (nada foi revogado): mesma chave, token novo emitido pela Elyra.
      expect(grants.length).toBeGreaterThanOrEqual(2);
      expect(grants.at(-1)!.generation).toBe(grants[0]!.generation);
      expect(grants.at(-1)!.e2eeKey).toBe(grants[0]!.e2eeKey);
      expect(grants.at(-1)!.token).not.toBe(grants[0]!.token);
      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await cleanup(admin, created);
    }
  });

  test("navegador sem E2EE: falha fechada, a chamada nao comeca", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.skip(testInfo.project.name !== "desktop", "estado: um projeto basta");
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const { person, sessionId } = await scene(admin, testInfo.project.name, created);
      const personSide = await contextFor(browser, baseURL, person);
      await personSide.context.addInitScript(() => {
        delete (window as unknown as { RTCRtpScriptTransform?: unknown }).RTCRtpScriptTransform;
        delete (RTCRtpSender.prototype as unknown as { createEncodedStreams?: unknown }).createEncodedStreams;
      });
      await gotoHydrated(personSide.page, `/agenda/sessao/${sessionId}`);
      await expect(personSide.page.getByTestId("pre-call-e2ee")).toHaveAttribute("data-ok", "false");
      await expect(personSide.page.getByTestId("pre-call-e2ee")).toContainText("A chamada não começa sem ela");
      await expect(personSide.page.getByTestId("join-call")).toBeDisabled();
      await personSide.context.close();
    } finally {
      await cleanup(admin, created);
    }
  });

  test("design: estados da chamada em todas as larguras, claro e escuro, axe e sem overflow", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.skip(testInfo.project.name !== "desktop", "varre as seis larguras num unico projeto");
    test.setTimeout(420_000);
    const admin = qaAdmin();
    const created: string[] = [];
    const shots = process.env.ELYRA_PRO7R_SHOTS ?? testInfo.outputPath("pro7r-visual");
    const widths = [360, 393, 412, 834, 1440, 1920];
    try {
      const { pro, person, sessionId } = await scene(admin, testInfo.project.name, created);
      const personSide = await contextFor(browser, baseURL, person);
      const proSide = await contextFor(browser, baseURL, pro);
      const page = personSide.page;

      async function sweep(state: string, check: () => Promise<void> = async () => undefined, sizes = widths) {
        for (const width of sizes) {
          await page.setViewportSize({ width, height: width < 800 ? 860 : 900 });
          for (const scheme of ["light", "dark"] as const) {
            await page.emulateMedia({ colorScheme: scheme });
            await check();
            const metrics = await measureDeadSpace(page);
            expect(metrics.horizontalOverflow, `${state} ${width} ${scheme}`).toBeLessThanOrEqual(0);
            await page.screenshot({ path: `${shots}/${state}-${width}-${scheme}.png`, fullPage: true });
          }
          const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
          expect(serious, `${state} ${width}: ${serious.map((item) => item.id).join(",")}`).toEqual([]);
        }
      }

      await gotoHydrated(page, `/agenda/sessao/${sessionId}`);
      await page.getByRole("button", { name: "Testar câmera e microfone" }).click();
      await expect(page.getByTestId("pre-call-camera").locator("[data-status]")).toHaveAttribute("data-status", "granted");
      await sweep("pre-call");

      await joinCall(page);
      await sweep("aguardando", async () => {
        await expect(page.getByTestId("remote-placeholder")).toHaveText("Aguardando o outro participante.");
      });

      await gotoHydrated(proSide.page, `/pro/sessoes/${sessionId}`);
      await joinCall(proSide.page);
      await expect.poll(() => remoteVideoPlaying(page), { timeout: 20_000 }).toBe(true);
      await sweep("conectado");

      await proSide.page.getByTestId("toggle-camera").click();
      await proSide.page.getByTestId("toggle-mic").click();
      await expect(page.getByTestId("remote-placeholder")).toHaveText("Câmera desligada.");
      await sweep("camera-e-microfone-desligados", async () => undefined, [393, 1440]);
      await proSide.page.getByTestId("toggle-camera").click();
      await proSide.page.getByTestId("toggle-mic").click();

      // Teclado: controles da chamada alcancaveis e com estado anunciado.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.getByTestId("toggle-mic").focus();
      await expect(page.getByTestId("toggle-mic")).toBeFocused();
      await expect(page.getByTestId("toggle-mic")).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("toggle-mic")).toHaveAttribute("aria-pressed", "false");
      await page.keyboard.press("Enter");

      await page.getByRole("button", { name: "Alterar permissões" }).click();
      await expect(page.getByRole("dialog", { name: "Permissões desta sessão" })).toBeVisible();
      await sweep("permissoes", async () => undefined, [393, 1440]);
      await page.keyboard.press("Escape");

      await personSide.context.setOffline(true);
      await expect(page.getByTestId("call-state")).toHaveText(/Reconectando|Conexão instável/, { timeout: 30_000 });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.screenshot({ path: `${shots}/reconectando-1440-light.png`, fullPage: true });
      await page.setViewportSize({ width: 393, height: 860 });
      await page.screenshot({ path: `${shots}/reconectando-393-light.png`, fullPage: true });
      await personSide.context.setOffline(false);
      await expect(page.getByTestId("call-stage")).toHaveAttribute("data-call-state", "connected", { timeout: 45_000 });

      await gotoHydrated(proSide.page, `/pro/sessoes/${sessionId}`);
      await proSide.page.setViewportSize({ width: 1440, height: 900 });
      await proSide.page.emulateMedia({ colorScheme: "light" });
      await proSide.page.screenshot({ path: `${shots}/pro-sala-1440-light.png`, fullPage: true });
      await proSide.page.getByRole("button", { name: "Encerrar sessão" }).click();
      await proSide.page.getByRole("dialog", { name: "Encerrar sessão" }).getByRole("button", { name: "Encerrar sessão" }).click();
      await expect(page.getByTestId("call-stage")).toHaveCount(0, { timeout: 30_000 });
      await gotoHydrated(page, `/agenda/sessao/${sessionId}`);
      await sweep("encerrada", async () => {
        await expect(page.getByTestId("session-ended")).toBeVisible();
      }, [393, 1440]);
      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await cleanup(admin, created);
    }
  });
});
