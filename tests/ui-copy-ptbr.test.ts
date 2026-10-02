import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guarda de copy PT-BR da UI da V1 (Visual Correction Batch 01).
 *
 * O Visual Replay registrou dois achados de copy:
 *
 * - VR-001: rotulos visiveis sem acentuacao ("Diario", "Relatorios",
 *   "Sessoes", "Analise da sessao").
 * - VR-005: vocabulario interno de implementacao vazando para a tela de
 *   Relatorios ("Sem dado persistido", "captura pertence a uma etapa
 *   posterior").
 *
 * Este arquivo protege **apenas as strings-chave** desses dois achados. Ele nao
 * e um corretor ortografico do repositorio: uma suite que tentasse afirmar cada
 * palavra acentuada do projeto quebraria a cada texto novo sem provar nada.
 *
 * A verificacao e feita sobre o fonte, e nao sobre o DOM, porque estes rotulos
 * sao literais estaticos - nao dependem de dado, sessao nem navegador.
 */

const ROOT = join(__dirname, "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("VR-001 - rotulos PT-BR visiveis", () => {
  it("a navegacao usa os rotulos acentuados", () => {
    const nav = read("src/components/layout/nav-config.ts");
    for (const label of ["Diário", "Relatórios", "Sessões"]) {
      expect(nav).toContain(`label: "${label}"`);
    }
    // As rotas continuam sem acento: o rotulo mudou, a identidade tecnica nao.
    expect(nav).toContain('href: "/diario"');
    expect(nav).toContain('href: "/relatorios"');
    expect(nav).toContain('href: "/sessoes"');
  });

  it("os titulos das paginas usam os rotulos acentuados", () => {
    expect(read("src/app/(app)/diario/page.tsx")).toContain('title: "Diário"');
    expect(read("src/app/(app)/historico/page.tsx")).toContain('title: "Histórico"');
    expect(read("src/app/(app)/relatorios/page.tsx")).toContain('title: "Relatórios"');
    expect(read("src/app/(app)/sessoes/page.tsx")).toContain('title: "Sessões"');
    expect(read("src/app/(app)/configuracoes/page.tsx")).toContain('title: "Configurações"');
  });

  it("o resultado multimodal usa 'Análise da sessão'", () => {
    expect(read("src/app/(app)/sessoes/[id]/page.tsx")).toContain(
      'title: "Análise da sessão"',
    );
  });
});

describe("VR-005 - a UI de Relatorios nao expoe vocabulario interno", () => {
  const view = read("src/app/(app)/relatorios/view.tsx");

  it("as frases de implementacao sairam da tela", () => {
    expect(view).not.toContain("Sem dado persistido");
    expect(view).not.toContain("captura pertence a uma etapa posterior");
    expect(view).not.toContain("sessões persistidas");
  });

  it("o card de sessoes declara honestamente a ausencia da metrica", () => {
    // O contrato de relatorios nao calcula quantidade de sessoes. A copy diz
    // isso sem inventar numero e sem prometer implementacao futura.
    expect(view).toContain("Sessões realizadas");
    expect(view).toContain("Não entra neste relatório");
    expect(view).toContain("Esta métrica não entra neste relatório.");
  });
});

/**
 * Batch 02 - a camada que o Batch 01 nao alcancou.
 *
 * O Pre-Deploy Visual Replay reprovou `VR-001` com 13 residuos visiveis. A
 * causa nao foi descuido de revisao: a varredura do Batch 01 cobriu
 * `src/app/**`, e **parte da copy exibida mora em `src/lib/contracts/**`** -
 * mapas `Record<Chave, string>` cujo valor e rotulo de tela e cuja chave e
 * identidade tecnica. Uma busca por "copy" naquela pasta nao acha nada; uma
 * busca por "contrato" nao olha o valor.
 *
 * Este bloco fixa os dois lados: **valor acentuado** e **chave intocada**. E o
 * segundo assert que importa - foi a confusao entre os dois que quase fez o
 * lote acentuar `camera`, `luteal` e `completed`.
 */
describe("VR-001 - rotulos exibidos que moram na camada de contrato", () => {
  it("os tipos e recursos de sessao usam rotulos acentuados", () => {
    const session = read("src/lib/contracts/session.ts");
    for (const label of [
      "Reflexão guiada",
      "Reflexão livre",
      "Usar câmera",
      "Aguardando permissões",
      "Captura concluída",
      "Análise concluída",
      "Exclusão pendente",
    ]) {
      expect(session).toContain(`"${label}"`);
    }
    // As chaves do enum continuam sem acento: sao identidade tecnica.
    for (const key of ["guided:", "free:", "camera:", "microphone:", "analyzed:"]) {
      expect(session).toContain(key);
    }
    expect(session).toContain('"guided", "free", "deep_checkin"');
  });

  it("as fases do ciclo usam rotulos acentuados sem mexer no enum", () => {
    const cycle = read("src/lib/contracts/cycle.ts");
    expect(cycle).toContain('menstrual: "Menstruação"');
    expect(cycle).toContain('ovulatory: "Ovulação"');
    expect(cycle).toContain('luteal: "Fase lútea"');
    // O valor persistido e analitico permanece o identificador em ingles.
    expect(cycle).toContain("luteal");
    expect(cycle).not.toContain('"Fase lutea"');
  });

  it("status de meta e categorias de compartilhamento estao acentuados", () => {
    expect(read("src/lib/contracts/goals.ts")).toContain('completed: "Concluída"');
    const sharing = read("src/lib/contracts/sharing.ts");
    expect(sharing).toContain('sessions: "Sessões"');
    expect(sharing).toContain('journal: "Diário compartilhado"');
  });

  it("os motivos de transcricao indisponivel estao acentuados", () => {
    const analysis = read("src/lib/contracts/session-analysis.ts");
    expect(analysis).toContain("A sessão continua válida.");
    expect(analysis).toContain("Nenhuma fala foi reconhecida durante a sessão.");
  });

  it("a saudacao do dashboard e o botao do perfil estao acentuados", () => {
    expect(read("src/app/(app)/dashboard/view.tsx")).toContain("Olá, {user.name}");
    expect(read("src/app/(app)/perfil/view.tsx")).toContain('"Salvar alterações"');
  });
});


describe("PDR-002 - /perfil nao expoe linguagem de etapa interna", () => {
  const page = read("src/app/(app)/perfil/page.tsx");

  it("a afirmacao falsa sobre autenticacao saiu da tela", () => {
    expect(page).not.toContain("Nesta fase");
    expect(page).not.toContain("autenticação real");
  });

  it("a descricao corresponde ao que a pagina realmente mostra", () => {

    expect(page).toContain("Sua identidade, seu acesso e um resumo dos seus registros.");
  });
});
/**
 * VR-001 (residuo DB-backed) - espelhos dos catalogos semeados.
 *
 * Estes 12 rotulos nao vivem em TypeScript: a pessoa os ve porque chegam do
 * banco (`emotional_factors`, `journal_tags`, `cycle_symptoms`, todos
 * `origin = 'system'`). A fonte executavel e o banco, e quem a protege e o
 * pgTAP `supabase/tests/batch02_catalog_display_labels.sql` - **nao** este
 * arquivo, que nunca le texto de migration.
 *
 * O que este bloco protege e a outra metade: os espelhos em `src/mocks/**`.
 * Um mock que volte a divergir do catalogo real reintroduz exatamente o erro
 * que fechou este lote - copy correta no codigo, errada na tela, ou o inverso.
 *
 * Como sempre, os dois lados de cada linha: a **label** acentuada e a **chave
 * tecnica** intocada.
 */
describe("VR-001 - espelhos dos catalogos DB-backed em mocks", () => {
  const data = read("src/mocks/data.ts");
  const cycleData = read("src/mocks/cycle-data.ts");

  it("os fatores emocionais espelham o catalogo acentuado", () => {
    for (const label of ["Exercício", "Família", "Saúde", "Finanças"]) {
      expect(data).toContain(`label: "${label}"`);
    }
    // Os UUIDs semeados sao a identidade tecnica e nao mudam.
    expect(data).toContain("10000000-0000-4000-8000-000000000004");
    expect(data).toContain("10000000-0000-4000-8000-000000000007");
  });

  it("as tags de diario espelham o catalogo acentuado", () => {
    for (const label of ["Gratidão", "Reflexão", "Relações"]) {
      expect(data).toContain(`label: "${label}"`);
    }
    // Os ids de mock permanecem sem acento: sao chave, nao texto de tela.
    expect(data).toContain('id: "t-gratidao"');
    expect(data).toContain('id: "t-reflexao"');
    expect(data).toContain('id: "t-relacoes"');
  });

  it("os sintomas de ciclo espelham o catalogo acentuado", () => {
    for (const label of [
      "Cólica",
      "Dor de cabeça",
      "Cansaço",
      "Inchaço",
      "Alteração de apetite",
    ]) {
      expect(cycleData).toContain(`label: "${label}"`);
    }
    expect(cycleData).toContain('id: "sy-colica"');
    expect(cycleData).toContain('id: "sy-cabeca"');
    expect(cycleData).toContain('id: "sy-apetite"');
  });

  it("nenhum espelho de catalogo ficou sem acentuacao", () => {
    for (const stale of [
      "Exercicio",
      "Familia",
      "Saude",
      "Financas",
      "Gratidao",
      "Reflexao",
      "Relacoes",
    ]) {
      expect(data).not.toContain(`label: "${stale}"`);
    }
    for (const stale of [
      "Colica",
      "Dor de cabeca",
      "Cansaco",
      "Inchaco",
      "Alteracao de apetite",
    ]) {
      expect(cycleData).not.toContain(`label: "${stale}"`);
    }
  });
});
