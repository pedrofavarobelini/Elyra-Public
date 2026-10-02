import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser } from "../qa-identity";
import { gotoHydrated } from "./hydrated";

const MAILPIT = "http://127.0.0.1:54384";

// O link e a sessão de recovery são credenciais efêmeras e não podem ir para
// trace, vídeo ou screenshot persistidos pelo runner.
test.use({ trace: "off", video: "off", screenshot: "off" });

async function recoveryLink(email: string): Promise<string> {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const response = await fetch(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    if (!response.ok) throw new Error("Capturador local indisponível.");
    const box = await response.json();
    const message = (box.messages ?? []).find(
      (item: { To?: { Address?: string }[] }) =>
        item.To?.[0]?.Address?.toLowerCase() === email.toLowerCase(),
    );
    if (!message) continue;
    const full = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
    const body = `${full.Text ?? ""} ${full.HTML ?? ""}`;
    const match = body.match(/https?:\/\/[^"'\s<>]*\/auth\/v1\/verify\?[^"'\s<>]+/);
    if (!match) continue;
    const link = new URL(match[0].replace(/&amp;/g, "&"));
    if (
      link.origin !== "http://127.0.0.1:54381" ||
      link.pathname !== "/auth/v1/verify" ||
      link.searchParams.get("type") !== "recovery"
    ) {
      throw new Error("Link de recovery fora do contrato QA local.");
    }
    return link.href;
  }
  throw new Error("E-mail de recovery não chegou ao capturador local.");
}

test("recovery real troca a senha, encerra a sessão e recusa reuso do link", async ({
  browser,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Contrato de recovery independe do viewport.");
  if (!baseURL) throw new Error("baseURL ausente.");
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("QA local de recovery não configurado.");
  const target = new URL(url);
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.port !== '54381') {
    throw new Error("Recovery QA recusado fora do Supabase local isolado.");
  }
  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  const email = `stage28r-recovery-${run}@elyra.invalid`;
  const oldPassword = `Qa${crypto.randomUUID().replaceAll("-", "")}8`;
  const newPassword = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  const userId = await createConfirmedQaUser(admin, {
    email,
    password: oldPassword,
    displayName: "Pessoa Recovery S3",
  });
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();

  try {
    await gotoHydrated(page, `${baseURL}/recuperar-senha`);
    await page.getByLabel("E-mail").fill(email);
    await page.getByRole("button", { name: "Enviar link de recuperação" }).click();
    await expect(page.getByRole("status")).toContainText("Se houver uma conta");

    const link = await recoveryLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/redefinir-senha$/);
    await page.getByLabel("Nova senha", { exact: true }).fill(newPassword);
    await page.getByLabel("Repita a nova senha").fill(newPassword);
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.getByRole("status")).toContainText("Senha redefinida");
    expect((await context.cookies()).filter((cookie) => cookie.name.includes("auth-token"))).toHaveLength(0);

    await page.getByRole("link", { name: "Entrar com a nova senha" }).click();
    await page.getByLabel("E-mail").fill(email);
    await page.getByLabel("Senha", { exact: true }).fill(oldPassword);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.locator("form [role=alert]")).toContainText("E-mail ou senha inválidos");

    await page.getByLabel("Senha", { exact: true }).fill(newPassword);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const reuseContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const reusePage = await reuseContext.newPage();
    try {
      await reusePage.goto(link);
      await expect(reusePage).toHaveURL((value) =>
        value.pathname === "/recuperar-senha" &&
        value.searchParams.get("erro") === "link_invalido",
      );
      await expect(reusePage.locator("main [role=alert]")).toBeVisible();
    } finally {
      await reuseContext.close();
    }
  } finally {
    await context.close();
    await admin.from("audit_logs").delete().eq("actor_user_id", userId);
    assertNotQaCanonicalAccount(email);
    await admin.auth.admin.deleteUser(userId);
  }
});
