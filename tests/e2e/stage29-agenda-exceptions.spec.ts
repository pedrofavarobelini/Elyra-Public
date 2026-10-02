import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import { addCivilDays, civilWeekStart } from "@/lib/scheduling/calendar";
import { localDayKey } from "@/lib/scheduling/format";
import { cleanupAccounts, createPersonalAccount, createProfessionalAccount, qaAdmin, signIn } from "./professional-fixtures";
import { gotoHydrated } from "./hydrated";

const TZ = "America/Sao_Paulo";
async function accessibility(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
async function chooseWeek(page: Page, date: string) {
  await page.getByLabel("Ir para uma data").fill(date);
  await expect(page.getByTestId("week-day-" + date)).toBeAttached();
}
async function save(page: Page) {
  await page.getByRole("button", { name: "Salvar disponibilidade da semana" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Disponibilidade da semana salva." })).toBeVisible();
}
test.describe("Stage 29 / ADR-0035 - publicacao finita e conflitos reais", () => {
  test("publicar, recarregar, editar, remover, bloquear e preservar confirmado ate cancelamento explicito", async ({ browser, baseURL }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente");
    test.setTimeout(240_000);
    const admin = qaAdmin();
    const created: string[] = [];
    const contexts: BrowserContext[] = [];
    const width = testInfo.project.name === "mobile" ? 390 : testInfo.project.name === "tablet" ? 834 : 1440;
    try {
      const pro = await createProfessionalAccount(admin, testInfo.project.name, "Profissional Semana QA");
      const person = await createPersonalAccount(admin, testInfo.project.name, "Pessoa Semana QA");
      created.push(pro.userId, person.userId);
      const connection = await admin.from("professional_connections").insert({
        client_user_id: person.userId, professional_user_id: pro.userId,
        invited_by_user_id: person.userId, status: "active", accepted_at: new Date().toISOString(),
      }).select("id").single();
      if (connection.error) throw connection.error;
      const proContext = await browser.newContext({ timezoneId: TZ, locale: "pt-BR", viewport: { width, height: 1000 }, storageState: { cookies: [], origins: [] } });
      contexts.push(proContext);
      const q = await proContext.newPage();
      await signIn(q, baseURL, pro);
      await gotoHydrated(q, "/pro/agenda");
      await expect(q.getByRole("tab", { name: "Disponibilidade", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(q.getByTestId("week-publication-status")).toHaveText("Não publicada");
      await q.getByRole("button", { name: "Próxima semana" }).click();
      const monday = addCivilDays(civilWeekStart(localDayKey(new Date().toISOString(), TZ)), 7);
      const wednesday = addCivilDays(monday, 2);
      const mon = q.getByTestId("week-day-" + monday);
      const wed = q.getByTestId("week-day-" + wednesday);
      await expect(mon).toBeVisible();
      await mon.getByLabel("Disponível", { exact: true }).check();
      await mon.getByLabel("Início", { exact: true }).fill("09:00");
      await mon.getByLabel("Fim", { exact: true }).fill("12:00");
      await mon.getByRole("button", { name: "Adicionar horário" }).click();
      await mon.getByLabel("Início", { exact: true }).last().fill("14:00");
      await mon.getByLabel("Fim", { exact: true }).last().fill("17:00");
      await mon.getByLabel("Modalidade", { exact: true }).last().selectOption("in_person");
      await wed.getByLabel("Disponível", { exact: true }).check();
      await wed.getByLabel("Início", { exact: true }).fill("10:00");
      await wed.getByLabel("Fim", { exact: true }).fill("16:00");
      await expect(q.getByTestId("week-publication-status")).toHaveText("Alterada · não salva");
      await q.getByRole("button", { name: "Próxima semana" }).click();
      const unsaved = q.getByRole("dialog", { name: "Alterações não salvas" });
      await expect(unsaved).toBeVisible();
      await unsaved.getByRole("button", { name: "Continuar editando" }).click();
      await accessibility(q);
      await save(q);
      await q.reload();
      await q.getByRole("tab", { name: "Disponibilidade", exact: true }).click();
      await chooseWeek(q, monday);
      await expect(mon.getByTestId("week-interval")).toHaveCount(2);
      await expect(mon.getByLabel("Início", { exact: true }).first()).toHaveValue("09:00");
      await expect(mon.getByLabel("Fim", { exact: true }).last()).toHaveValue("17:00");
      await expect(wed.getByLabel("Fim", { exact: true })).toHaveValue("16:00");
      await expect(q.getByTestId("week-publication-status")).toHaveText("Publicada");

      // Discard must restore persisted inputs even when the destination is in the same week.
      await mon.getByLabel("Início", { exact: true }).first().fill("10:00");
      await q.getByLabel("Ir para uma data").fill(wednesday);
      await unsaved.getByRole("button", { name: "Descartar e mudar de semana" }).click();
      await expect(mon.getByLabel("Início", { exact: true }).first()).toHaveValue("09:00");
      await expect(q.getByTestId("week-publication-status")).toHaveText("Publicada");

      const personContext = await browser.newContext({ timezoneId: TZ, locale: "pt-BR", viewport: { width, height: 1000 }, storageState: { cookies: [], origins: [] } });
      contexts.push(personContext);
      const p = await personContext.newPage();
      await signIn(p, baseURL, person);
      await gotoHydrated(p, "/agenda");
      await expect(p.getByText("Nenhum horário livre neste período")).toBeVisible();
      await p.getByRole("button", { name: "Próxima semana" }).click();
      const slots = p.getByTestId("agenda-slots");
      await expect(slots.getByRole("button")).toHaveCount(24);
      await accessibility(p);
      await slots.getByRole("button").first().click();
      await p.getByRole("button", { name: "Pedir este horário" }).click();
      await expect(p.getByRole("status").filter({ hasText: "Pedido enviado" })).toBeVisible();
      const appts = await admin.from("appointments").select("id,status,starts_at").eq("client_user_id", person.userId);
      expect(appts.data).toHaveLength(1);
      const appointment = appts.data![0]!;
      expect(appointment.status).toBe("requested");

      await gotoHydrated(q, "/pro/agenda");
      await chooseWeek(q, monday);
      await q.getByRole("tab", { name: "Agenda", exact: true }).click();
      await expect(q.getByTestId("agenda-week").getByText(person.displayName)).toBeVisible();
      await q.getByRole("button", { name: "Confirmar", exact: true }).click();
      await expect(q.getByRole("status").filter({ hasText: "Horário confirmado" })).toBeVisible();
      await q.getByRole("tab", { name: "Disponibilidade", exact: true }).click();
      // Edit the afternoon interval, remove the booked morning availability.
      await mon.getByLabel("Início", { exact: true }).last().fill("14:30");
      await mon.getByRole("button", { name: "Remover intervalo" }).first().click();
      await wed.getByLabel("Bloquear dia", { exact: true }).check();
      await save(q);
      const conflicts = q.getByTestId("availability-conflicts");
      await expect(conflicts).toContainText("1 horário(s) confirmado(s)");
      await expect(conflicts).toContainText("não cancela");
      expect((await admin.from("appointments").select("status").eq("id", appointment.id).single()).data?.status).toBe("confirmed");
      await accessibility(q);
      await q.reload();
      await q.getByRole("tab", { name: "Disponibilidade", exact: true }).click();
      await chooseWeek(q, monday);
      await expect(mon.getByTestId("week-interval")).toHaveCount(1);
      await expect(mon.getByLabel("Início", { exact: true })).toHaveValue("14:30");
      await expect(wed.getByLabel("Bloquear dia", { exact: true })).toBeChecked();
      await expect(conflicts.getByRole("button", { name: "Ver atendimento" })).toBeVisible();

      await gotoHydrated(p, "/agenda");
      await p.getByRole("tab", { name: "Agendar", exact: true }).click();
      await p.getByRole("button", { name: "Próxima semana" }).click();
      await expect(slots.getByRole("button")).toHaveCount(5);
      await expect(slots.getByRole("button").first()).toContainText("14:30");
      await p.getByRole("tab", { name: /Próximas/ }).click();
      await expect(p.getByTestId("agenda-mine").getByText("Confirmado", { exact: true })).toBeVisible();

      await conflicts.getByRole("button", { name: "Cancelar atendimento…" }).click();
      const dialog = q.getByRole("dialog", { name: "Cancelar horário" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Mudança de agenda").check();
      // Before the explicit action, the database is still confirmed.
      expect((await admin.from("appointments").select("status").eq("id", appointment.id).single()).data?.status).toBe("confirmed");
      await dialog.getByRole("button", { name: "Cancelar horário", exact: true }).click();
      await expect(q.getByRole("status").filter({ hasText: "Horário cancelado" })).toBeVisible();
      expect((await admin.from("appointments").select("status,cancel_reason").eq("id", appointment.id).single()).data).toMatchObject({ status: "cancelled", cancel_reason: "schedule_change" });

      // Empty publication retains the selected IANA zone even after a full reload.
      await mon.getByLabel("Disponível", { exact: true }).uncheck();
      await wed.getByLabel("Disponível", { exact: true }).uncheck();
      await wed.getByLabel("Bloquear dia", { exact: true }).uncheck();
      await q.getByLabel("Fuso da agenda", { exact: true }).selectOption("America/New_York");
      await save(q);
      await q.reload();
      await q.getByRole("tab", { name: "Disponibilidade", exact: true }).click();
      await expect(q.getByLabel("Fuso da agenda", { exact: true })).toHaveValue("America/New_York");
      await chooseWeek(q, monday);
      await expect(q.getByTestId("week-publication-status")).toHaveText("Publicada");
      await expect(q.getByTestId("week-interval")).toHaveCount(0);
    } finally {
      for (const context of contexts) await context.close();
      await admin.from("appointments").delete().in("client_user_id", created);
      await cleanupAccounts(admin, created);
    }
  });
});
