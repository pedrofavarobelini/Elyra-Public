import type { CyclePhase } from "@/lib/contracts/cycle";
import { PHASE_LABEL } from "@/lib/contracts/cycle";
import type { ReportDomain, ReportFilterSelection } from "@/lib/report-filters";
import {
  NO_REPORT_FILTERS,
  REPORT_DOMAIN_LABEL,
  normalizeSelection,
} from "@/lib/report-filters";
import type { AnalyticsReport } from "@/lib/reports";

/** Rotulo legivel de um item filtrado, ao lado do identificador que o produziu. */
export interface ExportFilterItem {
  id: string;
  label: string;
}


export interface ReportExportEnvelope {
  schemaVersion: "elyra-report-export/v1";
  /** Instante da geracao, em ISO 8601 com fuso. */
  generatedAt: string;
  period: {
    from: string;
    to: string;
    days: number;
    timeZone: string;
    /** `fixed` para as janelas do produto, `custom` para intervalo escolhido. */
    kind: "fixed" | "custom";
  };
  /**
   * O que estava filtrado quando o relatorio foi gerado.
   *
   * A separacao entre `metrics` e `dataset` e estrutural, e nao arrumacao:
   * `metrics` diz o que estava **exibido** - qual linha aparecia no grafico -,
   * enquanto `dataset` diz o que foi **analisado**, ou seja, quais registros
   * chegaram ao motor que produziu cada numero abaixo. Um leitor que confunda os
   * dois conclui sobre um conjunto que nunca foi calculado, e por isso os dois
   * nao dividem o mesmo nivel do envelope.
   *
   * Lista vazia significa "nenhum", que e diferente de "todos" - e por isso toda
   * lista e explicita, nunca omitida quando cheia.
   */
  filters: {
    metrics: string[];
    cycleIncluded: boolean;
    dataset: {
      domains: ReportDomain[];
      factors: ExportFilterItem[];
      journalTags: ExportFilterItem[];
      cyclePhases: CyclePhase[];
    };
  };
  versions: {
    analytics: string;
    reportSchema: string;
    cycleHeuristic: string;
  };
  report: AnalyticsReport;
}

export const REPORT_EXPORT_SCHEMA_VERSION = "elyra-report-export/v1" as const;

export function buildReportExport(input: {
  report: AnalyticsReport;
  generatedAt: Date;
  periodKind: "fixed" | "custom";
  metrics: string[];
  cycleIncluded: boolean;
  /** Recorte do conjunto analisado. Ausente significa "nada foi recortado". */
  filters?: ReportFilterSelection;
  /** Rotulos dos identificadores filtrados - um id sozinho nao e legivel. */
  labels?: {
    factors?: Record<string, string>;
    journalTags?: Record<string, string>;
  };
}): ReportExportEnvelope {
  const { report } = input;
  const dataset = normalizeSelection(input.filters ?? NO_REPORT_FILTERS);
  const item = (
    ids: string[],
    labels: Record<string, string> | undefined,
  ): ExportFilterItem[] =>
    ids
      // Um id sozinho nao e legivel por gente; sem rotulo conhecido, o proprio
      // id fica no lugar dele, em vez de a linha sumir do envelope.
      .map((id) => ({ id, label: labels?.[id] ?? id }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR") || (a.id < b.id ? -1 : 1));
  return {
    schemaVersion: REPORT_EXPORT_SCHEMA_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    period: {
      from: report.window.from,
      to: report.window.to,
      days: report.dataQuality.daysInWindow,
      timeZone: report.timeZone,
      kind: input.periodKind,
    },
    filters: {
      // Ordenado para que dois exports do mesmo estado sejam identicos byte a
      // byte. Export que muda sozinho nao serve para comparar duas geracoes.
      metrics: [...input.metrics].sort(),
      cycleIncluded: input.cycleIncluded,
      dataset: {
        domains: dataset.domains,
        factors: item(dataset.factorIds, input.labels?.factors),
        journalTags: item(dataset.journalTagIds, input.labels?.journalTags),
        cyclePhases: dataset.cyclePhases,
      },
    },
    versions: {
      analytics: report.analyticsVersion,
      reportSchema: report.schemaVersion,
      cycleHeuristic: report.cycleHeuristicVersion,
    },
    report,
  };
}

function br(iso: string): string {
  return iso.split("-").reverse().join("/");
}

function valor(v: number | null, sufixo = ""): string {
  // `null` nunca vira `0`. "Sem registro" e uma afirmacao diferente de "zero", e
  // num relatorio que sai da Elyra a diferenca importa mais, nao menos.
  return v === null ? "sem registro" : `${v.toString().replace(".", ",")}${sufixo}`;
}

/**
 * A versao legivel por gente.
 *
 * Deliberadamente **descritiva**: relata medias, base amostral e periodo. Nao
 * conclui, nao qualifica e nao sugere conduta - quem le e quem interpreta. Toda
 * comparacao vem com quantos dias a sustentam, pelo mesmo motivo de sempre: uma
 * variacao sem amostra afirma mais do que o dado permite.
 */
export function renderReportExportText(envelope: ReportExportEnvelope): string {
  const { period, filters, report } = envelope;
  const linhas: string[] = [];

  linhas.push("Relatório Elyra");
  linhas.push("");
  linhas.push(
    `Período: ${br(period.from)} a ${br(period.to)} (${period.days} dias, ${
      period.kind === "custom" ? "personalizado" : "intervalo fixo"
    })`,
  );
  linhas.push(`Fuso horário: ${period.timeZone}`);
  linhas.push(
    `Gerado em: ${new Date(envelope.generatedAt).toLocaleString("pt-BR")}`,
  );
  linhas.push(
    `Métricas exibidas: ${
      filters.metrics.length > 0 ? filters.metrics.join(", ") : "nenhuma"
    }`,
  );
  linhas.push(`Ciclo incluído: ${filters.cycleIncluded ? "sim" : "não"}`);
  linhas.push("");


  const { dataset } = filters;
  const lista = (itens: ExportFilterItem[]) =>
    itens.length > 0 ? itens.map((i) => i.label).join(", ") : "sem recorte";

  linhas.push("Conjunto analisado");
  linhas.push(
    `- Domínios: ${
      dataset.domains.length > 0
        ? dataset.domains.map((d) => REPORT_DOMAIN_LABEL[d]).join(", ")
        : "nenhum"
    }`,
  );
  linhas.push(`- Dias com o fator registrado: ${lista(dataset.factors)}`);
  linhas.push(`- Dias com tag no diário: ${lista(dataset.journalTags)}`);
  linhas.push(
    `- Fase do ciclo (estimada): ${
      dataset.cyclePhases.length > 0
        ? dataset.cyclePhases.map((p) => PHASE_LABEL[p]).join(", ")
        : "sem recorte"
    }`,
  );
  if (
    dataset.factors.length > 0 ||
    dataset.journalTags.length > 0 ||
    dataset.cyclePhases.length > 0
  ) {
    // Um periodo menstrual e um intervalo informado, e nao uma metrica diaria:
    // recorta-lo pela metade produziria um periodo que a pessoa nunca registrou.
    linhas.push(
      "- Os períodos registrados não são recortados pelo filtro de dias; " +
        "eles descrevem a janela inteira.",
    );
  }
  linhas.push("");

  linhas.push("Médias do período");
  const metricas: Array<[string, keyof AnalyticsReport["metrics"], string]> = [
    ["Humor", "mood", "/10"],
    ["Ansiedade percebida", "anxiety", "/10"],
    ["Energia", "energy", "/10"],
  ];
  for (const [rotulo, chave, sufixo] of metricas) {
    const c = report.metrics[chave];
    linhas.push(
      `- ${rotulo}: ${valor(c.current, sufixo)} ` +
        `(${c.currentSamples} dia(s) com registro; período anterior: ` +
        `${valor(c.previous, sufixo)}, ${c.previousSamples} dia(s))`,
    );
  }
  linhas.push("");

  linhas.push("Cobertura de dados");
  linhas.push(`- Dias no período: ${report.dataQuality.daysInWindow}`);
  linhas.push(`- Dias com humor: ${report.dataQuality.daysWithMood}`);
  linhas.push(`- Dias com ansiedade percebida: ${report.dataQuality.daysWithAnxiety}`);
  linhas.push("");

  linhas.push(
    "Este relatório descreve registros feitos pela própria pessoa. Não é " +
      "avaliação, diagnóstico nem indicação de conduta. Dias sem registro " +
      "aparecem como ausência, e não como zero.",
  );

  return linhas.join("\n");
}
