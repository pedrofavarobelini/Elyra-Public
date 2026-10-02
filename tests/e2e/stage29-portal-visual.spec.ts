import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { brokenGuardedWords, measureDeadSpace as measure } from "./dead-space";
import { gotoHydrated } from "./hydrated";



const MAX_COLUMN_GAP = 260;

interface QaIdentity {
  project: string;
  userId: string;
}

function patientId(project: string) {
  const identities = JSON.parse(
    readFileSync(resolve(process.cwd(), "test-results", ".auth", "identity.json"), "utf8"),
  ) as QaIdentity[];
  const patient = identities.find((identity) => identity.project === `${project}-patient`);
  if (!patient) throw new Error("Paciente QA ausente.");
  return patient.userId;
}

test.describe("Stage 29 / PRO-4 - portal visual", () => {
  const routes = (project: string) => [
    { path: "/pro/dashboard", slug: "dashboard" },
    { path: "/pro/acompanhamentos", slug: "acompanhamentos" },
    { path: `/pro/acompanhamentos/${patientId(project)}`, slug: "dossie" },
    { path: `/pro/relatorios?pessoa=${patientId(project)}&periodo=90`, slug: "relatorios" },
    { path: "/pro/solicitacoes", slug: "solicitacoes" },
    { path: "/pro/vinculos", slug: "vinculos" },
    { path: "/pro/perfil", slug: "perfil" },
  ];

  for (const slug of ["dashboard", "acompanhamentos", "dossie", "relatorios", "solicitacoes", "vinculos", "perfil"]) {
    test(`${slug}: sem espaco morto estrutural, sem rolagem lateral`, async ({ page }, testInfo) => {
      const route = routes(testInfo.project.name).find((item) => item.slug === slug)!;
      /*
        Viewports por projeto: o desktop tambem mede 1920; o celular mede os
        tres larguras canonicas (360, 390/393, 412). Cada largura recarrega a
        pagina, entao a composicao medida e a do primeiro render nela.
      */
      const extra: Record<string, Array<{ width: number; height: number }>> = {
        desktop: [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }],
        tablet: [{ width: 834, height: 1112 }],
        mobile: [{ width: 360, height: 780 }, { width: 393, height: 851 }, { width: 412, height: 915 }],
      };
      for (const size of extra[testInfo.project.name] ?? [page.viewportSize()!]) {
        await page.setViewportSize(size);
        await gotoHydrated(page, route.path);
        await page.waitForTimeout(400);
        await page.screenshot({
          // Fora do outputDir quando pedido: o Playwright limpa `test-results` a cada run.
          path: `${process.env.ELYRA_SHOTS_DIR ?? "test-results/stage29-shots"}/${testInfo.project.name}-${size.width}/${slug}.png`,
          fullPage: true,
        });
        const metrics = await measure(page);
        testInfo.annotations.push({
          type: "dead-space",
          description: JSON.stringify({ width: size.width, ...metrics }),
        });
        expect(metrics.horizontalOverflow, `rolagem lateral em ${size.width}px`).toBeLessThanOrEqual(0);
        expect(metrics.widthUse, `largura util em ${size.width}px`).toBeGreaterThanOrEqual(0.9);
        /*
          Rotulo curto nao pode partir palavra no meio ("Acompanh/amentos"):
          sem dicionario de hifenizacao, `break-words` corta onde cabe. Cada
          palavra de um elemento `data-word-guard` precisa caber numa linha.
        */
        const brokenWords = await brokenGuardedWords(page);
        if (slug === "dashboard") await expect(page.locator("[data-word-guard]")).toHaveCount(4);
        expect(brokenWords, `palavra partida em ${size.width}px`).toEqual([]);
        for (const grid of metrics.grids) {
          if (!grid.sideBySide) continue;
          expect(
            grid.gap <= MAX_COLUMN_GAP || grid.shortRatio >= 0.75,
            `${size.width}px: colunas terminam a ${Math.round(grid.gap)} px (razao ${grid.shortRatio.toFixed(2)})`,
          ).toBe(true);
        }
      }
    });
  }
});
