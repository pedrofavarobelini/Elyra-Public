import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";


const MAILPIT = "http://127.0.0.1:54384";
const configured =
  process.env.ELYRA_E2E_STAGE29C === "1" &&
  process.env.ELYRA_RECOVERY_DELIVERY === "elyra" &&
  process.env.ELYRA_EMAIL_TRANSPORT === "mailpit" &&
  (process.env.ELYRA_DISPATCH_SECRET?.length ?? 0) >= 32;

test.describe.configure({ mode: "serial" });
test.skip(!configured, "execucao dedicada da Stage 29-C (modo elyra + mailpit)");
test.setTimeout(180_000);

let admin: SupabaseClient<Database>;
const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
const users: Array<{ id: string; email: string }> = [];

async function inbox(to: string) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`);
  return ((await r.json()) as { messages?: Array<{ ID: string; Subject: string }> }).messages ?? [];
}
async function waitMail(to: string) {
  await expect.poll(async () => (await inbox(to)).length, { timeout: 15_000 }).toBeGreaterThan(0);
  const [first] = await inbox(to);
  return (await (await fetch(`${MAILPIT}/api/v1/message/${first!.ID}`)).json()) as {
    Subject: string; Text: string; HTML: string; From: { Address: string };
  };
}
async function dispatch(baseURL: string) {
  const r = await fetch(`${baseURL}/api/internal/notifications/dispatch`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.ELYRA_DISPATCH_SECRET}` },
  });
  return { status: r.status, data: ((await r.json()) as { data: Record<string, unknown> }).data };
}

test.beforeAll(async () => {
  process.loadEnvFile?.(".env.local");
  admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

test.afterAll(async () => {
  for (const user of users) {

    assertNotQaCanonicalAccount(user.email);
    await admin.auth.admin.deleteUser(user.id);
  }
});

test("recovery real (modo elyra): resposta neutra, link de uso unico, senha antiga morre", async ({ page, baseURL }) => {
  const email = `stage29c-rec-${run}@elyra.invalid`;
  const ghost = `stage29c-ghost-${run}@elyra.invalid`;
  const old = `Qa${run}Antiga9`;
  const nova = `Qa${run}Nova7x`;
  users.push({ id: await createConfirmedQaUser(admin, { email, password: old, displayName: "Recuperacao 29C" }), email });

  const pedir = async (addr: string) => {
    await gotoHydrated(page, `${baseURL}/recuperar-senha`);
    await page.getByLabel("E-mail").fill(addr);
    await page.locator("form button[type=submit]").click();
    return page.getByRole("status").innerText();
  };
  expect(await pedir(email)).toBe(await pedir(ghost));

  const msg = await waitMail(email);
  expect(msg.Subject).toBe("Redefina sua senha da Elyra");
  expect(msg.From.Address).not.toContain("supabase");
  expect(await inbox(ghost)).toHaveLength(0);
  const link = msg.Text.match(/http:\/\/localhost:\d+\/redefinir-senha\/confirmar\?token_hash=[0-9a-f]+/)?.[0];
  expect(link).toBeTruthy();

  await gotoHydrated(page, link!);
  await page.getByTestId("recovery-confirm").click();
  await page.waitForURL("**/redefinir-senha");
  await page.getByLabel("Nova senha", { exact: true }).fill(nova);
  await page.getByLabel("Repita a nova senha").fill(nova);
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page.getByText("Senha redefinida")).toBeVisible();

  await gotoHydrated(page, link!);
  await page.getByTestId("recovery-confirm").click();
  await page.waitForURL("**/recuperar-senha?erro=link_invalido");

  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false },
  });
  expect((await anon.auth.signInWithPassword({ email, password: old })).error).toBeTruthy();
  expect((await anon.auth.signInWithPassword({ email, password: nova })).error).toBeNull();
});

test("notificacao por e-mail: canal honesto, dispatcher automatico, idempotencia e snooze", async ({ page, baseURL }) => {
  const email = `stage29c-notif-${run}@elyra.invalid`;
  const password = `Qa${run}Notif9x`;
  const id = await createConfirmedQaUser(admin, { email, password, displayName: "Notificacao 29C" });
  users.push({ id, email });
  await admin.from("notification_dispatch_runs").delete().gte("started_at", "1970-01-01");

  await loginThroughUi(page, baseURL!, { email, password });
  const prefs = async (p: Page) => gotoHydrated(p, `${baseURL}/notificacoes`);
  await prefs(page);
  await expect(page.locator("#notif-weekly_digest-email")).toHaveCount(0);
  await expect(page.locator("[id$='-web_push']")).toHaveCount(0);

  expect((await dispatch(baseURL!)).data).toMatchObject({ status: "completed" });
  await prefs(page);
  await expect(page.locator("#notif-weekly_digest-email")).toHaveAttribute("aria-checked", "false");
  await page.locator("#notif-weekly_digest-email").click();
  await expect(page.locator("#notif-weekly_digest-email")).toHaveAttribute("aria-checked", "true");

  expect((await dispatch(baseURL!)).data).toMatchObject({ delivered: 1 });
  const msg = await waitMail(email);
  expect(msg.Subject).toBe("Seu resumo no Elyra está disponível");
  for (const termo of ["diário", "humor", "transcri", "sintoma", "interpreta"]) {
    expect(`${msg.Text} ${msg.HTML}`.toLowerCase()).not.toContain(termo);
  }
  await dispatch(baseURL!);
  expect(await inbox(email)).toHaveLength(1);

  await admin.from("goals").insert({ user_id: id, title: "Meta 29C", kind: "frequency", recurrence: "daily", target: 1, status: "active" });
  await page.locator("#notif-goal_reminder-email").click();
  await expect(page.locator("#notif-goal_reminder-email")).toHaveAttribute("aria-checked", "true");
  const bloco = page.locator("div.py-4").filter({ has: page.locator("#notif-goal_reminder-email") });
  await bloco.getByRole("button", { name: "Por 1 dia" }).click();
  await expect(bloco.getByRole("button", { name: "Voltar a receber" })).toBeVisible();
  expect((await dispatch(baseURL!)).data).toMatchObject({ delivered: 0 });
  expect(await inbox(email)).toHaveLength(1);

  await bloco.getByRole("button", { name: "Voltar a receber" }).click();
  await expect(bloco.getByRole("button", { name: "Voltar a receber" })).toHaveCount(0);
  expect((await dispatch(baseURL!)).data).toMatchObject({ delivered: 1 });
  await expect.poll(async () => (await inbox(email)).length).toBe(2);
});

test("rota interna: sem segredo nao existe", async ({ baseURL }) => {
  for (const authorization of [undefined, "Bearer errado", `Basic ${process.env.ELYRA_DISPATCH_SECRET}`]) {
    const r = await fetch(`${baseURL}/api/internal/notifications/dispatch`, {
      method: "POST",
      headers: authorization ? { authorization } : {},
    });
    expect(r.status).toBe(404);
  }
  expect((await fetch(`${baseURL}/api/internal/notifications/dispatch`)).status).toBeGreaterThanOrEqual(404);
});
