import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import type { Database } from "@/lib/supabase/database.types";
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



type Client = SupabaseClient<Database>;
const TZ = "America/Sao_Paulo";

async function userClient(account: QaAccount): Promise<Client> {
  process.loadEnvFile?.(".env.local");
  const client = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw error;
  return client;
}

async function connect(admin: Admin, client: QaAccount, professional: QaAccount) {
  const { data, error } = await admin
    .from("professional_connections")
    .insert({
      client_user_id: client.userId,
      professional_user_id: professional.userId,
      invited_by_user_id: client.userId,
      status: "active",
      accepted_at: new Date(Date.now() - 86_400_000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

/** Disponibilidade o dia todo, todos os dias, pelo caminho real (RPC do profissional). */
async function openAllWeek(pro: Client, slot = 60) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const last = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 59 * 86_400_000));
  const { error } = await pro.rpc("save_professional_availability_exception", {
    p_timezone: TZ,
    p_exception: { kind: "open", starts_on: today, ends_on: last, start_minute: 0, end_minute: 1440, slot_minutes: slot, modality: "online" },
  });
  if (error) throw error;
}

async function firstOpenSlot(client: Client, professionalUserId: string, skip = 0) {
  const from = new Date();
  const { data, error } = await client.rpc("list_professional_open_slots", {
    p_professional_user_id: professionalUserId,
    p_from: from.toISOString(),
    p_to: new Date(from.getTime() + 3 * 86_400_000).toISOString(),
  });
  if (error) throw error;
  const slot = data?.[skip];
  if (!slot) throw new Error("Nenhum horario livre para o teste.");
  return slot;
}

async function personPage(browser: Browser, baseURL: string, account: QaAccount) {
  // Contexto vazio: sem o storageState do projeto (identidade QA do global-setup).
  const context = await browser.newContext({
    ...test.info().project.use,
    timezoneId: TZ,
    locale: "pt-BR",
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  await signIn(page, baseURL, account);
  return { context, page };
}

test.describe("Stage 29 / PRO-6 - dupla reserva e idempotencia sob concorrencia real", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "prova de banco: um projeto basta");
  });

  test("12 pessoas pedem o mesmo horario ao mesmo tempo: exatamente 1 passa", async ({}, testInfo) => {
    test.setTimeout(180_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Profissional Corrida");
      created.push(pro.userId);
      await openAllWeek(await userClient(pro));

      const people: Array<{ account: QaAccount; connectionId: string; client: Client }> = [];
      for (let index = 0; index < 12; index += 1) {
        const account = await createPersonalAccount(admin, testInfo.project.name, `Pessoa Corrida ${index}`);
        created.push(account.userId);
        people.push({ account, connectionId: await connect(admin, account, pro), client: await userClient(account) });
      }
      const slot = await firstOpenSlot(people[0]!.client, pro.userId);

      const results = await Promise.allSettled(
        people.map(({ client, connectionId }) =>
          client
            .rpc("request_appointment", {
              p_connection_id: connectionId,
              p_starts_at: slot.starts_at,
              p_modality: "online",
              p_idempotency_key: crypto.randomUUID(),
            })
            .then(({ data, error }) => {
              if (error) throw new Error(error.message);
              return data;
            }),
        ),
      );
      const ok = results.filter((result) => result.status === "fulfilled");
      const refused = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(refused).toHaveLength(11);
      for (const failure of refused) expect(String(failure.reason)).toContain("slot_unavailable");

      const { count } = await admin
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("professional_user_id", pro.userId)
        .eq("starts_at", slot.starts_at)
        .in("status", ["requested", "confirmed"]);
      expect(count).toBe(1);
    } finally {
      await admin.from("appointments").delete().in("client_user_id", created);
      await cleanupAccounts(admin, created);
    }
  });

  test("a mesma chave em 8 envios simultaneos vira 1 pedido; chave nova para outro horario da mesma pessoa em conflito e recusada", async ({}, testInfo) => {
    test.setTimeout(120_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Profissional Idempotencia");
      const pro2 = await createProfessionalAccount(admin, testInfo.project.name, "Profissional Dois");
      const person = await createPersonalAccount(admin, testInfo.project.name, "Pessoa Idempotencia");
      created.push(pro.userId, pro2.userId, person.userId);
      await openAllWeek(await userClient(pro));
      await openAllWeek(await userClient(pro2));
      const connection = await connect(admin, person, pro);
      const connection2 = await connect(admin, person, pro2);
      const client = await userClient(person);
      const slot = await firstOpenSlot(client, pro.userId);
      const key = crypto.randomUUID();

      const replies = await Promise.all(
        Array.from({ length: 8 }, () =>
          client.rpc("request_appointment", {
            p_connection_id: connection,
            p_starts_at: slot.starts_at,
            p_modality: "online",
            p_idempotency_key: key,
          }),
        ),
      );
      const ids = new Set(replies.map((reply) => reply.data));
      expect(replies.every((reply) => reply.error === null)).toBe(true);
      expect(ids.size).toBe(1);

      // Replay depois (timeout + retry): mesmo id.
      const replay = await client.rpc("request_appointment", {
        p_connection_id: connection,
        p_starts_at: slot.starts_at,
        p_modality: "online",
        p_idempotency_key: key,
      });
      expect(replay.data).toBe([...ids][0]);

      // Mesma chave, outro horario: recusado, nunca reaproveitado.
      const tampered = await client.rpc("request_appointment", {
        p_connection_id: connection,
        p_starts_at: new Date(new Date(slot.starts_at).getTime() + 3_600_000).toISOString(),
        p_modality: "online",
        p_idempotency_key: key,
      });
      expect(tampered.error?.message).toBe("idempotency_mismatch");

      // A propria pessoa nao fica em dois lugares: mesmo instante com outro profissional.
      const clash = await client.rpc("request_appointment", {
        p_connection_id: connection2,
        p_starts_at: slot.starts_at,
        p_modality: "online",
        p_idempotency_key: crypto.randomUUID(),
      });
      expect(clash.error?.message).toBe("slot_unavailable");

      const { count } = await admin
        .from("appointments")
        .select("id", { count: "exact", head: true })
        .eq("client_user_id", person.userId);
      expect(count).toBe(1);
    } finally {
      await admin.from("appointments").delete().in("client_user_id", created);
      await cleanupAccounts(admin, created);
    }
  });
});

test.describe("Stage 29 / PRO-6 - jornada pela interface", () => {
  test("profissional abre horarios, pessoa pede, profissional confirma, pessoa cancela", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.setTimeout(180_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Helena Agenda");
      const person = await createPersonalAccount(admin, testInfo.project.name, "Marina Agenda");
      const stranger = await createPersonalAccount(admin, testInfo.project.name, "Outra Pessoa");
      created.push(pro.userId, person.userId, stranger.userId);
      await connect(admin, person, pro);

      // 1. Profissional: vazio honesto, depois um intervalo salvo pela tela.
      const proSide = await personPage(browser, baseURL, pro);
      await gotoHydrated(proSide.page, "/pro/agenda");
      await expect(proSide.page.getByRole("heading", { level: 1, name: "Agenda" })).toBeVisible();
      await expect(proSide.page.getByRole("tab", { name: /^Disponibilidade/ })).toHaveAttribute("aria-selected", "true");
      await expect(proSide.page.getByLabel("Fuso da agenda")).toHaveValue(TZ);
      const tomorrowKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86_400_000));
      await proSide.page.getByLabel("Ir para uma data").fill(tomorrowKey);
      const dayEditor = proSide.page.getByTestId("week-day-" + tomorrowKey);
      await dayEditor.getByLabel("Disponível", { exact: true }).check();
      await dayEditor.getByLabel("Início", { exact: true }).fill("08:00");
      await dayEditor.getByLabel("Fim", { exact: true }).fill("20:00");
      await proSide.page.getByRole("button", { name: "Salvar disponibilidade da semana" }).click();
      await expect(proSide.page.getByRole("status").filter({ hasText: "Disponibilidade da semana salva." })).toBeVisible();

      // Overlap is rejected as a whole save; no partial publication.
      await dayEditor.getByRole("button", { name: "Adicionar horário" }).click();
      await dayEditor.getByLabel("Início", { exact: true }).last().fill("09:00");
      await dayEditor.getByLabel("Fim", { exact: true }).last().fill("10:00");
      await proSide.page.getByRole("button", { name: "Salvar disponibilidade da semana" }).click();
      await expect(proSide.page.getByTestId("weekly-availability").getByRole("alert")).toContainText("se sobrepõem");
      await dayEditor.getByRole("button", { name: "Remover intervalo" }).last().click();

      // 2. Pessoa: horarios por dia, escolhe, pede.
      const personSide = await personPage(browser, baseURL, person);
      await gotoHydrated(personSide.page, "/agenda");
      await expect(personSide.page.getByRole("heading", { level: 1, name: "Sessão com profissional" })).toBeVisible();
      // Nada marcado e ha profissional com horarios: a pagina abre em "Agendar".
      await expect(personSide.page.getByRole("tab", { name: "Agendar" })).toHaveAttribute("aria-selected", "true");
      if (new Date(tomorrowKey + "T12:00:00Z").getUTCDay() === 1) await personSide.page.getByRole("button", { name: "Próxima semana" }).click();
      const slots = personSide.page.getByTestId("agenda-slots");
      await expect(slots.getByRole("button").first()).toBeVisible();
      const firstSlot = slots.getByRole("button").first();
      await expect(firstSlot).toHaveAttribute("aria-pressed", "false");
      await firstSlot.click();
      await expect(firstSlot).toHaveAttribute("aria-pressed", "true");
      await personSide.page.getByRole("button", { name: "Pedir este horário" }).dblclick();
      await expect(personSide.page.getByRole("status").filter({ hasText: "Pedido enviado" })).toBeVisible();
      const mine = personSide.page.getByTestId("agenda-mine");
      await expect(mine.getByText("Aguardando confirmação")).toBeVisible();
      const { data: rows } = await admin.from("appointments").select("id,status").eq("client_user_id", person.userId);
      expect(rows).toHaveLength(1);
      const appointmentId = rows![0]!.id;

      // Recusas pela API: outra pessoa, anonimo, horario adulterado.
      const strangerSide = await personPage(browser, baseURL, stranger);
      const cross = await strangerSide.page.request.patch(`/api/scheduling/appointments/${appointmentId}`, {
        data: { action: "cancel", reason: "other" },
      });
      expect(cross.status()).toBe(404);
      const selfConfirm = await personSide.page.request.patch(`/api/scheduling/appointments/${appointmentId}`, {
        data: { action: "confirm" },
      });
      expect(selfConfirm.status()).toBe(404);
      const anonContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const anon = await anonContext.request.get(`${baseURL}/api/scheduling/appointments`);
      expect(anon.status()).toBe(401);
      await anonContext.close();
      const slotRow = await firstOpenSlot(await userClient(person), pro.userId, 1);
      const connectionId = (
        await admin.from("professional_connections").select("id").eq("client_user_id", person.userId).single()
      ).data!.id;
      const tampered = await personSide.page.request.post("/api/scheduling/appointments", {
        data: {
          connectionId,
          startsAt: new Date(new Date(slotRow.starts_at).getTime() + 7 * 60_000).toISOString(),
          modality: "online",
          idempotencyKey: crypto.randomUUID(),
        },
      });
      expect(tampered.status()).toBe(422);
      expect(await tampered.json()).toMatchObject({ code: "slot_not_offered" });
      const badTz = await proSide.page.request.put("/api/scheduling/availability", {
        data: { timezone: "-03:00", rules: [] },
      });
      expect(badTz.status()).toBe(400);
      const strangerSlots = await strangerSide.page.request.get(
        `/api/scheduling/slots?professional=${pro.userId}&from=${encodeURIComponent(new Date().toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 7 * 86_400_000).toISOString())}`,
      );
      expect(strangerSlots.status()).toBe(200);
      expect((await strangerSlots.json()).data).toEqual([]);
      await strangerSide.context.close();

      // 3. Profissional confirma.
      await gotoHydrated(proSide.page, "/pro/agenda");
      await proSide.page.getByLabel("Ir para uma data").fill(tomorrowKey);
      await proSide.page.getByRole("tab", { name: "Agenda", exact: true }).click();
      const pending = proSide.page.getByTestId("agenda-week");
      await expect(pending.getByText("Marina Agenda")).toBeVisible();
      await pending.getByRole("button", { name: "Confirmar" }).click();
      await expect(proSide.page.getByRole("status").filter({ hasText: "Horário confirmado" })).toBeVisible();
      await expect(proSide.page.getByTestId("agenda-week").getByText("Marina Agenda")).toBeVisible();

      // Notificacao in-app de confirmacao para a pessoa (pipeline existente).
      const { data: confirmedNotice } = await admin
        .from("notifications")
        .select("kind")
        .eq("user_id", person.userId)
        .eq("event_key", `appointment_confirmed:${appointmentId}`);
      expect(confirmedNotice).toHaveLength(1);

      // 4. Pessoa ve confirmado e cancela com motivo fechado.
      await gotoHydrated(personSide.page, "/agenda");
      await expect(mine.getByText("Confirmado", { exact: true })).toBeVisible();
      await expect(mine.getByText("Helena Agenda")).toBeVisible();
      await mine.getByRole("button", { name: "Cancelar" }).click();
      const dialog = personSide.page.getByRole("dialog", { name: "Cancelar horário" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Mudança de agenda").check();
      await dialog.getByRole("button", { name: "Cancelar horário" }).click();
      await expect(personSide.page.getByRole("status").filter({ hasText: "Horário cancelado" })).toBeVisible();
      await expect(personSide.page.getByText("Nenhum horário marcado")).toBeVisible();

      const { data: after } = await admin
        .from("appointments")
        .select("status,cancel_reason,cancelled_by")
        .eq("id", appointmentId)
        .single();
      expect(after).toMatchObject({ status: "cancelled", cancel_reason: "schedule_change", cancelled_by: person.userId });
      const { data: cancelledNotice } = await admin
        .from("notifications")
        .select("kind")
        .eq("user_id", pro.userId)
        .eq("event_key", `appointment_cancelled:${appointmentId}`);
      expect(cancelledNotice).toHaveLength(1);

      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await admin.from("appointments").delete().in("client_user_id", created);
      await cleanupAccounts(admin, created);
    }
  });
});

test.describe("Stage 29 / PRO-6 - a11y, responsivo e evidencia visual", () => {
  async function scene(browser: Browser, baseURL: string, project: string, admin: Admin, created: string[]) {
    const pro = await createProfessionalAccount(admin, project, "Helena Visual");
    const person = await createPersonalAccount(admin, project, "Marina Visual");
    const other = await createPersonalAccount(admin, project, "Joana Visual");
    created.push(pro.userId, person.userId, other.userId);
    const proClient = await userClient(pro);
    await openAllWeek(proClient, 50);
    await connect(admin, person, pro);
    await connect(admin, other, pro);
    // Um pedido pendente (Joana) e um confirmado (Marina), pelo caminho real.
    const personClient = await userClient(person);
    const otherClient = await userClient(other);
    const s1 = await firstOpenSlot(personClient, pro.userId, 2);
    const s2 = await firstOpenSlot(otherClient, pro.userId, 5);
    const c1 = (await admin.from("professional_connections").select("id").eq("client_user_id", person.userId).single()).data!.id;
    const c2 = (await admin.from("professional_connections").select("id").eq("client_user_id", other.userId).single()).data!.id;
    const a1 = await personClient.rpc("request_appointment", {
      p_connection_id: c1, p_starts_at: s1.starts_at, p_modality: "online", p_idempotency_key: crypto.randomUUID(),
    });
    await otherClient.rpc("request_appointment", {
      p_connection_id: c2, p_starts_at: s2.starts_at, p_modality: "online", p_idempotency_key: crypto.randomUUID(),
    });
    await proClient.rpc("confirm_appointment", { p_appointment_id: a1.data! });
    const proSide = await personPage(browser, baseURL, pro);
    const personSide = await personPage(browser, baseURL, person);
    return { proSide, personSide };
  }

  test("axe sem violacao seria/critica nas duas agendas; sem rolagem lateral nem coluna vazia", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    test.setTimeout(240_000);
    const admin = qaAdmin();
    const created: string[] = [];
    try {
      const { proSide, personSide } = await scene(browser, baseURL, testInfo.project.name, admin, created);
      // Fora de test-results (limpo a cada execucao) quando o QA pede evidencia.
      const shots = process.env.ELYRA_PRO6_SHOTS ?? testInfo.outputPath("pro6-visual");
      mkdirSync(shots, { recursive: true });
      const widths: Record<string, number[]> = {
        desktop: [1440, 1920],
        tablet: [834],
        mobile: [360, 393, 412],
      };
      for (const [side, path] of [
        [proSide.page, "/pro/agenda"],
        [personSide.page, "/agenda"],
      ] as Array<[Page, string]>) {
        for (const width of widths[testInfo.project.name] ?? [1440]) {
          await side.setViewportSize({ width, height: 900 });
          for (const scheme of ["light", "dark"] as const) {
            await side.emulateMedia({ colorScheme: scheme });
            await gotoHydrated(side, path);
            await expect(side.getByRole("heading", { level: 1 })).toHaveCount(1);
            await expect(side.getByText("Carregando horários livres…")).toHaveCount(0);
            const metrics = await measureDeadSpace(side);
            expect(metrics.horizontalOverflow, `${path} ${width} rolagem lateral`).toBeLessThanOrEqual(0);
            await side.screenshot({
              path: resolve(shots, `${path.replaceAll("/", "_")}-${width}-${scheme}.png`),
              fullPage: true,
            });
          }
          const results = await new AxeBuilder({ page: side }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
          const serious = results.violations.filter((item) => item.impact === "serious" || item.impact === "critical");
          expect(serious, `${path} ${width}: ${serious.map((item) => item.id).join(",")}`).toEqual([]);
        }
      }
      // Teclado: o primeiro horario e alcancavel e alternavel por Enter/Espaco.
      await personSide.page.setViewportSize({ width: 1440, height: 900 });
      await gotoHydrated(personSide.page, "/agenda");
      // Ha horario confirmado: a pagina abre em "Proximas"; os horarios livres ficam em "Agendar".
      await personSide.page.getByRole("tab", { name: "Agendar" }).click();
      const firstSlot = personSide.page.getByTestId("agenda-slots").getByRole("button").first();
      await firstSlot.focus();
      await personSide.page.keyboard.press("Enter");
      await expect(firstSlot).toHaveAttribute("aria-pressed", "true");
      await personSide.page.keyboard.press("Space");
      await expect(firstSlot).toHaveAttribute("aria-pressed", "false");
      await proSide.context.close();
      await personSide.context.close();
    } finally {
      await admin.from("appointments").delete().in("client_user_id", created);
      await cleanupAccounts(admin, created);
    }
  });
});
