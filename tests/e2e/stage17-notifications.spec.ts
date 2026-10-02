import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { gotoHydrated } from "./hydrated";

interface QaIdentity {
  project: string;
  userId: string;
}

test("notificacoes in-app cobrem vazio, entrega, leitura, erro e exportacao", async ({
  page,
}, testInfo) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Playwright QA local nao configurado.");
  }

  const identities = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test-results", ".auth", "identity.json"),
      "utf8",
    ),
  ) as QaIdentity[];
  const identity = identities.find(
    (candidate) => candidate.project === testInfo.project.name,
  );
  if (!identity) throw new Error("Identidade QA do viewport nao encontrada.");

  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await admin.from("notifications").delete().eq("user_id", identity.userId);
  await admin
    .from("user_preferences")
    .update({ checkin_reminder: false, goal_reminder: false })
    .eq("user_id", identity.userId);

  await gotoHydrated(page, "/dashboard");

  await page.route("**/api/notifications", async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    await route.continue();
  });
  await page.getByRole("button", { name: "Notificações" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Carregando notificações...",
  );
  await expect(page.getByText("Nenhuma notificação por enquanto.")).toBeVisible();
  await page.unroute("**/api/notifications");
  await page.getByRole("button", { name: "Fechar" }).click();

  await admin
    .from("user_preferences")
    .update({ checkin_reminder: true, goal_reminder: true })
    .eq("user_id", identity.userId);
  await gotoHydrated(page, "/dashboard");

  const unreadBell = page.getByRole("button", {
    name: "Notificações: 1 não lidas",
  });
  await expect(unreadBell).toBeVisible();
  await unreadBell.click();
  await expect(page.getByText("Lembrete de metas")).toBeVisible();
  await expect(page.getByText("Revise o andamento das suas metas ativas.")).toBeVisible();

  await page.getByRole("button", { name: "Marcar como lida" }).click();
  await expect(page.getByText("Lida", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByRole("button", { name: "Notificações" })).toBeVisible();

  await page.route("**/api/notifications", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "synthetic_unavailable" }),
    });
  });
  await page.getByRole("button", { name: "Notificações" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Não foi possível carregar as notificações.",
  );
  await page.unroute("**/api/notifications");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText("Lida", { exact: true })).toBeVisible();

  const exported = await page.evaluate(async () => {
    const response = await fetch("/api/me/export", { cache: "no-store" });
    return response.json();
  });
  expect(exported.subjectId).toBe(identity.userId);
  expect(exported.data.notifications).toEqual([
    expect.objectContaining({ kind: "goal_reminder", read_at: expect.any(String) }),
  ]);
  expect(exported.data.notifications[0]).not.toHaveProperty("event_key");
});
