import { expect, test, type Browser, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import {
  cleanupAccounts,
  createPersonalAccount,
  createProfessionalAccount,
  qaAdmin,
  signIn,
  type QaAccount,
} from "./professional-fixtures";



const TZ = "America/Sao_Paulo";

test.use({
  launchOptions: { args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"] },
  permissions: ["camera", "microphone"],
});

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

async function joinCall(page: Page) {
  await page.getByTestId("join-call").click();
  const stage = page.getByTestId("call-stage");
  await expect(stage).toHaveAttribute("data-call-state", /connected|failed/, { timeout: 30_000 });
  if ((await stage.getAttribute("data-call-state")) === "failed") {
    throw new Error(`Chamada falhou ao entrar: ${await page.getByTestId("call-failure").textContent().catch(() => null)}`);
  }
  await expect(stage).toHaveAttribute("data-e2ee", "on");
}

test.describe("Stage 29 - jornada integrada Professional Care (PRO-0 -> PRO-7R)", () => {
  test("da descoberta ao fim do vinculo, com chamada E2EE no meio", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.skip(testInfo.project.name !== "desktop", "jornada encadeada com dois contextos: desktop");
    test.setTimeout(420_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Helena Jornada");
      const person = await createPersonalAccount(admin, testInfo.project.name, "Marina Jornada");
      created.push(pro.userId, person.userId);
      const slug = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
      const listed = await admin.from("professional_public_profiles").insert({
        user_id: pro.userId,
        slug,
        listed: true,
        display_name: "Helena Jornada",
        city: "Recife",
        state: "PE",
        modalities: ["online"],
        areas: ["ansiedade"],
        languages: ["pt"],
      });
      if (listed.error) throw listed.error;
      await admin.from("user_preferences").update({ sessions_enabled: true }).eq("user_id", person.userId);

      // 1. Descoberta -> pedido (fluxo B).
      const personSide = await contextFor(browser, baseURL, person);
      const p = personSide.page;
      await gotoHydrated(p, `/profissionais/${slug}`);
      const card = p.getByTestId("directory-accompaniment");
      await card.getByRole("button", { name: "Solicitar acompanhamento" }).click();
      await expect(card.getByRole("status")).toContainText("Solicitação enviada");

      // 2. Aceite na Central.
      const proSide = await contextFor(browser, baseURL, pro);
      const q = proSide.page;
      await gotoHydrated(q, "/pro/solicitacoes");
      await q.getByRole("button", { name: "Aceitar" }).click();
      await expect(q.getByText("Nenhuma solicitação esperando resposta")).toBeVisible();
      const { data: connection } = await admin
        .from("professional_connections")
        .select("id,status")
        .eq("client_user_id", person.userId)
        .single();
      expect(connection?.status).toBe("active");
      const connectionId = connection!.id;

      // 3. Grant pelo titular (nada e compartilhado antes disso).
      const grant = await p.request.put("/api/professional/permissions", {
        data: { connectionId, scope: "emotional", enabled: true },
      });
      expect(grant.status()).toBe(200);

      // 4. Disponibilidade (tela do profissional) -> pedido -> confirmacao.
      await gotoHydrated(q, "/pro/agenda");
      await q.getByRole("button", { name: "Adicionar intervalo" }).click();
      const tomorrow = new Date(Date.now() + 86_400_000);
      const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
        new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(tomorrow),
      );
      const editor = q.getByTestId("availability-editor");
      await editor.getByLabel("Dia").selectOption(String(weekday));
      await editor.getByLabel("Início").fill("08:00");
      await editor.getByLabel("Fim").fill("20:00");
      await editor.getByRole("button", { name: "Salvar disponibilidade" }).click();
      await expect(editor.getByRole("status")).toContainText("Disponibilidade salva");
      await gotoHydrated(p, "/agenda");
      await p.getByTestId("agenda-slots").getByRole("button").first().click();
      await p.getByRole("button", { name: "Pedir este horário" }).click();
      await expect(p.getByRole("status").filter({ hasText: "Pedido enviado" })).toBeVisible();
      await gotoHydrated(q, "/pro/agenda");
      await q.getByTestId("agenda-pending").getByRole("button", { name: "Confirmar" }).click();
      await expect(q.getByRole("status").filter({ hasText: "Horário confirmado" })).toBeVisible();
      const { data: appointment } = await admin
        .from("appointments")
        .select("id,status,modality")
        .eq("client_user_id", person.userId)
        .single();
      expect(appointment?.status).toBe("confirmed");
      // RELOGIO SIMULADO: o horario confirmado passa a comecar em 5 minutos.
      // `service_role` nao altera sessao (sem bypass de produto): a sessao da
      // hora antiga e apagada e a reconfirmacao faz o GATILHO real recria-la
      // com a janela nova (starts - 10 min .. ends + 15 min).
      const starts = new Date(Date.now() + 5 * 60_000);
      starts.setSeconds(0, 0);
      const ends = new Date(starts.getTime() + 50 * 60_000);
      const dropped = await admin.from("professional_sessions").delete().eq("appointment_id", appointment!.id);
      expect(dropped.error).toBeNull();
      const moved = await admin
        .from("appointments")
        .update({ starts_at: starts.toISOString(), ends_at: ends.toISOString(), modality: "online", status: "confirmed" })
        .eq("id", appointment!.id);
      expect(moved.error).toBeNull();
      const { data: sessionRow } = await admin
        .from("professional_sessions")
        .select("id,opens_at")
        .eq("appointment_id", appointment!.id)
        .single();
      expect(new Date(sessionRow!.opens_at).getTime()).toBe(starts.getTime() - 10 * 60_000);
      const sessionId = sessionRow!.id;

      // 5. Lembrete (24 h) e aviso de janela aberta, uma vez cada (event_key).
      await gotoHydrated(p, "/agenda");
      await gotoHydrated(p, "/agenda");
      const { data: notices } = await admin
        .from("notifications")
        .select("kind,event_key")
        .eq("user_id", person.userId)
        .in("kind", ["appointment_reminder", "session_ready"]);
      expect(notices?.filter((row) => row.kind === "appointment_reminder")).toHaveLength(1);
      expect(notices?.filter((row) => row.kind === "session_ready")).toHaveLength(1);

      // 6. Preparar sessao -> chamada E2EE, tudo desligado.
      await p.getByTestId("agenda-mine").getByRole("link", { name: "Abrir sessão" }).click();
      await expect(p).toHaveURL(new RegExp(`/agenda/sessao/${sessionId}$`));
      await expect(p.getByTestId("pre-call")).toBeVisible();
      await joinCall(p);
      await gotoHydrated(q, `/pro/sessoes/${sessionId}`);
      await joinCall(q);
      await expect(p.getByTestId("call-stage")).toHaveAttribute("data-remote-present", "true");
      const beforeConsent = await admin.from("multimodal_sessions").select("id", { count: "exact", head: true }).eq("user_id", person.userId);
      expect(beforeConsent.count).toBe(0);

      // 7. Consentimento (microfone + transcricao + leitura do profissional).
      await p.getByRole("button", { name: "Alterar permissões" }).click();
      const dialog = p.getByRole("dialog", { name: "Permissões desta sessão" });
      for (const name of ["Microfone", "Transcrição", "Profissional lê a transcrição"]) {
        await dialog.getByRole("switch", { name, exact: true }).click();
        await expect(dialog.getByRole("switch", { name, exact: true })).toHaveAttribute("data-state", "checked");
      }
      await dialog.getByRole("button", { name: "Concluir" }).click();

      // Registro durante a chamada (captura embutida, so track local).
      await p.getByTestId("start-embedded-capture").click();
      await p.getByRole("dialog", { name: "Registrar nesta sessão" }).getByRole("button", { name: "Começar registro" }).click();
      await expect(p.getByTestId("embedded-capture")).toBeVisible();
      const { data: capture } = await admin
        .from("multimodal_sessions")
        .select("id,microphone_consent,professional_session_id")
        .eq("user_id", person.userId)
        .single();
      expect(capture).toMatchObject({ microphone_consent: true, professional_session_id: sessionId });
      // Transcricao sintetica dessa captura (o ASR real e do aparelho).
      await admin.from("session_transcripts").insert({
        session_id: capture!.id,
        user_id: person.userId,
        status: "available",
        content: "Texto sintetico da jornada integrada.",
        word_count: 5,
        voiced_duration_ms: 3000,
      });

      // 8. Profissional le a transcricao; a leitura vai para a trilha do titular.
      await gotoHydrated(q, `/pro/sessoes/${sessionId}`);
      await q.getByRole("button", { name: "Ler transcrição" }).click();
      await expect(q.getByTestId("transcript-text")).toHaveText("Texto sintetico da jornada integrada.");

      // 9. Revogacao: a proxima leitura e recusada; o registro para; a chamada segue.
      await p.getByRole("button", { name: "Alterar permissões" }).click();
      await dialog.getByRole("switch", { name: "Microfone", exact: true }).click();
      await expect(dialog.getByRole("switch", { name: "Microfone", exact: true })).toHaveAttribute("data-state", "unchecked");
      await dialog.getByRole("button", { name: "Concluir" }).click();
      await expect(p.getByTestId("embedded-capture")).toHaveCount(0);
      expect((await q.request.get(`/api/professional-sessions/${sessionId}/transcript`)).status()).toBe(403);

      // 10. Profissional encerra a sessao: a chamada cai para os dois; sem reentrada.
      await joinCall(q);
      await q.getByRole("button", { name: "Encerrar sessão" }).click();
      await q.getByRole("dialog", { name: "Encerrar sessão" }).getByRole("button", { name: "Encerrar sessão" }).click();
      await expect(p.getByTestId("call-stage")).toHaveCount(0, { timeout: 30_000 });
      const reentry = await p.request.post(`/api/professional-sessions/${sessionId}/media`, { data: { purpose: "join" } });
      expect((await reentry.json()).data).toMatchObject({ status: "denied", reason: "session_closed" });

      // 11. Titular encerra o vinculo; grants e leitura caem na hora.
      const ended = await p.request.patch("/api/professional/connections", { data: { connectionId, action: "revoke" } });
      expect(ended.status()).toBe(200);
      const { data: after } = await admin.from("professional_connections").select("status").eq("id", connectionId).single();
      expect(after?.status).toBe("revoked");
      const trail = (await (await p.request.get("/api/professional/access-log")).json()) as {
        data: Array<{ event_type: string; connection_id: string }>;
      };
      const events = trail.data.filter((row) => row.connection_id === connectionId).map((row) => row.event_type);
      for (const expected of ["relationship_created", "grant_created"]) expect(events).toContain(expected);
      const { data: sessionEvents } = await admin.from("professional_session_events").select("event").eq("session_id", sessionId);
      const names = new Set((sessionEvents ?? []).map((row) => row.event));
      for (const expected of ["REALTIME_AUTHORIZED", "REALTIME_JOINED", "CONSENT_CHANGED", "PROFESSIONAL_VIEWED_TRANSCRIPT", "SESSION_COMPLETED", "REALTIME_TERMINATED"]) {
        expect(names.has(expected), expected).toBe(true);
      }
      expect(JSON.stringify(sessionEvents)).not.toContain("sintetico");

      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await admin.from("multimodal_sessions").delete().in("user_id", created);
      await admin.from("appointments").delete().in("client_user_id", created);
      await cleanupAccounts(admin, created);
    }
  });
});
