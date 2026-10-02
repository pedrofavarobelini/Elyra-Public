import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";



const PERSONALIZATION = "/configuracoes/personalizacao";
const ALL_ATTRIBUTES = {
  "data-elyra-theme": "system",
  "data-elyra-accent": "violet",
  "data-elyra-background": "neutral",
  "data-elyra-card-style": "standard",
  "data-elyra-text-size": "default",
  "data-elyra-contrast": "default",
  "data-elyra-motion": "system",
  "data-elyra-density": "comfortable",
  "data-elyra-card-shape": "balanced",
  "data-elyra-navigation": "expanded",
} as const;

async function choose(page: Page, legend: string, name: string) {
  await page
    .locator("fieldset")
    .filter({ has: page.getByText(legend, { exact: true }) })
    .getByRole("button", { name, exact: true })
    .click();
}

async function resetPreferences(page: Page) {
  await gotoHydrated(page, PERSONALIZATION);
  await page.getByRole("button", { name: "Restaurar padrão" }).click();
}

interface HubLayout {
  columns: number;
  maxGapInsideColumn: number;
  stackGap: number;
  columnTops: number[];
  columnBottomDelta: number;
  overflow: number;
}

async function hubLayout(page: Page): Promise<HubLayout> {
  return page.evaluate(() => {
    const columns = [...document.querySelectorAll<HTMLElement>("[data-testid='settings-column']")];
    const rects = columns.map((column) => column.getBoundingClientRect());
    // Colunas lado a lado = mesmo topo; empilhadas = uma coluna logica.
    const sideBySide = rects.length === 2 && Math.abs(rects[0]!.top - rects[1]!.top) < 2;
    let maxGap = 0;
    for (const column of columns) {
      const children = [...column.children].map((child) => child.getBoundingClientRect());
      for (let i = 1; i < children.length; i++) {
        maxGap = Math.max(maxGap, Math.round(children[i]!.top - children[i - 1]!.bottom));
      }
    }
    const lastBottom = (column: HTMLElement) => {
      const last = column.lastElementChild?.getBoundingClientRect();
      return last ? last.bottom : column.getBoundingClientRect().top;
    };
    const stackGap = parseFloat(getComputedStyle(columns[0]!).rowGap) || 0;
    return {
      columns: sideBySide ? 2 : 1,
      maxGapInsideColumn: maxGap,
      stackGap: Math.round(stackGap),
      columnTops: rects.map((rect) => Math.round(rect.top)),
      columnBottomDelta: sideBySide ? Math.round(Math.abs(lastBottom(columns[0]!) - lastBottom(columns[1]!))) : 0,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function evidence(page: Page, name: string, data?: unknown) {
  const dir = process.env.ELYRA_SETTINGS_EVIDENCE_DIR;
  const shot = await page.screenshot({ fullPage: true });
  await test.info().attach(`${name}.png`, { body: shot, contentType: "image/png" });
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.png`), shot);
  if (data !== undefined) writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
}

test.describe("Gate final — Configuracoes como hub", () => {
  test("hub leva a Personalizacao e nao duplica controles visuais", async ({ page }) => {
    await gotoHydrated(page, "/configuracoes");

    const entry = page.getByRole("link", { name: /Aparência, leitura e interface/ });
    await expect(entry).toHaveAttribute("href", PERSONALIZATION);
    await expect(page.getByRole("heading", { name: "Personalização", level: 2 })).toBeVisible();
    await expect(page.getByText("Escolha como a Elyra aparece e se adapta a você.")).toBeVisible();

    // PERSONALIZATION_DUPLICATION = NONE: nenhum preset visual mora no hub.
    for (const name of ["Lavanda Elyra", "Escuro", "Muito maior", "Contraste reforçado", "Compacta", "Só ícones"]) {
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    }

    // O que continua no hub.
    for (const name of [
      /Notificações/,
      /App Lock e inatividade/,
      /O que existe sobre você/,
      /Histórico de consentimento/,
      /Compartilhamento com profissional/,
      /Aprendizado da Elyra/,
      /Exportar meus dados/,
      /Excluir conta/,
    ]) {
      await expect(page.getByRole("link", { name })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /App Lock e inatividade/ })).toHaveAttribute(
      "href",
      "/seguranca#app-lock",
    );

    await entry.click();
    await expect(page.getByRole("heading", { name: "Personalização", level: 1 })).toBeVisible();
  });

  const VIEWPORTS = [
    { name: "desktop-1440", width: 1440, height: 900, columns: 2 },
    { name: "desktop-1920", width: 1920, height: 1080, columns: 2 },
    { name: "zoom-125", width: 1152, height: 720, columns: 1 },
    { name: "zoom-150", width: 960, height: 600, columns: 1 },
    { name: "tablet", width: 834, height: 1112, columns: 1 },
    { name: "mobile", width: 390, height: 844, columns: 1 },
  ] as const;

  for (const viewport of VIEWPORTS) {
    test(`sem espaco morto em ${viewport.name}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== "desktop", "Viewports declarados no proprio teste.");
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const theme of ["light", "dark"] as const) {
        for (const text of ["default", "xlarge"] as const) {
          await gotoHydrated(page, PERSONALIZATION);
          await choose(page, "Tema", theme === "dark" ? "Escuro" : "Claro");
          await choose(page, "Tamanho do texto", text === "xlarge" ? "Muito maior" : "Padrão");
          await gotoHydrated(page, "/configuracoes");

          const layout = await hubLayout(page);
          const label = `${viewport.name}-${theme}-${text}`;
          expect(layout.overflow, label).toBeLessThanOrEqual(1);
          expect(layout.columns, label).toBe(viewport.columns);
          // Dentro de cada coluna so existe o espacamento do sistema.
          expect(layout.maxGapInsideColumn, `${label}: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(
            layout.stackGap + 2,
          );
          if (layout.columns === 2) {
            /*
             * As colunas comecam juntas e terminam proximas: nenhuma faixa morta.
             * Medido no gate: 46 px (1440) e 126 px (1920), sempre no fim de uma
             * coluna. O limite reprova a primeira divisao tentada neste gate
             * (267 px com texto maximo) e qualquer buraco do tamanho de um card.
             */
            expect(layout.columnTops[0], label).toBe(layout.columnTops[1]);
            expect(layout.columnBottomDelta, `${label}: ${JSON.stringify(layout)}`).toBeLessThanOrEqual(160);
          }
          if (text === "default") await evidence(page, `settings-${label}`, layout);
        }
      }
      await resetPreferences(page);
    });
  }
});

test.describe("Gate final — central de Personalizacao", () => {
  test.afterEach(async ({ page }) => {
    await resetPreferences(page);
  });

  test("todas as dimensoes aplicam, persistem e o reset restaura as dez", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Contrato de estado independe do viewport.");
    await gotoHydrated(page, PERSONALIZATION);

    for (const heading of ["Aparência", "Leitura e acessibilidade", "Interface"]) {
      await expect(page.getByRole("heading", { name: heading, level: 2 })).toBeVisible();
    }

    await choose(page, "Tema", "Escuro");
    await choose(page, "Cor de destaque", "Azul tranquilo");
    await choose(page, "Fundo do aplicativo", "Sereno");
    await choose(page, "Aparência dos cards", "Suave");
    await choose(page, "Tamanho do texto", "Maior");
    await choose(page, "Contraste", "Contraste reforçado");
    await choose(page, "Movimento", "Reduzir sempre");
    await choose(page, "Densidade", "Espaçosa");
    await choose(page, "Formato dos cards", "Arredondado");
    await choose(page, "Navegação no computador", "Só ícones");

    const expected = {
      "data-elyra-theme": "dark",
      "data-elyra-accent": "blue",
      "data-elyra-background": "cool",
      "data-elyra-card-style": "soft",
      "data-elyra-text-size": "large",
      "data-elyra-contrast": "reinforced",
      "data-elyra-motion": "reduce",
      "data-elyra-density": "spacious",
      "data-elyra-card-shape": "rounded",
      "data-elyra-navigation": "compact",
    };
    const root = page.locator("html");
    for (const [attribute, value] of Object.entries(expected)) {
      await expect(root).toHaveAttribute(attribute, value);
    }
    await expect(
      page
        .locator("fieldset")
        .filter({ has: page.getByText("Densidade", { exact: true }) })
        .getByRole("button", { name: "Espaçosa" }),
    ).toHaveAttribute("aria-pressed", "true");

    // Persistencia: reload e navegacao para outra rota do app.
    await page.reload();
    for (const [attribute, value] of Object.entries(expected)) {
      await expect(root).toHaveAttribute(attribute, value);
    }
    await gotoHydrated(page, "/dashboard");
    for (const [attribute, value] of Object.entries(expected)) {
      await expect(root).toHaveAttribute(attribute, value);
    }

    await gotoHydrated(page, PERSONALIZATION);
    await page.getByRole("button", { name: "Restaurar padrão" }).click();
    for (const [attribute, value] of Object.entries(ALL_ATTRIBUTES)) {
      await expect(root).toHaveAttribute(attribute, value);
    }
    await page.reload();
    for (const [attribute, value] of Object.entries(ALL_ATTRIBUTES)) {
      await expect(root).toHaveAttribute(attribute, value);
    }
  });

  test("preferencias antigas sobrevivem ao schema novo", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Contrato de estado independe do viewport.");

    // Estado de quem escolheu tema e contraste antes desta versao: so os sete campos antigos.
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__legacy_prefs_seeded")) return;
      sessionStorage.setItem("__legacy_prefs_seeded", "1");
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("elyra.accessibility.v1")) localStorage.removeItem(key);
      }
      localStorage.setItem(
        "elyra.accessibility.v1",
        JSON.stringify({
          textSize: "large",
          contrast: "reinforced",
          motion: "reduce",
          theme: "dark",
          accent: "teal",
          background: "warm",
          cardStyle: "elevated",
        }),
      );
    });
    await gotoHydrated(page, PERSONALIZATION);

    const root = page.locator("html");
    await expect(root).toHaveAttribute("data-elyra-theme", "dark");
    await expect(root).toHaveAttribute("data-elyra-accent", "teal");
    await expect(root).toHaveAttribute("data-elyra-background", "warm");
    await expect(root).toHaveAttribute("data-elyra-card-style", "elevated");
    await expect(root).toHaveAttribute("data-elyra-text-size", "large");
    await expect(root).toHaveAttribute("data-elyra-contrast", "reinforced");
    await expect(root).toHaveAttribute("data-elyra-motion", "reduce");
    await expect(root).toHaveAttribute("data-elyra-density", "comfortable");
    await expect(root).toHaveAttribute("data-elyra-card-shape", "balanced");
    await expect(root).toHaveAttribute("data-elyra-navigation", "expanded");
  });

  test("densidade e formato mudam o card real sem encolher alvo de toque", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Medida de token independe do viewport.");
    await gotoHydrated(page, PERSONALIZATION);

    const measure = () =>
      page.evaluate(() => {
        const card = document.querySelector<HTMLElement>("#personalizacao-interface [data-elyra-card]")!;
        const content = card.querySelector<HTMLElement>(".card-pad:last-child")!;
        const button = card.querySelector<HTMLElement>("button")!;
        return {
          radius: parseFloat(getComputedStyle(card).borderTopLeftRadius),
          padding: parseFloat(getComputedStyle(content).paddingLeft),
          buttonHeight: button.getBoundingClientRect().height,
        };
      });

    const base = await measure();
    await choose(page, "Densidade", "Compacta");
    await choose(page, "Formato dos cards", "Minimal");
    const compact = await measure();
    await choose(page, "Densidade", "Espaçosa");
    await choose(page, "Formato dos cards", "Arredondado");
    const spacious = await measure();

    expect(compact.padding).toBeLessThan(base.padding);
    expect(spacious.padding).toBeGreaterThan(base.padding);
    expect(compact.radius).toBeLessThan(base.radius);
    expect(spacious.radius).toBeGreaterThan(base.radius);
    for (const sample of [base, compact, spacious]) {
      expect(sample.buttonHeight).toBeGreaterThanOrEqual(44);
    }
  });

  test("navegacao compacta estreita so a sidebar desktop e mantem os nomes", async ({ page }, testInfo) => {
    await gotoHydrated(page, PERSONALIZATION);
    await choose(page, "Navegação no computador", "Só ícones");

    if (testInfo.project.name === "desktop") {
      const sidebar = page.locator("aside[data-elyra-sidebar]");
      await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThanOrEqual(81);
      const nav = page.getByRole("navigation", { name: "Navegação principal" });
      const dashboard = nav.getByRole("link", { name: "Dashboard" });
      await expect(dashboard).toBeVisible();
      await expect(dashboard).toHaveAttribute("title", "Dashboard");
      await expect(page.getByRole("link", { name: "Ir para o Dashboard" }).first()).toBeVisible();
      await evidence(page, "personalization-nav-compact-desktop");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } else {
      // Abaixo de 64rem nao ha sidebar: o drawer continua com rotulos completos.
      await expect(page.locator("aside[data-elyra-sidebar]")).toBeHidden();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
    }
  });

  test("Axe, teclado e previa fora da ordem de tabulacao, em claro e escuro", async ({ page }) => {
    await gotoHydrated(page, PERSONALIZATION);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await evidence(page, `personalization-light-${test.info().project.name}`);

    await choose(page, "Tema", "Escuro");
    await page.waitForTimeout(300);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await evidence(page, `personalization-dark-${test.info().project.name}`);

    const preview = page.getByTestId("personalization-preview");
    await expect(preview).toHaveAttribute("aria-hidden", "true");
    await expect(preview.locator("a, button, input, [tabindex]")).toHaveCount(0);

    const compact = page
      .locator("fieldset")
      .filter({ has: page.getByText("Densidade", { exact: true }) })
      .getByRole("button", { name: "Compacta" });
    await compact.focus();
    await page.keyboard.press("Enter");
    await expect(compact).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-elyra-density", "compact");
    const outline = await compact.evaluate((node) => getComputedStyle(node).outlineStyle);
    expect(outline).not.toBe("none");
  });
});
