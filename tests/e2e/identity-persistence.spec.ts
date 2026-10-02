import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { createClient } from "@supabase/supabase-js";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";

test("perfil e preferencias persistem apos reload", async ({ browser, baseURL }) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Playwright QA local nao configurado.");

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  const email = `identity-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  let userId = "";

  try {
    /*
      A conta nasce pela API administrativa, e nao pelo formulario.

      Este spec e sobre **persistencia de perfil e preferencia apos reload** — o
      cadastro e apenas a pre-condicao dele. Com `enable_confirmations` ligado, o
      formulario termina em `pending_confirmation` e nunca chega ao dashboard, e
      manter o caminho antigo faria este teste medir o cadastro em vez do que ele
      existe para provar.

      O contrato real do cadastro continua coberto em `signup.spec.ts`.
    */
    userId = await createConfirmedQaUser(admin, {
      email,
      password,
      displayName: "Pessoa Persistencia",
    });
    await loginThroughUi(page, baseURL ?? "", { email, password });

    await gotoHydrated(page, `${baseURL}/perfil`);
    await page.getByLabel("Nome").fill("Nome Persistido");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByRole("status")).toHaveText("Perfil atualizado.");
    await page.reload();
    await expect(page.getByLabel("Nome")).toHaveValue("Nome Persistido");

    await gotoHydrated(page, `${baseURL}/notificacoes`);
    const reminder = page.getByRole("switch", { name: "Lembrete de check-in" });
    await expect(reminder).toHaveAttribute("aria-checked", "true");
    await reminder.click();
    await expect(reminder).toHaveAttribute("aria-checked", "false");
    await page.reload();
    await expect(
      page.getByRole("switch", { name: "Lembrete de check-in" }),
    ).toHaveAttribute("aria-checked", "false");
  } finally {
    if (!userId) {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
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
