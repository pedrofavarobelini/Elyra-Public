import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";
import { qaAdmin } from "./professional-fixtures";



const admin = qaAdmin();

async function goalCard(page: Page, title: string) {
  return page.locator("li").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
}

async function goalId(title: string) {
  const { data, error } = await admin.from("goals").select("id").eq("title", title).order("created_at", { ascending: false }).limit(1).single();
  if (error) throw error;
  return data.id;
}

async function progressRows(id: string) {
  const { data, error } = await admin.from("goal_progress_entries").select("id,occurred_on,amount").eq("goal_id", id).order("id");
  if (error) throw error;
  return data;
}

test.describe("Metas - personalizada e edicao sem perder historico", () => {
  test("modelo, personalizada, registrar, editar, pausar, retomar, concluir; axe claro/escuro; sem rolagem lateral", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    const stamp = `${testInfo.project.name}-${Date.now().toString(36)}`;
    const created: string[] = [];
    try {
      await gotoHydrated(page, "/metas");

      // Modelos continuam la; a personalizada e um caminho explicito.
      const templates = page.getByRole("group", { name: "Modelos de meta" });
      for (const name of ["Caminhar", "Momento de pausa", "Ler", "Dormir mais cedo"]) {
        await expect(templates.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
      }

      // 1) Por modelo.
      await templates.getByRole("button", { name: /^Ler/ }).click();
      const titleInput = page.locator("#g-title");
      await titleInput.fill(`Ler ${stamp}`);
      await page.getByRole("button", { name: "Criar meta", exact: true }).click();
      await expect(await goalCard(page, `Ler ${stamp}`)).toBeVisible();
      created.push(await goalId(`Ler ${stamp}`));

      // 2) Personalizada: formulario limpo, foco no titulo.
      await templates.getByRole("button", { name: /Criar meta personalizada/ }).click();
      await expect(titleInput).toBeFocused();
      await expect(titleInput).toHaveValue("");
      const custom = `Beber água ${stamp}`;
      await titleInput.fill(custom);
      await page.getByLabel("Tipo").selectOption("quantitative");
      await page.getByLabel("Recorrência", { exact: true }).selectOption("daily");
      await page.getByLabel("Alvo", { exact: true }).fill("8");
      await page.getByLabel("Unidade").fill("copos");
      await page.getByRole("button", { name: "Criar meta", exact: true }).click();
      const card = await goalCard(page, custom);
      await expect(card).toBeVisible();
      await expect(card).toContainText("Quantitativa · Diária");
      const id = await goalId(custom);
      created.push(id);

      // Registrar progresso (cada toque registra o alvo inteiro numa meta quantitativa).
      await card.getByRole("button", { name: "Registrar" }).click();
      await expect(card.getByTestId(`progress-${id}`)).toHaveText("8 de 8 copos");
      const before = await progressRows(id);
      expect(before).toHaveLength(1);

      // 3) Editar: titulo, alvo e unidade. Tipo/recorrencia explicados, nao editaveis.
      await card.getByRole("button", { name: `Editar ${custom}` }).click();
      const form = page.getByTestId(`goal-edit-${id}`);
      await expect(form.getByTestId("goal-edit-history-note")).toContainText("O que você já registrou continua como está");
      await expect(form.getByRole("combobox")).toHaveCount(0);
      const renamed = `Água ${stamp}`;
      await form.getByLabel("Título").fill(renamed);
      await form.getByLabel(/Alvo por dia/).fill("10");
      await form.getByLabel("Unidade").fill("copos");
      await form.getByRole("button", { name: "Salvar alterações" }).click();
      const edited = await goalCard(page, renamed);
      await expect(edited).toBeVisible();
      // O feito do periodo continua 8: o passado nao foi reinterpretado; so o alvo mudou.
      await expect(edited.getByTestId(`progress-${id}`)).toHaveText("8 de 10 copos");
      expect(await progressRows(id), "eventos de progresso intactos").toEqual(before);
      const { data: row } = await admin.from("goals").select("title,kind,recurrence,target,unit,status").eq("id", id).single();
      expect(row).toEqual({ title: renamed, kind: "quantitative", recurrence: "daily", target: 10, unit: "copos", status: "active" });

      // Validacao: alvo invalido nao salva.
      await edited.getByRole("button", { name: `Editar ${renamed}` }).click();
      await form.getByLabel(/Alvo por dia/).fill("0");
      await form.getByRole("button", { name: "Salvar alterações" }).click();
      // O navegador barra antes (min=1); nada chega ao servidor e o alvo salvo continua 10.
      expect(await form.getByLabel(/Alvo por dia/).evaluate((el) => (el as HTMLInputElement).validity.rangeUnderflow)).toBe(true);
      await form.getByRole("button", { name: "Cancelar" }).click();
      expect((await admin.from("goals").select("target").eq("id", id).single()).data?.target).toBe(10);

      // "Outra configuracao" preenche uma meta NOVA; a atual fica intacta.
      await edited.getByRole("button", { name: `Editar ${renamed}` }).click();
      await form.getByRole("button", { name: "Nova meta com outro tipo ou recorrência" }).click();
      await expect(titleInput).toHaveValue(renamed);
      await expect(titleInput).toBeFocused();

      // 4) Pausar / retomar (acoes existentes, sem duplicar).
      await edited.getByRole("button", { name: "Pausar" }).click();
      await expect(edited).toContainText("Pausada");
      await expect(edited.getByRole("button", { name: "Registrar" })).toBeDisabled();
      await edited.getByRole("button", { name: "Retomar" }).click();
      await expect(edited.getByRole("button", { name: "Pausar" })).toBeVisible();

      // 5) Concluir pela edicao: vira registro; sem editar depois.
      await edited.getByRole("button", { name: `Editar ${renamed}` }).click();
      await form.getByRole("button", { name: "Marcar como concluída" }).click();
      await expect(edited).toContainText("Concluída");
      await expect(edited.getByRole("button", { name: /^Editar/ })).toHaveCount(0);
      expect(await progressRows(id), "concluir nao apaga progresso").toEqual(before);

      // Servidor recusa edicao de meta concluida (nao so a UI).
      const refused = await page.request.put("/api/goals", { data: { id, title: "x", target: 1, unit: null } });
      expect(refused.status()).toBe(400);

      await page.screenshot({ path: `test-results/goals/${testInfo.project.name}-metas.png`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "sem rolagem lateral").toBeLessThanOrEqual(0);
      for (const theme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme: theme });
        const axe = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
        expect(axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => v.id), theme).toEqual([]);
      }
    } finally {
      if (created.length) await admin.from("goals").delete().in("id", created);
    }
  });
});
