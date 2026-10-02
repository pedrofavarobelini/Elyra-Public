import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";

test("Stage 07 persiste o ciclo com opt-in, reload e exclusao separada", async ({
  browser,
  baseURL,
}, testInfo) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) {
    throw new Error("QA local Stage 07 nao configurado.");
  }
  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  const email = `stage07-e2e-${testInfo.project.name}-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  let userId = "";

  try {
    userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa Stage 07" });
    await loginThroughUi(page, baseURL, { email, password });

    await gotoHydrated(page, `${baseURL}/ciclo`);
    await expect(
      page.getByRole("heading", { name: "Acompanhe seu ciclo", level: 1 }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ativar acompanhamento" }).click();
    await expect(
      page.getByRole("heading", { name: "Ciclo", level: 1 }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Registrar dados" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Moderado" }).click();
    await dialog.getByLabel("Criar sintoma próprio").fill("Tontura persistente");
    await dialog.getByRole("button", { name: "Adicionar sintoma" }).click();
    await expect(
      dialog.getByRole("button", { name: /Tontura persistente/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await dialog.getByLabel("Observação").fill("Registro persistente Stage 07.");
    await dialog.getByRole("button", { name: "Salvar registro" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("Registro persistente Stage 07.")).toBeVisible();

    await page.reload();
    await expect(page.getByText("Registro persistente Stage 07.")).toBeVisible();
    await expect(page.getByText("Tontura persistente")).toBeVisible();

    const { count: oneRecord } = await admin
      .from("cycle_daily_records")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    const { count: oneMaterializedPeriod } = await admin
      .from("cycle_periods")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(oneRecord).toBe(1);
    expect(oneMaterializedPeriod).toBe(1);

    await gotoHydrated(page, `${baseURL}/configuracoes`);
    const cycleSwitch = page.getByRole("switch", {
      name: "Acompanhamento do ciclo",
    });
    await cycleSwitch.click();
    await expect(cycleSwitch).toHaveAttribute("aria-checked", "false");
    const { count: preservedWhileOff } = await admin
      .from("cycle_daily_records")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    expect(preservedWhileOff).toBe(1);

    await cycleSwitch.click();
    await page.getByRole("link", { name: "Abrir o ciclo" }).click();
    await expect(page.getByText("Registro persistente Stage 07.")).toBeVisible();

    await gotoHydrated(page, `${baseURL}/configuracoes`);
    await page.getByRole("button", { name: "Excluir dados do ciclo" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Excluir em definitivo" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Excluir dados do ciclo" }),
    ).toHaveCount(0);

    const { count: recordsAfterDelete } = await admin
      .from("cycle_daily_records")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    const { count: periodsAfterDelete } = await admin
      .from("cycle_periods")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);
    const { count: customAfterDelete } = await admin
      .from("cycle_symptoms")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", userId);
    const { count: consentHistory } = await admin
      .from("consent_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("purpose", "cycle_tracking");
    expect(recordsAfterDelete).toBe(0);
    expect(periodsAfterDelete).toBe(0);
    expect(customAfterDelete).toBe(0);
    expect(consentHistory).toBe(3);
  } finally {
    if (!userId) {
      const { data } = await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
      userId = data.users.find((user) => user.email === email)?.id ?? "";
    }
    if (userId) {
      await admin.from("audit_logs").delete().eq("actor_user_id", userId);
      // A conta QA canonica sobrevive a qualquer cleanup, inclusive por engano.
      assertNotQaCanonicalAccount(email);
      await admin.auth.admin.deleteUser(userId);
    }
    await context.close();
  }
});
