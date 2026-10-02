import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { gotoHydrated } from "./hydrated";


const ROUTES = ["/dashboard", "/configuracoes", "/configuracoes/personalizacao", "/notificacoes", "/perfil", "/seguranca", "/relatorios", "/metas"] as const;
const AA = 4.5;

/*
 * O tema e aplicado na hidratacao, e varios elementos tem `transition-colors`.
 * Medir antes de a transicao terminar captura uma cor intermediaria — foi o que
 * reprovou este teste com `rgb(95,98,197)`, que nao e nem o valor claro nem o
 * escuro. A medida vale sobre o estado estavel, entao esperamos as transicoes
 * de cor terminarem antes de ler qualquer coisa.
 */
async function aguardarCoresEstaveis(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, {
    timeout: 5_000,
  }).catch(() => undefined);
  await page.waitForTimeout(250);
}

async function piorContraste(page: Page) {
  return page.evaluate(() => {
    const lum = (cor: string) => {
      const m = cor.match(/\d+(\.\d+)?/g);
      if (!m) return null;
      const [r, g, b] = m.slice(0, 3).map(Number) as [number, number, number];
      if (m.length > 3 && Number(m[3]) < 0.5) return null;
      const f = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fundoDe = (el: Element) => {
      let n: Element | null = el;
      while (n && n !== document.documentElement) {
        const l = lum(getComputedStyle(n).backgroundColor);
        if (l !== null) return l;
        n = n.parentElement;
      }
      return lum(getComputedStyle(document.documentElement).backgroundColor) ?? 0;
    };
    let pior = { ratio: 99, texto: "", cor: "", fundo: "" };
    for (const el of document.querySelectorAll("p,span,h1,h2,h3,h4,a,button,label,li,strong,td,th")) {
      const t = (el.textContent ?? "").trim();
      if (!t || el.children.length > 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.opacity === "0") continue;
      const fg = lum(cs.color);
      if (fg === null) continue;
      const bg = fundoDe(el);
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      if (ratio < pior.ratio) {
        pior = { ratio: Number(ratio.toFixed(2)), texto: t.slice(0, 48), cor: cs.color, fundo: String(bg) };
      }
    }
    return pior;
  });
}

/*
 * "Padrao" nomeia tanto um contraste quanto um estilo de card, entao o clique e
 * escopado pelo fieldset da preferencia. Sem isso o seletor casa dois botoes e o
 * teste morre em strict mode em vez de medir o que veio medir.
 */
async function escolher(page: Page, legenda: string, nome: string) {
  await page
    .locator("fieldset")
    .filter({ has: page.getByText(legenda, { exact: true }) })
    .getByRole("button", { name: nome, exact: true })
    .click();
}

test.describe("PREVIEW_FIX_02 tema escuro", () => {
  test("nenhuma superficie escura carrega texto invisivel", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Contrato de token independe do viewport.");

    await gotoHydrated(page, "/configuracoes/personalizacao");
    await escolher(page, "Tema", "Escuro");
    await expect(page.locator("html")).toHaveAttribute("data-elyra-theme", "dark");

    for (const rota of ROUTES) {
      await gotoHydrated(page, rota);
      await expect(page.locator("html")).toHaveAttribute("data-elyra-theme", "dark");
      await aguardarCoresEstaveis(page);
      const pior = await piorContraste(page);
      expect(pior.ratio, `${rota} no escuro: ${JSON.stringify(pior)}`).toBeGreaterThanOrEqual(AA);
    }

    await gotoHydrated(page, "/configuracoes/personalizacao");
    await page.getByRole("button", { name: "Restaurar padrão" }).click();
  });

  test("fundos e estilos de card mantem o escuro legivel", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Contrato de token independe do viewport.");

    await gotoHydrated(page, "/configuracoes/personalizacao");
    await escolher(page, "Tema", "Escuro");

    for (const fundo of ["Neutro", "Acolhedor", "Sereno"]) {
      for (const card of ["Padrão", "Suave", "Elevado"]) {
        await escolher(page, "Fundo do aplicativo", fundo);
        await escolher(page, "Aparência dos cards", card);
        await aguardarCoresEstaveis(page);
        const pior = await piorContraste(page);
        expect(pior.ratio, `escuro + ${fundo} + ${card}: ${JSON.stringify(pior)}`).toBeGreaterThanOrEqual(AA);
      }
    }

    // O baseline de acessibilidade nao pode cair por causa da personalizacao.
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Restaurar padrão" }).click();
  });

  test("densidade, formato e navegacao compacta nao reabrem contraste ruim no escuro", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "Navegacao compacta existe a partir de 64rem.");

    await gotoHydrated(page, "/configuracoes/personalizacao");
    await escolher(page, "Tema", "Escuro");
    await escolher(page, "Densidade", "Compacta");
    await escolher(page, "Formato dos cards", "Minimal");
    await escolher(page, "Navegação no computador", "Só ícones");

    for (const rota of ["/dashboard", "/configuracoes", "/configuracoes/personalizacao", "/notificacoes"]) {
      await gotoHydrated(page, rota);
      await expect(page.locator("html")).toHaveAttribute("data-elyra-navigation", "compact");
      await aguardarCoresEstaveis(page);
      const pior = await piorContraste(page);
      expect(pior.ratio, `${rota} escuro+compacto: ${JSON.stringify(pior)}`).toBeGreaterThanOrEqual(AA);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await gotoHydrated(page, "/configuracoes/personalizacao");
    await page.getByRole("button", { name: "Restaurar padrão" }).click();
  });
});
