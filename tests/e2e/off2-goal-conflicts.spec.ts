import { createClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";
import { axeBothSchemes } from "./offline-a11y";
import { cutNetwork, outboxSize, restoreNetwork, waitOfflineReady } from "./offline-network";

/**
 * OFF-2 (L-408): metas sem last-write-wins silencioso.
 *
 * 1. Dois aparelhos online: A salva; B, com a versao antiga, recebe "Esta meta
 *    foi alterada em outro dispositivo", os campos recarregam com a versao de A
 *    e o banco fica com A. Salvar de novo parte da base nova.
 * 2. Meta criada offline, editada e pausada offline: ao voltar, 1 meta, com o
 *    titulo editado e pausada — a criacao nao some (bug de coalescencia) e nada
 *    duplica.
 * 3. Edicao offline antiga x edicao online: ao reconectar, conflito na central
 *    de sincronizacao, sem "Usar a minha versao"; "Carregar a versao mais
 *    recente" deixa a do outro aparelho.
 */

test.describe.configure({ mode: "serial" });

let admin: ReturnType<typeof createClient<Database>>;
let email = "";
let password = "";
let userId = "";

async function device(browser: Browser, baseURL: string, project: Record<string, unknown>) {
  const context = await browser.newContext({ ...project, baseURL, storageState: { cookies: [], origins: [] }, serviceWorkers: "allow" });
  const page = await context.newPage();
  await loginThroughUi(page, baseURL, { email, password });
  return { context, page };
}

async function createGoal(title: string) {
  const { data, error } = await admin
    .from("goals")
    .insert({ user_id: userId, title, kind: "frequency", recurrence: "daily", target: 1, status: "active" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

const card = (page: Page, title: string) => page.locator("li").filter({ has: page.getByRole("heading", { name: title, exact: true }) });

test.beforeAll(async ({}, testInfo) => {
  process.loadEnvFile?.(".env.local");
  admin = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  email = `stage25-offline-${testInfo.project.name}-off2${run}@elyra.invalid`;
  password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa OFF2" });
});

test.afterAll(async () => {
  if (!userId) return;
  await admin.from("goals").delete().eq("user_id", userId);
  await admin.from("audit_logs").delete().eq("actor_user_id", userId);
  assertNotQaCanonicalAccount(email);
  await admin.auth.admin.deleteUser(userId);
});

test("dois aparelhos online: 409 visivel, versao mais recente carregada, banco nunca sobrescrito", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const id = await createGoal("Beber água");
  const a = await device(browser, baseURL!, testInfo.project.use);
  const b = await device(browser, baseURL!, testInfo.project.use);
  try {
    await gotoHydrated(a.page, "/metas");
    await gotoHydrated(b.page, "/metas");
    // B abre a edicao com a versao antiga.
    await card(b.page, "Beber água").getByRole("button", { name: "Editar Beber água" }).click();
    const formB = b.page.getByTestId(`goal-edit-${id}`);

    // A salva primeiro.
    await card(a.page, "Beber água").getByRole("button", { name: "Editar Beber água" }).click();
    const formA = a.page.getByTestId(`goal-edit-${id}`);
    await formA.getByLabel("Título").fill("Beber água — 8 copos");
    await formA.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(card(a.page, "Beber água — 8 copos")).toBeVisible();

    // B tenta salvar a partir da versao antiga.
    await formB.getByLabel("Título").fill("Água toda manhã");
    await formB.getByRole("button", { name: "Salvar alterações" }).click();
    const conflict = formB.getByTestId("goal-edit-conflict");
    await expect(conflict).toContainText("Esta meta foi alterada em outro dispositivo.");
    await expect(conflict).toContainText("Sua alteração não foi salva: “Água toda manhã”");
    await expect(formB.getByLabel("Título")).toHaveValue("Beber água — 8 copos");
    await axeBothSchemes(b.page, "conflito de edicao (formulario)");
    expect((await admin.from("goals").select("title").eq("id", id).single()).data?.title).toBe("Beber água — 8 copos");

    // Revisar e salvar de novo parte da base nova.
    await formB.getByLabel("Título").fill("Beber água — 10 copos");
    await formB.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(card(b.page, "Beber água — 10 copos")).toBeVisible();
    expect((await admin.from("goals").select("title").eq("id", id).single()).data?.title).toBe("Beber água — 10 copos");

    // Concluida em outro aparelho: B nao consegue editar por cima.
    await admin.from("goals").update({ status: "completed" }).eq("id", id);
    await card(a.page, "Beber água — 8 copos").getByRole("button", { name: /^Editar/ }).click();
    const formA2 = a.page.getByTestId(`goal-edit-${id}`);
    await formA2.getByLabel("Título").fill("Por cima");
    await formA2.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(formA2.getByTestId("goal-edit-conflict")).toContainText("concluída ou cancelada em outro dispositivo");
    await expect(formA2.getByRole("button", { name: "Salvar alterações" })).toBeDisabled();
    expect((await admin.from("goals").select("title,status").eq("id", id).single()).data).toEqual({ title: "Beber água — 10 copos", status: "completed" });
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

test("criada, editada e pausada offline: ao voltar, uma meta com o titulo editado e pausada", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const run = crypto.randomUUID().slice(0, 6);
  const { context, page } = await device(browser, baseURL!, testInfo.project.use);
  try {
    await gotoHydrated(page, "/metas");
    await waitOfflineReady(page);
    await cutNetwork(context);
    await page.reload().catch(() => undefined);
    await expect(page).toHaveURL(/\/offline\?de=%2Fmetas/);
    const title = `Ler ${run}`;
    await page.locator("#g-title").fill(title);
    await page.getByRole("button", { name: "Criar meta", exact: true }).click();
    await expect(card(page, title)).toBeVisible();
    await card(page, title).getByRole("button", { name: `Editar ${title}` }).click();
    const form = page.locator("form[data-testid^='goal-edit-']");
    await form.getByLabel("Título").fill(`${title} — 10 páginas`);
    await form.getByRole("button", { name: "Salvar alterações" }).click();
    const edited = card(page, `${title} — 10 páginas`);
    await expect(edited).toBeVisible();
    await edited.getByRole("button", { name: "Pausar" }).click();
    await expect(edited).toContainText("Pausada");
    expect(await outboxSize(page)).toBe(3);
    expect((await admin.from("goals").select("id").eq("user_id", userId).like("title", `${title}%`)).data).toHaveLength(0);

    await restoreNetwork(context);
    await expect.poll(() => outboxSize(page), { timeout: 45_000 }).toBe(0);
    const { data } = await admin.from("goals").select("title,status").eq("user_id", userId).like("title", `${title}%`);
    expect(data).toEqual([{ title: `${title} — 10 páginas`, status: "paused" }]);
  } finally {
    await context.close();
  }
});

test("edicao offline antiga x edicao online: conflito na central, sem sobrescrever", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  const id = await createGoal("Caminhar");
  const { context, page } = await device(browser, baseURL!, testInfo.project.use);
  try {
    await gotoHydrated(page, "/metas");
    await waitOfflineReady(page);
    await cutNetwork(context);
    await card(page, "Caminhar").getByRole("button", { name: "Editar Caminhar" }).click();
    const form = page.getByTestId(`goal-edit-${id}`);
    await form.getByLabel("Título").fill("Caminhar (deste aparelho)");
    await form.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(card(page, "Caminhar (deste aparelho)")).toBeVisible();
    await axeBothSchemes(page, "edicao pendente sem rede");

    // Enquanto isso, outro aparelho muda a meta online.
    await admin.from("goals").update({ title: "Caminhar (outro aparelho)" }).eq("id", id);

    await restoreNetwork(context);
    await page.locator("[data-elyra-sync-status]").click();
    const dialog = page.getByRole("dialog", { name: "Sincronização" });
    await expect(dialog).toContainText("Esta meta foi alterada em outro dispositivo", { timeout: 45_000 });
    await expect(dialog).toContainText("Edição de meta: Caminhar (deste aparelho)");
    await expect(dialog.getByRole("button", { name: "Usar a minha versão" })).toHaveCount(0);
    await axeBothSchemes(page, "conflito na central de sincronizacao");
    expect((await admin.from("goals").select("title").eq("id", id).single()).data?.title).toBe("Caminhar (outro aparelho)");

    await dialog.getByRole("button", { name: "Carregar a versão mais recente" }).click();
    await expect.poll(() => outboxSize(page), { timeout: 20_000 }).toBe(0);
    await page.keyboard.press("Escape");
    await expect(card(page, "Caminhar (outro aparelho)")).toBeVisible();
    expect((await admin.from("goals").select("title").eq("id", id).single()).data?.title).toBe("Caminhar (outro aparelho)");
  } finally {
    await context.close();
  }
});
