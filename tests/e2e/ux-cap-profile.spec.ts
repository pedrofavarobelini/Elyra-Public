import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { resolve } from "node:path";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

let admin: SupabaseClient<Database>;
let context: BrowserContext;
let page: Page;
let userId = "";
let email = "";
const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);

test.beforeAll(async ({ browser, baseURL }, testInfo) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) throw new Error("QA local de perfil não configurado.");
  admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  email = `ux-cap-profile-${testInfo.project.name}-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  context = await browser.newContext({
    ...testInfo.project.use,
    baseURL,
    storageState: { cookies: [], origins: [] },
  });
  page = await context.newPage();
  userId = await createConfirmedQaUser(admin, {
    email,
    password,
    displayName: "Pessoa Foto",
  });
  await loginThroughUi(page, baseURL, { email, password });
});

test.afterAll(async () => {
  await context?.close();
  if (!userId) return;
  const listed = await admin.storage.from("elyra-private").list(`${userId}/profile`, { limit: 100 });
  const paths = (listed.data ?? []).map((item) => `${userId}/profile/${item.name}`);
  if (paths.length) await admin.storage.from("elyra-private").remove(paths);
  await admin.from("audit_logs").delete().eq("actor_user_id", userId);
  assertNotQaCanonicalAccount(email);
  await admin.auth.admin.deleteUser(userId);
});

test("seleciona, confirma, substitui e remove uma foto privada", async () => {
  await gotoHydrated(page, "/perfil");
  const input = page.getByLabel("Selecionar foto de perfil");
  await input.setInputFiles(resolve("public/placeholder/icon-192.png"));
  await expect(page.getByRole("button", { name: "Confirmar foto" })).toBeVisible();
  await page.getByRole("button", { name: "Confirmar foto" }).click();
  await expect(page.getByText("Foto atualizada.")).toBeVisible();

  const first = await admin.from("profiles").select("avatar_path").eq("user_id", userId).single();
  expect(first.data?.avatar_path).toMatch(new RegExp(`^${userId}/profile/[0-9a-f-]{36}\\.webp$`));
  const download = await page.request.get("/api/me/profile/photo");
  expect(download.status()).toBe(200);
  expect(download.headers()["content-type"]).toContain("image/webp");
  expect(download.headers()["cache-control"]).toContain("private");

  await page.reload();
  await expect(page.getByAltText("Foto de perfil")).toBeVisible();
  await input.setInputFiles(resolve("public/placeholder/icon-512.png"));
  await page.getByRole("button", { name: "Confirmar foto" }).click();
  await expect(page.getByText("Foto atualizada.")).toBeVisible();
  const second = await admin.from("profiles").select("avatar_path").eq("user_id", userId).single();
  expect(second.data?.avatar_path).not.toBe(first.data?.avatar_path);
  const objects = await admin.storage.from("elyra-private").list(`${userId}/profile`, { limit: 100 });
  expect(objects.data).toHaveLength(1);

  await input.setInputFiles({
    name: "falsa.png",
    mimeType: "image/png",
    buffer: Buffer.from("<svg onload=alert(1)></svg>"),
  });
  await expect(page.getByText("Use uma imagem JPEG, PNG ou WebP verdadeira.")).toBeVisible();

  await page.getByRole("button", { name: "Remover" }).click();
  await expect(page.getByText(/Foto removida/)).toBeVisible();
  const removed = await admin.from("profiles").select("avatar_path").eq("user_id", userId).single();
  expect(removed.data?.avatar_path).toBeNull();
  const remaining = await admin.storage.from("elyra-private").list(`${userId}/profile`, { limit: 100 });
  expect(remaining.data).toHaveLength(0);
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
});
