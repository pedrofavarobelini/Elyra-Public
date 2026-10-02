import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { createClient } from "@supabase/supabase-js";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";

test("Stage 05 persiste check-in, fator e sono e recusa futuro", async ({
  browser,
  baseURL,
}) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Playwright QA local nao configurado.");

  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  const email = `stage05-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  let userId = "";

  try {
    userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa Stage 05" });
    await loginThroughUi(page, baseURL ?? "", { email, password });

    const future = await page.request.post(`${baseURL}/api/emotional/checkins`, {
      data: {
        occurredAt: new Date(Date.now() + 60_000).toISOString(),
        mood: 7,
        perceivedAnxiety: null,
        energy: null,
        primaryFeeling: "tranquilo",
        factorIds: [],
        note: null,
      },
    });
    expect(future.status()).toBe(400);
    const futureBody = (await future.json()) as { error: string };
    expect(futureBody.error).toContain("futuro");

    await gotoHydrated(page, `${baseURL}/meu-humor`);
    await page.getByText("Ansioso", { exact: true }).click();
    await expect(page.getByRole("radio", { name: "Ansioso" })).toBeChecked();
    await page.getByTestId("energy-toggle").click();
    await page.getByLabel("Criar fator próprio").fill("Fator persistido");
    await page.getByRole("button", { name: "Adicionar fator" }).click();
    const customFactor = page.getByRole("button", { name: /Fator persistido/ });
    await expect(customFactor).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Salvar check-in" }).click();
    await expect(page.getByText("Registro salvo")).toBeVisible();

    await page.reload();
    await page.getByRole("link", { name: "Ver histórico" }).click();

    const checkinRow = page.getByRole("table", { name: "Check-ins emocionais registrados" }).getByRole("row").nth(1);
    await expect(checkinRow).toContainText("Ansioso");
    await expect(checkinRow).toContainText("Sem registro");

    await gotoHydrated(page, `${baseURL}/meu-humor`);
    await page.getByLabel("Horas").fill("6");
    await page.getByLabel("Minutos").fill("30");
    await page.getByRole("button", { name: "Salvar sono" }).click();
    await expect(page.getByText("Registro salvo")).toBeVisible();
    await page.reload();
    await page.getByRole("link", { name: "Ver histórico" }).click();
    await expect(page.getByText("6h 30m")).toBeVisible();
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
