import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "../qa-canonical-account";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";

test("Stage 06 persiste Diario e Metas sem duplicar o autosave", async ({
  browser,
  baseURL,
}, testInfo) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) {
    throw new Error("QA local Stage 06 nao configurado.");
  }
  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
  const email = `stage06-e2e-${testInfo.project.name}-${run}@elyra.invalid`;
  const password = `Qa${crypto.randomUUID().replaceAll("-", "")}9`;
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  let userId = "";

  try {
    userId = await createConfirmedQaUser(admin, { email, password, displayName: "Pessoa Stage 06" });
    await loginThroughUi(page, baseURL, { email, password });

    await gotoHydrated(page, `${baseURL}/diario`);
    await page.getByLabel("Título").fill("Entrada persistida");
    await page.getByLabel("Anotação").fill("Primeira versao privada.");
    const autosave = page.getByTestId("autosave-status");
    await expect(autosave).toHaveText("Rascunho salvo", { timeout: 10_000 });
    const draftId = await autosave.getAttribute("data-draft-id");
    expect(draftId).toMatch(/^[0-9a-f-]{36}$/);

    await page.getByLabel("Anotação").fill("Segunda versao privada e persistida.");
    await expect(autosave).toHaveText("Rascunho salvo", { timeout: 10_000 });
    const { count: oneDraft } = await admin
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("id", draftId ?? "");
    expect(oneDraft).toBe(1);

    await page.getByLabel("Criar tag própria").fill("Persistente");
    await page.getByRole("button", { name: "Adicionar tag" }).click();
    await expect(page.getByRole("button", { name: /Persistente/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(autosave).toHaveText("Rascunho salvo", { timeout: 10_000 });
    await page.getByRole("button", { name: "Salvar anotação" }).click();
    await expect(page.getByLabel("Anotação")).toHaveValue("");

    await page.reload();
    await expect(page.getByText("Entrada persistida", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: /Editar entrada: Entrada persistida/i })
      .click();
    await expect(page.getByLabel("Anotação")).toHaveValue(
      "Segunda versao privada e persistida.",
    );
    await page.getByLabel("Anotação").fill("Edicao na mesma entrada.");
    await expect(autosave).toHaveText("Rascunho salvo", { timeout: 10_000 });
    await page.getByRole("button", { name: "Salvar anotação" }).click();
    await page.reload();
    await expect(page.getByText("Edicao na mesma entrada.", { exact: true })).toBeVisible();

    await page
      .getByRole("button", { name: "Mover Entrada persistida para a lixeira" })
      .click();
    await page.getByRole("tab", { name: /Lixeira \(1\)/ }).click();
    await page.getByRole("button", { name: "Restaurar anotação" }).click();
    await expect(page.getByRole("tab", { name: /Anotações \(1\)/ })).toBeVisible();
    await page.getByRole("tab", { name: /Anotações \(1\)/ }).click();
    await page
      .getByRole("button", { name: "Mover Entrada persistida para a lixeira" })
      .click();
    await page.getByRole("tab", { name: /Lixeira \(1\)/ }).click();
    await page.getByRole("button", { name: "Excluir em definitivo" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Excluir em definitivo" })
      .click();
    await expect(page.getByRole("tab", { name: /Lixeira \(0\)/ })).toBeVisible();

    const retainedJournalId = crypto.randomUUID();
    const retained = await page.request.post(`${baseURL}/api/journal/entries`, {
      data: {
        id: retainedJournalId,
        title: "Registro externo a meta",
        content: "Deve permanecer ao excluir a meta.",
        status: "saved",
        tagIds: [],
      },
    });
    expect(retained.status()).toBe(201);

    await gotoHydrated(page, `${baseURL}/metas`);
    await page.getByLabel("Título").fill("Caminhar");
    await page.getByLabel("Tipo").selectOption("frequency");
    await page.getByLabel("Recorrência").selectOption("weekly");
    await page.getByLabel("Alvo").fill("3");
    await page.getByRole("button", { name: "Criar meta", exact: true }).click();
    const goalCard = page.getByRole("listitem").filter({ hasText: "Caminhar" });
    await expect(goalCard).toContainText("0 de 3");
    await goalCard.getByRole("button", { name: "Registrar" }).click();
    await expect(goalCard).toContainText("1 de 3");
    await page.reload();
    const persistedGoal = page.getByRole("listitem").filter({ hasText: "Caminhar" });
    await expect(persistedGoal).toContainText("1 de 3");
    await persistedGoal.getByRole("button", { name: "Pausar" }).click();
    await expect(persistedGoal).toContainText("Pausada");
    await page.reload();
    const pausedGoal = page.getByRole("listitem").filter({ hasText: "Caminhar" });
    await expect(pausedGoal).toContainText("Pausada");
    await pausedGoal.getByRole("button", { name: "Retomar" }).click();
    await expect(pausedGoal).toContainText("Ativa");

    const { data: goalRow, error: goalError } = await admin
      .from("goals")
      .select("id")
      .eq("user_id", userId)
      .eq("title", "Caminhar")
      .single();
    if (goalError) throw goalError;

    const completed = await page.request.patch(`${baseURL}/api/goals`, {
      data: { id: goalRow.id, status: "completed" },
    });
    expect(completed.status()).toBe(200);
    const reopened = await page.request.patch(`${baseURL}/api/goals`, {
      data: { id: goalRow.id, status: "active" },
    });
    expect(reopened.status()).toBe(400);

    const deleted = await page.request.delete(`${baseURL}/api/goals`, {
      data: { id: goalRow.id },
    });
    expect(deleted.status()).toBe(200);
    const { count: progressAfterDelete } = await admin
      .from("goal_progress_entries")
      .select("id", { count: "exact", head: true })
      .eq("goal_id", goalRow.id);
    const { count: retainedJournal } = await admin
      .from("journal_entries")
      .select("id", { count: "exact", head: true })
      .eq("id", retainedJournalId);
    expect(progressAfterDelete).toBe(0);
    expect(retainedJournal).toBe(1);
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
