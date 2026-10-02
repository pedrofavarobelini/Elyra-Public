import { describe, expect, it } from "vitest";

import type { EmotionalCheckin } from "@/lib/contracts/emotional";
import { buildAnalyticsReport } from "@/lib/reports";
import {
  REPORT_EXPORT_SCHEMA_VERSION,
  buildReportExport,
  renderReportExportText,
} from "@/lib/reports-export";

const TZ = "America/Sao_Paulo";

function checkin(id: string, day: string, mood: number | null): EmotionalCheckin {
  return {
    id,
    occurredAt: `${day}T12:00:00.000Z`,
    mood,
    perceivedAnxiety: mood === null ? null : 10 - mood,
    energy: mood,
    primaryFeeling: null,
    note: null,
    factors: [],
  } as unknown as EmotionalCheckin;
}

function relatorio(checkins: EmotionalCheckin[]) {
  return buildAnalyticsReport({
    referenceDate: "2026-06-30",
    days: 28,
    timeZone: TZ,
    checkins,
    sleep: [],
    periods: [],
    cycleEnabled: false,
  });
}

function envelope(checkins: EmotionalCheckin[] = []) {
  return buildReportExport({
    report: relatorio(checkins),
    generatedAt: new Date("2026-06-30T15:00:00.000Z"),
    periodKind: "custom",
    metrics: ["mood", "anxiety"],
    cycleIncluded: false,
  });
}


describe("envelope de export - Era 3", () => {
  it("carrega quando, que periodo e que filtros", () => {
    const resultado = envelope([checkin("c1", "2026-06-29", 8)]);

    expect(resultado.schemaVersion).toBe(REPORT_EXPORT_SCHEMA_VERSION);
    expect(resultado.generatedAt).toBe("2026-06-30T15:00:00.000Z");
    expect(resultado.period).toMatchObject({
      to: "2026-06-30",
      days: 28,
      timeZone: TZ,
      kind: "custom",
    });
    expect(resultado.filters.metrics).toEqual(["anxiety", "mood"]);
    expect(resultado.filters.cycleIncluded).toBe(false);
  });

  /**
   * A metade que faltava.
   *
   * Ate aqui o envelope declarava so o que estava **exibido**. Depois que o
   * filtro passou a alcancar o conjunto analisado, um envelope sem `dataset`
   * afirmaria que aquelas medias descrevem tudo - quando descrevem um recorte.
   */
  it("declara o recorte do conjunto analisado, e nao so o que estava na tela", () => {
    const resultado = buildReportExport({
      report: relatorio([]),
      generatedAt: new Date("2026-06-30T15:00:00.000Z"),
      periodKind: "fixed",
      metrics: ["mood"],
      cycleIncluded: true,
      filters: {
        domains: ["emotional", "cycle"],
        factorIds: ["f-2", "f-1"],
        journalTagIds: ["t-1"],
        cyclePhases: ["luteal", "menstrual"],
      },
      labels: {
        factors: { "f-1": "Trabalho", "f-2": "Terapia" },
        journalTags: { "t-1": "Gratidão" },
      },
    });

    expect(resultado.filters.dataset.domains).toEqual(["emotional", "cycle"]);
    expect(resultado.filters.dataset.factors).toEqual([
      { id: "f-2", label: "Terapia" },
      { id: "f-1", label: "Trabalho" },
    ]);
    expect(resultado.filters.dataset.journalTags).toEqual([
      { id: "t-1", label: "Gratidão" },
    ]);
    // Ordem canonica do contrato, e nao ordem de clique.
    expect(resultado.filters.dataset.cyclePhases).toEqual(["menstrual", "luteal"]);
  });

  it("sem filtro, declara todos os dominios em vez de omitir a linha", () => {
    const resultado = envelope();

    expect(resultado.filters.dataset.domains).toEqual([
      "emotional",
      "sleep",
      "cycle",
    ]);
    expect(resultado.filters.dataset.factors).toEqual([]);
    expect(resultado.filters.dataset.journalTags).toEqual([]);
    expect(resultado.filters.dataset.cyclePhases).toEqual([]);
  });

  it("ordena os filtros para que duas geracoes do mesmo estado sejam identicas", () => {
    const a = buildReportExport({
      report: relatorio([]),
      generatedAt: new Date("2026-06-30T15:00:00.000Z"),
      periodKind: "fixed",
      metrics: ["mood", "anxiety", "energy"],
      cycleIncluded: true,
      filters: {
        domains: ["cycle", "emotional", "sleep"],
        factorIds: ["f-2", "f-1"],
        journalTagIds: [],
        cyclePhases: ["luteal", "menstrual"],
      },
      labels: { factors: { "f-1": "Trabalho", "f-2": "Terapia" } },
    });
    const b = buildReportExport({
      report: relatorio([]),
      generatedAt: new Date("2026-06-30T15:00:00.000Z"),
      periodKind: "fixed",
      metrics: ["energy", "mood", "anxiety"],
      cycleIncluded: true,
      filters: {
        domains: ["emotional", "sleep", "cycle"],
        factorIds: ["f-1", "f-2"],
        journalTagIds: [],
        cyclePhases: ["menstrual", "luteal"],
      },
      labels: { factors: { "f-1": "Trabalho", "f-2": "Terapia" } },
    });

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("declara as versoes que produziram o numero", () => {
    const resultado = envelope();
    expect(resultado.versions.analytics).toBe(resultado.report.analyticsVersion);
    expect(resultado.versions.reportSchema).toBe(resultado.report.schemaVersion);
  });
});

describe("versao legivel do export", () => {
  it("declara periodo, instante e filtros no texto", () => {
    const texto = renderReportExportText(envelope([checkin("c1", "2026-06-29", 8)]));

    expect(texto).toContain("a 30/06/2026");
    expect(texto).toContain("28 dias, personalizado");
    expect(texto).toContain("Métricas exibidas: anxiety, mood");
    expect(texto).toContain("Gerado em:");
  });


  it("o texto declara o conjunto analisado, e nao so as metricas exibidas", () => {
    const texto = renderReportExportText(
      buildReportExport({
        report: relatorio([]),
        generatedAt: new Date("2026-06-30T15:00:00.000Z"),
        periodKind: "fixed",
        metrics: ["mood"],
        cycleIncluded: true,
        filters: {
          domains: ["emotional", "cycle"],
          factorIds: ["f-1"],
          journalTagIds: [],
          cyclePhases: ["luteal"],
        },
        labels: { factors: { "f-1": "Trabalho" } },
      }),
    );

    expect(texto).toContain("Conjunto analisado");
    expect(texto).toContain("Domínios: Emocional, Ciclo");
    expect(texto).toContain("Dias com o fator registrado: Trabalho");
    expect(texto).toContain("Dias com tag no diário: sem recorte");
    expect(texto).toContain("Fase do ciclo (estimada): Fase lútea");
    expect(texto).toContain("não são recortados pelo filtro de dias");
  });

  it("sem recorte, o texto diz que nao ha recorte em vez de calar", () => {
    const texto = renderReportExportText(envelope());

    expect(texto).toContain("Domínios: Emocional, Sono, Ciclo");
    expect(texto).toContain("Dias com o fator registrado: sem recorte");
    expect(texto).not.toContain("não são recortados pelo filtro de dias");
  });

  it("ausencia continua sendo ausencia, e nunca zero", () => {
    const texto = renderReportExportText(envelope());

    expect(texto).toContain("sem registro");
    expect(texto).not.toMatch(/Humor: 0(\D|$)/);
  });

  it("toda media vem com quantos dias a sustentam", () => {
    const texto = renderReportExportText(
      envelope([
        checkin("c1", "2026-06-27", 6),
        checkin("c2", "2026-06-28", 7),
        checkin("c3", "2026-06-29", 8),
      ]),
    );

    expect(texto).toContain("3 dia(s) com registro");
  });

  it("descreve, e nao conclui nem indica conduta", () => {
    const texto = renderReportExportText(envelope());

    /*
      A ressalva final **nega** avaliacao clinica, e negar e o oposto de afirmar.
      Rodar a busca no texto inteiro reprovaria justamente a frase que protege -
      entao o corpo e verificado separado da ressalva, que e verificada por
      existir.

      O gate de linguagem nao clinica cobre a copy das telas; aqui a mesma regra
      vale para o artefato que **sai** do produto, que e onde ela importa mais:
      uma tela e lida com a Elyra em volta, um arquivo exportado nao.
    */
    const partes = texto.split("Este relatório descreve");
    expect(partes).toHaveLength(2);
    const corpo = partes[0] ?? "";

    for (const proibido of [
      "diagnóstico",
      "transtorno",
      "depressão",
      "ansiedade clínica",
      "recomenda",
      "deve procurar",
      "causou",
      "provocou",
    ]) {
      expect(corpo.toLowerCase()).not.toContain(proibido);
    }

    expect(texto).toContain(
      "Não é avaliação, diagnóstico nem indicação de conduta.",
    );
  });
});
