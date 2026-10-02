import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { TERMOS_CAUSAIS, TERMOS_CLINICOS } from "@/lib/contracts/vocabulary";



const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Superficies que **interpretam** dado, e por isso exigem o aviso visivel.
 *
 * `/historico` fica de fora de proposito: ele lista registro observado, sem
 * media, tendencia ou associacao. Exigir aviso onde nao ha interpretacao
 * ensinaria a ignorar o aviso.
 */
const SUPERFICIES_INTERPRETATIVAS = [
  "src/app/(app)/dashboard/view.tsx",
  "src/app/(app)/relatorios/view.tsx",
];


const COPY_DA_ERA_2 = [
  "src/lib/associations.ts",
  "src/lib/cross-domain.ts",
  "src/components/charts/sample-size.tsx",
  "src/components/charts/comparison-card.tsx",
  "src/app/(app)/dashboard/view.tsx",
  "src/app/(app)/relatorios/view.tsx",
  "src/app/(app)/historico/edit-checkin-dialog.tsx",
];


const COPY_DA_ERA_8 = [
  "src/lib/today.ts",
  "src/components/today/today-panel.tsx",
  "src/components/today/quick-checkin.tsx",
  "src/lib/journey.ts",
  "src/components/journey/timeline.tsx",
  "src/components/journey/month-heatmap.tsx",
  "src/lib/week.ts",
  "src/components/journey/week-summary.tsx",
  "src/lib/routines.ts",
  "src/lib/personal-plan.ts",
  "src/components/routines/routine-player.tsx",
  "src/components/today/personal-plan-card.tsx",
  "src/lib/suggestions.ts",
  "src/lib/explore.ts",
  "src/components/today/suggestions.tsx",
  "src/lib/achievements.ts",
  "src/components/journey/achievements.tsx",
];



/**
 * Extrai apenas o que chega ao leitor.
 *
 * Comentario nao e copy. Este arquivo mesmo precisa citar as palavras proibidas
 * para poder proibi-las - e `associations.ts` lista os verbos causais num
 * comentario justamente para lembrar de nao usa-los. Verificar o arquivo inteiro
 * reprovaria o codigo que protege a regra.
 */
function copyVisivel(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ");
}

describe("aviso nao clinico em superficie interpretativa", () => {
  for (const arquivo of SUPERFICIES_INTERPRETATIVAS) {
    it(`${arquivo} renderiza NonClinicalNotice`, () => {
      expect(read(arquivo)).toContain("<NonClinicalNotice");
    });
  }
});

describe("copy da Era 2 nao afirma condicao clinica", () => {
  for (const arquivo of [...COPY_DA_ERA_2, ...COPY_DA_ERA_8]) {
    it(`${arquivo} nao usa vocabulario clinico`, () => {
      const copy = copyVisivel(read(arquivo)).toLowerCase();
      for (const termo of TERMOS_CLINICOS) {
        expect(copy, `termo clinico "${termo}" em ${arquivo}`).not.toContain(termo);
      }
    });
  }
});

describe("copy da Era 2 nao afirma causa", () => {
  for (const arquivo of [...COPY_DA_ERA_2, ...COPY_DA_ERA_8]) {
    it(`${arquivo} nao usa verbo causal`, () => {
      const copy = copyVisivel(read(arquivo)).toLowerCase();
      for (const termo of TERMOS_CAUSAIS) {
        expect(copy, `verbo causal "${termo}" em ${arquivo}`).not.toContain(termo);
      }
    });
  }
});

describe("padroes derivados obrigatorios", () => {
  /**
   * A metrica e autorrelatada. "ansiedade" isolada afirmaria medicao, e o
   * sistema nao mede ansiedade - ele registra o que a pessoa relatou.
   */
  it("ansiedade aparece sempre como percebida nas telas da Era 2", () => {
    for (const arquivo of [
      "src/app/(app)/dashboard/view.tsx",
      "src/app/(app)/historico/edit-checkin-dialog.tsx",
    ]) {
      const copy = copyVisivel(read(arquivo));
      const rotulos = [...copy.matchAll(/label="([^"]*[Aa]nsiedade[^"]*)"/g)];
      expect(rotulos.length, `nenhum rotulo de ansiedade em ${arquivo}`).toBeGreaterThan(0);
      for (const [, rotulo] of rotulos) {
        expect(rotulo, `rotulo sem "percebida" em ${arquivo}`).toContain("percebida");
      }
    }
  });

  /**
   * Comparacao e sempre contra o proprio historico da pessoa. Norma
   * populacional nao existe no produto e nao deve aparecer na copy.
   */
  it("a comparacao se refere ao proprio periodo da pessoa, nao a uma norma", () => {
    const copy = copyVisivel(read("src/components/charts/comparison-card.tsx"));
    expect(copy).toContain("vs. período anterior");
    expect(copy.toLowerCase()).not.toMatch(/média da população|pessoas como você|padrão normal/);
  });

  /**
   * Dado insuficiente e um estado distinto de "nenhum padrao" e de "sem
   * registros". Confundi-los transforma silencio de dado em conclusao.
   */
  it("dado insuficiente nao e apresentado como ausencia de padrao", () => {
    for (const arquivo of ["src/components/charts/sample-size.tsx", "src/lib/associations.ts"]) {
      const copy = copyVisivel(read(arquivo)).toLowerCase();
      expect(copy).toContain("ainda não dá para");
      expect(copy).not.toMatch(/nenhum padrão|não há padrão|sem padrão/);
    }
  });
});
