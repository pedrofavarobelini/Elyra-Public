"use client";

import {
  Brain,
  ChevronDown,
  Download,
  Flower2,
  LineChart as LineChartIcon,
  Moon,
  Save,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Video,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

import { ChartCard } from "@/components/charts/chart-card";
import { formatSnapshotMoment, useOfflineSnapshot } from "@/components/offline/offline-context";
import { ComparisonCard } from "@/components/charts/comparison-card";
import {
  buildDayGroupAssociation,
  describeAssociation,
} from "@/lib/associations";
import { buildCrossDomainInputs } from "@/lib/cross-domain";
import {
  METRICAS_EXPLORAVEIS,
  explorar,
  metricaTitulo,
} from "@/lib/explore";
import { ChartLegend } from "@/components/charts/chart-legend";
import { hasAnyGap } from "@/components/charts/gaps";
import { EvolutionChart } from "@/components/charts/evolution-chart";
import { EmptyState } from "@/components/states";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageHeader, SectionHeader } from "@/components/journey/page-header";
import { HISTORY_DOMAINS, OlderHistoryNotice } from "@/components/journey/older-history";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NonClinicalNotice } from "@/components/ui/non-clinical-notice";
import type { ChartSeriesKey } from "@/components/charts/chart-theme";
import { CYCLE_PHASES, PHASE_LABEL } from "@/lib/contracts/cycle";
import { fromISODate } from "@/lib/cycle";
import {
  NO_REPORT_FILTERS,
  REPORT_DOMAINS,
  REPORT_DOMAIN_LABEL,
  applyReportFilters,
  hasDayFilter,
  hasReportFilter,
  type ReportFilterSelection,
} from "@/lib/report-filters";
import {
  buildAnalyticsReport,
  civilDateInTimeZone,
  comparePeriods,
  inclusiveDayCount,
  MIN_DAYS_FOR_ASSOCIATION,
  MIN_DAYS_FOR_COMPARISON,
} from "@/lib/reports";
import type { ElyraTextualOutput } from "@/lib/contracts/pedrocore";
import {
  MAX_CUSTOM_RANGE_DAYS,
  REPORT_RANGE_DAYS,
  customRangeRequestSchema,
} from "@/lib/contracts/reports";
import {
  buildReportExport,
  renderReportExportText,
} from "@/lib/reports-export";
import { cn, formatDuration, formatScore } from "@/lib/utils";
import { useMockStore } from "@/mocks/store";

/**
 * Relatorios e evolucao (figura 4).
 *
 * Toda metrica vem do contrato congelado em `src/lib/reports.ts`. O componente
 * apenas formata a saida; formula, minimo amostral e fuso nao vivem no React.
 *
 * Linguagem: os insights descrevem **coincidencia no tempo**. "Coincidiram com"
 * e "houve associacao temporal" sao formulacoes aprovadas; "causou" nao e.
 */

interface MetricFilter {
  key: ChartSeriesKey | "sessions";
  label: string;
  icon: typeof Smile;
  tone: "brand" | "anxiety" | "sleep" | "energy" | "cycle";
}

const FILTERS: MetricFilter[] = [
  { key: "mood", label: "Humor", icon: Smile, tone: "brand" },
  { key: "anxiety", label: "Ansiedade", icon: Brain, tone: "anxiety" },
  { key: "sleep", label: "Sono", icon: Moon, tone: "sleep" },
  { key: "energy", label: "Energia", icon: Zap, tone: "energy" },
  { key: "cycle", label: "Ciclo", icon: Flower2, tone: "cycle" },
  { key: "sessions", label: "Sessões", icon: Video, tone: "brand" },
];


const RANGES = REPORT_RANGE_DAYS.map((days) => ({
  days,
  label: `Últimos ${days} dias`,
}));

const SERIES_LABEL: Record<string, string> = {
  mood: "Humor",
  anxiety: "Ansiedade percebida",
  sleep: "Sono (horas)",
  energy: "Energia",
};

export function ReportsView() {
  const { checkins, sleep, periods, cycle, factors, tags, journal, goalProgress } =
    useMockStore();
  // OFF-3: no shell offline, os numeros vem da copia local; nunca parecer atual.
  const offlineSnapshot = useOfflineSnapshot();
  const dataUntil = offlineSnapshot ? formatSnapshotMoment(offlineSnapshot.savedAt) : null;

  const [active, setActive] = useState<Set<string>>(
    () => new Set(["mood", "anxiety", "cycle"]),
  );

  const [filtros, setFiltros] = useState<ReportFilterSelection>(
    () => NO_REPORT_FILTERS,
  );
  const [days, setDays] = useState<number>(28);

  const [metricaExplorada, setMetricaExplorada] = useState<
    (typeof METRICAS_EXPLORAVEIS)[number] | null
  >(null);
  /*
    Periodo personalizado. `null` significa "usando janela fixa" - e nao
    "personalizado vazio". Sao estados diferentes, e coloca-los na mesma
    variavel faria a tela nao saber qual periodo esta exibindo.
  */
  const [customFrom, setCustomFrom] = useState<string>("");
  const [customTo, setCustomTo] = useState<string>("");
  const [comparando, setComparando] = useState(false);
  const [baselineFrom, setBaselineFrom] = useState<string>("");
  const [baselineTo, setBaselineTo] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [aiConsent, setAiConsent] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState<ElyraTextualOutput | null>(null);
  const [trainingConsent, setTrainingConsent] = useState(false);
  const [contributing, setContributing] = useState(false);
  const [contributionStatus, setContributionStatus] = useState<string | null>(
    null,
  );
  /*
    Filtros avancados: `null` = a pessoa ainda nao abriu nem fechou, e o painel
    segue o estado do recorte (abre sozinho se ha filtro avancado ativo).
  */
  const [painelFiltrosAberto, setPainelFiltrosAberto] = useState(false);
  const [avancadoManual, setAvancadoManual] = useState<boolean | null>(null);

  // O consentimento de treino e lido da fonte, nunca presumido. Sem ele a acao
  // de contribuir nem aparece - e o servidor recusaria de qualquer forma.
  useEffect(() => {
    let active = true;
    void fetch("/api/learning/consent")
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: { enabled: boolean };
        };
        if (active && response.ok && payload.data) {
          setTrainingConsent(payload.data.enabled);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hoje = civilDateInTimeZone(new Date(), timeZone);


  const periodoPersonalizado =
    customFrom && customTo
      ? customRangeRequestSchema.safeParse({
          from: customFrom,
          to: customTo,
          timeZone,
        })
      : null;
  const personalizadoValido =
    periodoPersonalizado?.success === true ? periodoPersonalizado.data : null;
  const erroPeriodo =
    periodoPersonalizado && !periodoPersonalizado.success
      ? (periodoPersonalizado.error.issues[0]?.message ??
        "Período inválido.")
      : null;

  const referenceDate = personalizadoValido?.to ?? hoje;
  const diasDaJanela = personalizadoValido
    ? inclusiveDayCount(personalizadoValido.from, personalizadoValido.to)
    : days;

  /*
    O recorte acontece **antes** do motor, e nunca dentro dele.

    `applyReportFilters` devolve a mesma forma de entrada que o motor ja
    consumia, entao dominio, fator, tag e fase alcancam de fato os numeros do
    relatorio - e continuam passando pela unica regra de calculo que existe.
    Nenhuma media e computada aqui.
  */
  const analitico = applyReportFilters({
    selection: filtros,
    timeZone,
    checkins,
    sleep,
    periods,
    journal,
    cycleEnabled: cycle.enabled,
  });

  const report = buildAnalyticsReport({
    referenceDate,
    days: diasDaJanela,
    timeZone,
    checkins: analitico.checkins,
    sleep: analitico.sleep,
    periods: analitico.periods,
    cycleEnabled: analitico.cycleEnabled,
  });

  /*
    Comparacao entre dois periodos escolhidos. So existe quando os dois sao
    validos: comparar contra um intervalo malformado produziria um delta que
    ninguem sabe explicar.
  */
  const baseline =
    baselineFrom && baselineTo
      ? customRangeRequestSchema.safeParse({
          from: baselineFrom,
          to: baselineTo,
          timeZone,
        })
      : null;
  const comparacaoEntrePeriodos =
    personalizadoValido && baseline?.success
      ? comparePeriods({
          timeZone,
          // Os dois lados da comparacao usam o **mesmo** recorte. Comparar um
          // periodo filtrado contra um periodo inteiro devolveria um delta que
          // mede o filtro, e nao o tempo.
          checkins: analitico.checkins,
          sleep: analitico.sleep,
          current: { from: personalizadoValido.from, to: personalizadoValido.to },
          baseline: { from: baseline.data.from, to: baseline.data.to },
        })
      : null;
  const { window } = report;

  // Coocorrencia entre dominios. Fica **fora** do `AnalyticsReport` de proposito:
  // aquele artefato vira snapshot e e validado pelo contrato do Veltrix, cujo
  // bloco `associations` e `.strict()`. Acrescentar cruzamentos la quebraria a
  // validacao de todo snapshot existente - e ampliar aquele contrato exige

  const cruzamentosBase = buildCrossDomainInputs({
    window,
    timeZone,
    // Mesmo conjunto do relatorio. A serie que da a metrica ja veio filtrada;
    // cruzar com registros que ficaram de fora descreveria dois conjuntos.
    checkins: analitico.checkins,
    sleep: analitico.sleep,
    factors,
    journal,
    goalProgress,
  });


  const cruzamentos = explorar(cruzamentosBase, metricaExplorada).map((entrada) =>
    buildDayGroupAssociation(report.series, entrada),
  );

  const toggle = (key: string) =>
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const chartSeries = (["mood", "anxiety", "sleep", "energy"] as const)
    .filter((k) => active.has(k))
    .map((k) => ({ key: k as ChartSeriesKey, label: SERIES_LABEL[k] as string }));

  const data = report.series.map((point) => ({
    label: shortLabel(point.date),
    mood: point.mood,
    anxiety: point.anxiety,
    energy: point.energy,
    sleep: point.sleepHours,
  }));

  const bands =
    active.has("cycle") && cycle.enabled
      ? report.cycle.registeredBands.map((b) => ({
          from: shortLabel(b.from),
          to: shortLabel(b.to),
        }))
      : [];

  const mood = report.metrics.mood;
  const anxiety = report.metrics.anxiety;
  const energy = report.metrics.energy;
  const sleepDuration = report.metrics.sleepDurationMinutes;
  const menstruation = report.cycle.registeredMenstruationDays;
  const association = report.associations.prePeriodEnergy;

  /**
   * O snapshot so pode ser salvo quando descreve **exatamente** o que esta na
   * tela.
   *
   * O servidor persiste um snapshot a partir de `{days, referenceDate,
   * timeZone}` - e mais nada. Ele nao recebe filtro, e nao recebe as pontas de um
   * periodo personalizado. Entao qualquer estado que recorte o relatorio produz,
   * do outro lado, um artefato que descreve um conjunto diferente do que a
   * pessoa esta lendo. E esse artefato e justamente o unico que pode alcancar o
   * Veltrix e virar candidato de aprendizado.
   *
   * A trava vale para os tres caminhos que persistem snapshot - salvar,
   * interpretar e contribuir -, e nao so para o botao de salvar: bloquear um e
   * deixar os outros dois passarem so esconderia o problema no caminho menos
   * visivel.
   */
  const relatorioRecortado = Boolean(personalizadoValido) || hasReportFilter(filtros);

  const persistSnapshot = async () => {
    if (relatorioRecortado) {
      throw new Error(
        "Este relatório está recortado por período ou filtro. Volte ao intervalo fixo e retire os filtros para salvá-lo.",
      );
    }
    const response = await fetch("/api/reports/snapshots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days, referenceDate, timeZone }),
    });
    const result = (await response.json()) as {
      data?: { id: string; payload: unknown };
      error?: string;
    };
    if (!response.ok || !result.data) {
      throw new Error(result.error ?? "Não foi possível salvar o relatório.");
    }
    return result.data;
  };

  const exportReport = async () => {
    setExporting(true);
    setExportStatus(null);
    try {
      const snapshot = await persistSnapshot();
      const blob = new Blob([JSON.stringify(snapshot.payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `elyra-relatorio-${window.from}-${window.to}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportStatus("Relatório exportado e snapshot imutável salvo.");
    } catch (error) {
      setExportStatus(
        error instanceof Error ? error.message : "Falha ao exportar o relatório.",
      );
    } finally {
      setExporting(false);
    }
  };

  const interpretWithAi = async () => {
    if (!aiConsent) {
      setAiStatus("Autorize explicitamente a interpretação antes de continuar.");
      return;
    }
    setAiLoading(true);
    setAiStatus(null);
    setAiInsight(null);
    try {
      const snapshot = await persistSnapshot();
      const response = await fetch("/api/reports/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportSnapshotId: snapshot.id,
          idempotencyKey: crypto.randomUUID(),
          aiInferenceConsent: true,
        }),
      });
      const result = (await response.json()) as {
        data?: { output: ElyraTextualOutput };
        error?: string;
      };
      if (!response.ok || !result.data) {
        throw new Error(result.error ?? "A interpretação por IA está indisponível.");
      }
      setAiInsight(result.data.output);
      setAiStatus("Interpretação não clínica concluída e salva separadamente.");
    } catch (error) {
      setAiStatus(
        error instanceof Error
          ? error.message
          : "A interpretação por IA está indisponível. O relatório continua funcionando.",
      );
    } finally {
      setAiLoading(false);
    }
  };

  /**
   * Contribui com este relatorio para melhoria da IA.
   *
   * A tela **nao** decide elegibilidade. Ela salva o snapshot imutavel e pede o
   * export; quem avalia consentimento vigente, elegibilidade, minimizacao,
   * sanitizacao, proveniencia, fingerprint e quality gate e
   * `exportSnapshotForLearning`. Uma recusa aqui e resultado normal e vira
   * registro de governanca, nao erro escondido.
   */
  const contributeForLearning = async () => {
    setContributing(true);
    setContributionStatus(null);
    try {
      const snapshot = await persistSnapshot();
      const response = await fetch("/api/learning/exports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportSnapshotId: snapshot.id }),
      });
      const result = (await response.json()) as {
        data?: {
          status: string;
          replayed: boolean;
          rejectionCode: string | null;
        };
        error?: string;
      };
      if (!response.ok || !result.data) {
        throw new Error(result.error ?? "Não foi possível contribuir.");
      }
      const { status, replayed, rejectionCode } = result.data;
      setContributionStatus(
        status === "exported" && replayed
          ? "Este relatório já havia sido contribuído. Nenhuma cópia nova foi criada."
          : status === "exported"
            ? "Relatório contribuído como candidato governado. Você pode revogar quando quiser."
            : status === "rejected"
              ? `Este relatório não ficou elegível (${rejectionCode ?? "sem detalhe"}). Nada foi enviado.`
              : "Contribuição registrada e aguardando avaliação.",
      );
    } catch (error) {
      setContributionStatus(
        error instanceof Error ? error.message : "Não foi possível contribuir.",
      );
    } finally {
      setContributing(false);
    }
  };

  /**
   * Baixa o relatorio como arquivo.
   *
   * Dois formatos porque servem a leitores diferentes: `.txt` para uma pessoa
   * ler, `.json` para outro sistema processar. Os dois carregam o **mesmo**
   * envelope - quando foi gerado, que periodo cobre e que filtros estavam
   * aplicados -, porque relatorio sem procedencia e dado solto, e a partir daqui
   * ele pode chegar a outra pessoa.
   *
   * Nao cria snapshot: baixar e ler, nao publicar. Snapshot e o artefato que
   * pode alcancar o Veltrix, e continua restrito as janelas do contrato.
   */
  const baixarRelatorio = (formato: "txt" | "json") => {
    const envelope = buildReportExport({
      report,
      generatedAt: new Date(),
      periodKind: personalizadoValido ? "custom" : "fixed",
      metrics: [...active].filter((chave) => chave !== "cycle"),
      cycleIncluded: active.has("cycle") && analitico.cycleEnabled,

      // tinha quando filtro ainda nao existia. Um export que declarasse metade
      // do contexto afirmaria procedencia que nao tem.
      filters: filtros,
      labels: {
        factors: Object.fromEntries(factors.map((f) => [f.id, f.label])),
        journalTags: Object.fromEntries(tags.map((t) => [t.id, t.label])),
      },
    });

    const conteudo =
      formato === "txt"
        ? renderReportExportText(envelope)
        : JSON.stringify(envelope, null, 2);
    const tipo = formato === "txt" ? "text/plain" : "application/json";

    const url = URL.createObjectURL(new Blob([conteudo], { type: `${tipo};charset=utf-8` }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `elyra-relatorio-${envelope.period.from}-a-${envelope.period.to}.${formato}`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filtrosAvancadosAtivos =
    filtros.factorIds.length +
    filtros.journalTagIds.length +
    filtros.cyclePhases.length +
    (customFrom || customTo ? 1 : 0);
  const avancadoAberto = avancadoManual ?? filtrosAvancadosAtivos > 0;

  /*
    Ausencia centralizada: sem nenhum registro no periodo, uma explicacao unica
    substitui a grade de cards "Sem registro" e o grafico de eixos vazios. Com
    qualquer dado, tudo volta a aparecer com a propria base amostral.
  */
  const periodoVazio = [mood, anxiety, energy, sleepDuration].every(
    (comparison) => comparison.current === null && comparison.previous === null,
  );
  const graficoSemDado = !data.some((point) =>
    chartSeries.some(({ key }) => {
      const value = (point as Record<string, unknown>)[key];
      return value !== null && value !== undefined;
    }),
  );

  const filtrosAtivosTotal =
    filtros.domains.length + filtrosAvancadosAtivos;

  const conjuntoAnalisado = () => (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-subtle">
        Conjunto analisado
      </legend>
      <p className="mb-2 text-sm text-ink-muted">
        Estes filtros mudam os números, e não apenas o gráfico. Cada
        dimensão combina por &quot;ou&quot;; entre dimensões, por &quot;e&quot;.
      </p>
      <FilterGroup label="Domínios">
        {REPORT_DOMAINS.map((dominio) => (
          <FilterChip
            key={dominio}
            label={REPORT_DOMAIN_LABEL[dominio]}
            on={filtros.domains.includes(dominio)}
            onClick={() =>
              setFiltros((atual) => ({
                ...atual,
                domains: alternar(atual.domains, dominio),
              }))
            }
          />
        ))}
      </FilterGroup>
    </fieldset>
  );

  const recorteAvancado = (prefix: string) => (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="grid content-start gap-4">
        {factors.length > 0 ? (
          <FilterGroup label="Dias em que registrei o fator">
            {factors.map((fator) => (
              <FilterChip
                key={fator.id}
                label={fator.label}
                on={filtros.factorIds.includes(fator.id)}
                onClick={() =>
                  setFiltros((atual) => ({
                    ...atual,
                    factorIds: alternar(atual.factorIds, fator.id),
                  }))
                }
              />
            ))}
          </FilterGroup>
        ) : null}

        {tags.length > 0 ? (
          <FilterGroup label="Dias com entrada de diário marcada com">
            {tags.map((tag) => (
              <FilterChip
                key={tag.id}
                label={tag.label}
                on={filtros.journalTagIds.includes(tag.id)}
                onClick={() =>
                  setFiltros((atual) => ({
                    ...atual,
                    journalTagIds: alternar(atual.journalTagIds, tag.id),
                  }))
                }
              />
            ))}
          </FilterGroup>
        ) : null}

        {/*
          Fase so aparece com o acompanhamento de ciclo ligado. Oferecer o
          controle sem base para derivar entregaria um filtro que sempre
          devolve vazio, e a pessoa leria isso como "nao tenho registro".
        */}
        {cycle.enabled ? (
          <FilterGroup label="Fase do ciclo (estimada)">
            {CYCLE_PHASES.map((fase) => (
              <FilterChip
                key={fase}
                label={PHASE_LABEL[fase]}
                on={filtros.cyclePhases.includes(fase)}
                onClick={() =>
                  setFiltros((atual) => ({
                    ...atual,
                    cyclePhases: alternar(atual.cyclePhases, fase),
                  }))
                }
              />
            ))}
          </FilterGroup>
        ) : null}

        {hasDayFilter(filtros) ? (
          <p className="text-xs text-ink-subtle">
            O recorte por dias não divide os períodos registrados: eles
            continuam descrevendo a janela inteira. Um período é um intervalo
            informado, e não uma medida diária.
          </p>
        ) : null}
      </div>

      <fieldset className="min-w-0 rounded-card border border-line bg-surface p-4">
        <legend className="px-1 text-sm font-semibold text-ink">
          Período personalizado
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor={`${prefix}custom-from`} className="text-xs">De</Label>
            <Input
              id={`${prefix}custom-from`}
              type="date"
              max={hoje}
              value={customFrom}
              onChange={(event) => setCustomFrom(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`${prefix}custom-to`} className="text-xs">Até</Label>
            <Input
              id={`${prefix}custom-to`}
              type="date"
              max={hoje}
              value={customTo}
              onChange={(event) => setCustomTo(event.target.value)}
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {customFrom || customTo ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setCustomFrom("");
                setCustomTo("");
                setComparando(false);
                setBaselineFrom("");
                setBaselineTo("");
              }}
            >
              Voltar ao intervalo fixo
            </Button>
          ) : null}
          {personalizadoValido ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setComparando((atual) => !atual)}
            >
              {comparando ? "Ocultar comparação" : "Comparar com outro período"}
            </Button>
          ) : null}
        </div>

        {/*
          Erro de periodo nao troca o relatorio exibido: a tela continua na
          janela fixa e diz o que esta errado.
        */}
        {erroPeriodo ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {erroPeriodo} O relatório continua no intervalo fixo.
          </p>
        ) : null}

        <p className="mt-2 text-xs text-ink-subtle">
          O período personalizado usa a mesma regra de cálculo do intervalo
          fixo, cobre no máximo {MAX_CUSTOM_RANGE_DAYS} dias e não é salvo
          como relatório exportável.
        </p>

        {comparando && personalizadoValido ? (
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 text-xs font-medium text-ink-muted">
              Comparar com
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor={`${prefix}baseline-from`} className="text-xs">De</Label>
                <Input
                  id={`${prefix}baseline-from`}
                  type="date"
                  max={hoje}
                  value={baselineFrom}
                  onChange={(event) => setBaselineFrom(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor={`${prefix}baseline-to`} className="text-xs">Até</Label>
                <Input
                  id={`${prefix}baseline-to`}
                  type="date"
                  max={hoje}
                  value={baselineTo}
                  onChange={(event) => setBaselineTo(event.target.value)}
                />
              </div>
            </div>

            {comparacaoEntrePeriodos ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <ComparisonCard
                  label="Humor médio"
                  comparison={comparacaoEntrePeriodos.mood}
                  format={(v) => formatScore(v) ?? "—"}
                  unit="/10"
                  tone="brand"
                  icon={<Smile />}
                  higherIsBetter
                />
                <ComparisonCard
                  label="Ansiedade média"
                  comparison={comparacaoEntrePeriodos.anxiety}
                  format={(v) => formatScore(v) ?? "—"}
                  unit="/10"
                  tone="anxiety"
                  icon={<Brain />}
                  higherIsBetter={false}
                />
                <ComparisonCard
                  label="Energia média"
                  comparison={comparacaoEntrePeriodos.energy}
                  format={(v) => formatScore(v) ?? "—"}
                  unit="/10"
                  tone="energy"
                  icon={<Zap />}
                  higherIsBetter
                />
                <ComparisonCard
                  label="Sono médio"
                  comparison={comparacaoEntrePeriodos.sleepHours}
                  format={(v) => formatDuration(Math.round(v * 60)) ?? "—"}
                  formatDelta={(v) =>
                    formatDuration(Math.round(Math.abs(v) * 60)) ?? "—"
                  }
                  tone="sleep"
                  icon={<Moon />}
                  higherIsBetter
                />
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-subtle">
                Escolha as duas datas do período de comparação. Os períodos
                podem ter tamanhos diferentes — a base amostral de cada lado
                acompanha o resultado.
              </p>
            )}
          </div>
        ) : null}
      </fieldset>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Relatórios e evolução"
        description="Acompanhe seus padrões ao longo do tempo e entenda como eles se conectam com o seu ciclo."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="range" className="text-sm text-ink-muted">
              Intervalo
            </Label>
            <select
              id="range"
              value={days}
              disabled={Boolean(personalizadoValido)}
              onChange={(e) => setDays(Number(e.target.value))}
              className="h-11 rounded-control border border-line-input bg-surface px-3 text-base text-ink disabled:opacity-60 lg:h-10 lg:text-sm"
            >
              {RANGES.map((r) => (
                <option key={r.days} value={r.days}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {/*
        Barra de recorte. O que muda o GRAFICO (metricas exibidas) e o que muda
        os NUMEROS (conjunto analisado) continuam separados — a Era 3 registrou
        por que chamar as duas coisas de "filtro" confundia. Basico sempre
        visivel; o recorte fino fica em divulgacao progressiva, que abre sozinha
        quando algum recorte avancado esta ativo.
      */}
      {/*
        VALUE FIRST, CONTROLS SECOND abaixo de lg: no celular o grafico e a
        visao geral vem antes dos filtros. No desktop a barra de recorte fica
        acima, compacta, porque cabe ao lado do conteudo sem empurra-lo.
      */}
      <OlderHistoryNotice domains={HISTORY_DOMAINS.reports} />

      <div className="flex flex-col">
      {/*
        R2 (homologacao fisica): no celular o recorte deixou de ser uma pagina de
        filtros. Ficam visiveis so as metricas do grafico e um resumo; conjunto
        analisado, fator/tag/fase e periodo personalizado abrem num painel
        inferior. No desktop o recorte segue em linha, com divulgacao progressiva.
        Mesmo estado, mesmas funcoes: so a apresentacao muda.
      */}
      <Card className="order-3 mb-5 lg:hidden">
        <div className="grid gap-4 p-4 sm:p-5">
          <fieldset className="min-w-0">
            <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-subtle">
              Métricas exibidas no gráfico
            </legend>
            <div className="flex flex-wrap items-center gap-2">
              {FILTERS.map(({ key, label, icon: Icon, tone }) => {
                const unavailable = key === "sessions";
                const on = active.has(key) && !unavailable;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={on}
                    disabled={unavailable}
                    title={unavailable ? "Esta métrica não entra neste relatório." : undefined}
                    onClick={() => toggle(key)}
                    className={cn(
                      "flex min-h-11 items-center gap-2 rounded-pill border py-1 pl-1 pr-3.5 text-sm font-medium transition-colors duration-150 lg:min-h-10",
                      unavailable
                        ? "cursor-not-allowed border-line bg-surface-muted text-ink-subtle"
                        : on
                          ? "border-brand-300 bg-brand-100 text-brand-700"
                          : "border-line-strong bg-surface text-ink-muted hover:border-brand-200 hover:bg-surface-brand",
                    )}
                  >
                    <IconPill tone={tone} size="sm">
                      <Icon />
                    </IconPill>
                    {label}
                    {on ? (
                      <X className="size-3.5 text-brand-600" aria-hidden="true" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="soft"
              aria-haspopup="dialog"
              onClick={() => setPainelFiltrosAberto(true)}
            >
              <SlidersHorizontal aria-hidden="true" />
              Filtros avançados
              {filtrosAtivosTotal > 0 ? (
                <span className="rounded-pill bg-brand-600 px-1.5 text-xs font-semibold text-white">
                  {filtrosAtivosTotal}
                </span>
              ) : null}
            </Button>
            {hasReportFilter(filtros) ? (
              <Button variant="secondary" onClick={() => setFiltros(NO_REPORT_FILTERS)}>
                Limpar filtros
              </Button>
            ) : null}
          </div>
          {hasReportFilter(filtros) ? (
            <p className="rounded-control bg-attention-soft px-3 py-2 text-sm text-attention">
              Relatório filtrado não é salvo como relatório exportável.
            </p>
          ) : null}
        </div>
      </Card>

      <Dialog open={painelFiltrosAberto} onOpenChange={setPainelFiltrosAberto}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Filtros do relatório</DialogTitle>
            <DialogDescription>
              O resultado atualiza enquanto você escolhe.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-5">
            {conjuntoAnalisado()}
            {recorteAvancado("m-")}
          </div>
          <div className="sticky -bottom-5 -mx-5 mt-5 flex flex-wrap justify-end gap-2 border-t border-line bg-surface px-5 pb-1 pt-3">
            {hasReportFilter(filtros) || customFrom || customTo ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setFiltros(NO_REPORT_FILTERS);
                  setCustomFrom("");
                  setCustomTo("");
                  setComparando(false);
                  setBaselineFrom("");
                  setBaselineTo("");
                }}
              >
                Limpar tudo
              </Button>
            ) : null}
            <DialogClose asChild>
              <Button>Ver resultado</Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>

      <Card className="mb-5 hidden lg:order-1 lg:block">
        <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
          <div className="grid gap-4">
            <fieldset className="min-w-0">
              <legend className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-subtle">
                Métricas exibidas no gráfico
              </legend>
              <div className="flex flex-wrap items-center gap-2">
                {FILTERS.map(({ key, label, icon: Icon, tone }) => {
                  const unavailable = key === "sessions";
                  const on = active.has(key) && !unavailable;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      disabled={unavailable}
                      title={unavailable ? "Esta métrica não entra neste relatório." : undefined}
                      onClick={() => toggle(key)}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-pill border py-1 pl-1 pr-3.5 text-sm font-medium transition-colors duration-150 lg:min-h-10",
                        unavailable
                          ? "cursor-not-allowed border-line bg-surface-muted text-ink-subtle"
                          : on
                            ? "border-brand-300 bg-brand-100 text-brand-700"
                            : "border-line-strong bg-surface text-ink-muted hover:border-brand-200 hover:bg-surface-brand",
                      )}
                    >
                      <IconPill tone={tone} size="sm">
                        <Icon />
                      </IconPill>
                      {label}
                      {on ? (
                        <X className="size-3.5 text-brand-600" aria-hidden="true" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {conjuntoAnalisado()}
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
            <Button
              variant="soft"
              aria-expanded={avancadoAberto}
              aria-controls="filtros-avancados"
              onClick={() => setAvancadoManual((aberto) => !(aberto ?? avancadoAberto))}
            >
              <SlidersHorizontal aria-hidden="true" />
              Filtros avançados
              {filtrosAvancadosAtivos > 0 ? (
                <span className="rounded-pill bg-brand-600 px-1.5 text-xs font-semibold text-white">
                  {filtrosAvancadosAtivos}
                </span>
              ) : null}
              <ChevronDown
                aria-hidden="true"
                className={cn("transition-transform duration-200", avancadoAberto && "rotate-180")}
              />
            </Button>
            {hasReportFilter(filtros) ? (
              <Button
                variant="secondary"
                onClick={() => setFiltros(NO_REPORT_FILTERS)}
              >
                Limpar filtros
              </Button>
            ) : null}
          </div>
        </div>

        {hasReportFilter(filtros) ? (
          <p className="mx-4 mb-4 rounded-control bg-attention-soft px-3 py-2 text-sm text-attention sm:mx-5">
            Relatório filtrado não é salvo como relatório exportável.
          </p>
        ) : null}

        <div
          id="filtros-avancados"
          hidden={!avancadoAberto}
          className="border-t border-line bg-surface-muted/50 p-4 sm:p-5"
        >
          {recorteAvancado("")}
        </div>
      </Card>

      <ChartCard
        className="order-1 mb-5 lg:order-2"
        title="Evolução ao longo do tempo"
        description={`${formatDate(window.from)} a ${formatDate(window.to)} · ${report.dataQuality.daysInWindow} dias${dataUntil ? ` · dados deste aparelho até ${dataUntil}` : ""}`}
        hint="Dias sem registro aparecem como lacuna e não são estimados."
      >
        {chartSeries.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">
            Selecione ao menos uma métrica para ver a evolução.
          </p>
        ) : graficoSemDado ? (
          <EmptyState
            size="compact"
            icon={<LineChartIcon />}
            title="Nenhum registro das métricas escolhidas neste período"
            description="A linha aparece a partir dos seus check-ins e registros de sono. Dias sem registro ficam como lacuna, nunca como zero."
          />
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
              <ChartLegend
                items={chartSeries}
                showGap={hasAnyGap(data, chartSeries.map((s) => s.key))}
              />
              {bands.length > 0 ? (
                <span className="flex items-center gap-2 text-xs text-ink-muted">
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 rounded-sm bg-cycle-soft"
                  />
                  Período menstrual
                </span>
              ) : null}
            </div>
            <EvolutionChart
              data={data}
              series={chartSeries}
              cycleBands={bands}
              sessionLabels={[]}
            />
          </>
        )}
      </ChartCard>

      <div className="order-2 lg:order-3">
      <SectionHeader
        title="Visão geral do período"
        description="Cada média é comparada ao período anterior de mesmo tamanho, sempre com o seu próprio histórico."
      />
      <section
        aria-label="Resumo do período"
        className="mb-5 grid gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-3"
      >
        {periodoVazio ? (
          <EmptyState
            size="compact"
            className="sm:col-span-2 xl:col-span-3"
            title="Sem registros neste período"
            description={`As médias de humor, ansiedade, energia e sono aparecem com registros, e as tendências com ao menos ${MIN_DAYS_FOR_COMPARISON} dias em cada período.`}
          />
        ) : (
        <>
        <ComparisonCard
          label="Humor médio"
          comparison={mood}
          format={(v) => `${formatScore(v)}`}
          unit="/10"
          tone="brand"
          icon={<Smile />}
          higherIsBetter
        />
        <ComparisonCard
          label="Ansiedade média"
          comparison={anxiety}
          format={(v) => `${formatScore(v)}`}
          unit="/10"
          tone="anxiety"
          icon={<Brain />}
          higherIsBetter={false}
        />
        <ComparisonCard
          label="Sono médio"
          comparison={sleepDuration}
          format={(v) => formatDuration(Math.round(v)) ?? "—"}
          formatDelta={(v) => formatDuration(Math.round(Math.abs(v))) ?? "—"}
          tone="sleep"
          icon={<Moon />}
          higherIsBetter
        />
        <ComparisonCard
          label="Energia média"
          comparison={energy}
          format={(v) => `${formatScore(v)}`}
          unit="/10"
          tone="energy"
          icon={<Zap />}
          higherIsBetter
        />

        <Card role="group" aria-label="Dias em menstruação" className="flex items-start gap-3 p-4 sm:gap-4">
          <IconPill tone="cycle">
            <Flower2 />
          </IconPill>
          <div>
            <p className="text-sm text-ink-muted">Dias em menstruação</p>
            {menstruation === null ? (
              <p className="mt-1 text-sm text-ink-subtle">
                Acompanhamento desativado
              </p>
            ) : (
              <>
                <p className="mt-0.5 text-2xl font-semibold tabular-nums tracking-tight text-ink">
                  {menstruation}
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  de {report.dataQuality.daysInWindow} dias
                </p>
              </>
            )}
          </div>
        </Card>

        <Card role="group" aria-label="Sessões realizadas" className="flex items-start gap-3 p-4 sm:gap-4">
          <IconPill tone="brand">
            <Sparkles />
          </IconPill>
          <div>
            <p className="text-sm text-ink-muted">Sessões realizadas</p>
            <p className="mt-1 text-sm text-ink-subtle">
              Não entra neste relatório
            </p>
          </div>
        </Card>
        </>
        )}
      </section>
      </div>
      </div>

      {/*
        Layout (L-402): analises em largura total; depois, lado a lado e com a
        mesma altura, "Sobre os insights" e "Exportar e salvar". Antes o rail de
        4/12 terminava antes (ou depois) da coluna principal e deixava espaco morto.
      */}
      <div className="grid gap-5">
        {/* Insights deterministicos e coocorrencias. */}
        <div className="grid content-start gap-5">
          <Card>
            <CardContent>
              <h2 className="text-base font-semibold text-ink lg:text-lg">
                Insights do seu período
              </h2>
              <p className="mt-0.5 text-sm text-ink-muted">
                Análises baseadas nos seus registros dos últimos {report.dataQuality.daysInWindow}{" "}
                dias.
              </p>
              {dataUntil ? (
                <p data-testid="report-data-until" className="mt-2 rounded-control bg-attention-soft px-3 py-2 text-sm text-ink">
                  Sem conexão: dados disponíveis até {dataUntil}. O que foi registrado em outro aparelho depois disso
                  ainda não aparece aqui.
                </p>
              ) : null}

              <ul className="mt-4 grid gap-3 lg:grid-cols-2">
                <InsightCard
                  tone="cycle"
                  icon={<Flower2 />}
                  title={
                    !cycle.enabled
                      ? "Acompanhamento do ciclo desativado"
                      : association.status === "available"
                      ? association.delta !== null && association.delta < 0
                        ? "Os dias anteriores ao período coincidiram com energia média menor"
                        : association.delta !== null && association.delta > 0
                          ? "Os dias anteriores ao período coincidiram com energia média maior"
                          : "A energia ficou estável nos dias anteriores ao período"
                      : "Dados insuficientes para associar ciclo e energia"
                  }
                  body={
                    !cycle.enabled
                      ? "Ative o acompanhamento para incluir períodos registrados nas associações temporais. Os dados preservados não são analisados enquanto ele estiver desligado."
                      : association.status === "available"
                      ? `A comparação usa ${association.beforePeriodSamples} dias antes de inicios registrados e ${association.otherDaysSamples} outros dias. E uma associação temporal, não uma causa.`
                      : `A leitura exige ao menos ${MIN_DAYS_FOR_ASSOCIATION} dias com energia em cada grupo. Ainda não dá para afirmar uma associação - o que não significa que não exista.`
                  }
                />
                <InsightCard
                  tone="brand"
                  icon={<Sparkles />}
                  title="Base de comparação transparente"
                  body={`Cada comparação declara em quantos dias ela se apoia. Tendência só aparece com ao menos ${MIN_DAYS_FOR_COMPARISON} dias com registro em cada período - abaixo disso a tela diz que não dá para afirmar, e não que não há padrão.`}
                />
              </ul>
            </CardContent>
          </Card>

          {cruzamentos.length > 0 ? (
            <Card>
              <CardContent>
                <h2 className="text-base font-semibold text-ink lg:text-lg">
                  O que apareceu junto
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  Estas leituras descrevem <strong>coincidência no tempo</strong>{" "}
                  entre registros seus. Elas não explicam por que, e não indicam
                  causa.
                </p>

                {/*
                  Era 8 (8.10): a pessoa escolhe a pergunta. Os dias agrupados
                  sao os mesmos; muda a metrica observada — e o aviso de
                  coincidencia acima continua valendo para todas.
                */}
                <div
                  role="group"
                  aria-label="Olhar estes cruzamentos por"
                  className="mt-3 flex flex-wrap gap-2"
                >
                  <button
                    type="button"
                    onClick={() => setMetricaExplorada(null)}
                    aria-pressed={metricaExplorada === null}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-control border px-3 text-sm font-medium",
                      metricaExplorada === null
                        ? "border-brand-300 bg-brand-100 text-brand-700"
                        : "border-line bg-surface text-ink",
                    )}
                  >
                    Sugeridas
                  </button>
                  {METRICAS_EXPLORAVEIS.map((metrica) => (
                    <button
                      key={metrica}
                      type="button"
                      onClick={() => setMetricaExplorada(metrica)}
                      aria-pressed={metricaExplorada === metrica}
                      className={cn(
                        "inline-flex min-h-11 items-center rounded-control border px-3 text-sm font-medium",
                        metricaExplorada === metrica
                          ? "border-brand-300 bg-brand-100 text-brand-700"
                          : "border-line bg-surface text-ink",
                      )}
                    >
                      {metricaTitulo(metrica)}
                    </button>
                  ))}
                </div>
                <ul className="mt-4 grid gap-3 lg:grid-cols-2">
                  {cruzamentos.map((cruzamento) => (
                    <li key={cruzamento.id}>
                      <article
                        aria-label={cruzamento.question}
                        className="h-full rounded-control border border-line bg-surface-muted/60 p-4"
                      >
                        <h3 className="text-sm font-semibold text-ink">
                          {cruzamento.question}
                        </h3>
                        <p className="mt-1 text-sm text-ink-muted">
                          {describeAssociation(cruzamento)}
                        </p>
                        {cruzamento.status === "available" ? (
                          <p className="mt-2 text-xs text-ink-subtle">
                            {cruzamento.withGroup.label}:{" "}
                            {cruzamento.withGroup.samples} dias · {" "}
                            {cruzamento.withoutGroup.label}:{" "}
                            {cruzamento.withoutGroup.samples} dias
                          </p>
                        ) : null}
                      </article>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {aiInsight ? (
            <Card aria-label="Interpretação do PedroCore">
              <CardContent>
                <h2 className="text-base font-semibold text-ink lg:text-lg">
                  Interpretação não clínica
                </h2>
                <p className="mt-2 text-sm text-ink-muted">{aiInsight.summary}</p>
                <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-ink-muted">
                  {aiInsight.observations.map((observation) => (
                    <li key={`${observation.evidencePath}-${observation.text}`}>
                      {observation.text}
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-xs text-ink-subtle">
                  {aiInsight.disclaimer}
                </p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* Rail: interpretacao consentida e exportacao. */}
        <aside className="grid items-stretch gap-5 lg:grid-cols-2" aria-label="Interpretação e exportação">
          <Card className="border-brand-200 bg-surface-brand">
            <CardContent>
              <h2 className="text-base font-semibold text-brand-800">
                Sobre os insights
              </h2>
              <p className="mt-2 text-sm text-brand-800">
                Estas leituras são calculadas de forma determinística a partir dos
                seus registros. As comparações usam a sua média pessoal, nunca uma
                norma populacional ou uma resposta de IA.
              </p>
              {dataUntil ? (
                <p className="mt-2 text-sm font-medium text-brand-800">Calculado com os dados disponíveis até {dataUntil}.</p>
              ) : null}
              <NonClinicalNotice context="report" className="mt-4 bg-surface" />

              <div className="mt-5 border-t border-brand-200 pt-4">
                <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-brand-900">
                  <input
                    type="checkbox"
                    checked={aiConsent}
                    onChange={(event) => setAiConsent(event.target.checked)}
                    className="mt-0.5 size-5 shrink-0 accent-brand-600"
                  />
                  <span>
                    Autorizo o envio deste snapshot minimizado ao PedroCore para uma
                    interpretação não clínica.
                  </span>
                </label>
                <Button
                  variant="primary"
                  className="mt-3 w-full"
                  disabled={aiLoading || relatorioRecortado}
                  onClick={interpretWithAi}
                >
                  <Sparkles aria-hidden="true" />
                  {aiLoading ? "Interpretando..." : "Interpretar com IA"}
                </Button>
                {aiStatus ? (
                  <p role="status" className="mt-3 text-sm text-brand-800">
                    {aiStatus}
                  </p>
                ) : null}
              </div>

              {trainingConsent ? (
                <div className="mt-5 border-t border-brand-200 pt-4">
                  <h3 className="text-sm font-semibold text-brand-800">
                    Contribuir para melhoria
                  </h3>
                  <p className="mt-1 text-sm text-brand-800">
                    Envia este relatório, já minimizado e sem texto livre, como
                    candidato governado. A elegibilidade é avaliada no servidor e a
                    contribuição pode ser revogada depois.
                  </p>
                  <Button
                    variant="secondary"
                    className="mt-3 w-full"
                    disabled={contributing || relatorioRecortado}
                    data-testid="contribute-learning"
                    onClick={contributeForLearning}
                  >
                    <Sparkles aria-hidden="true" />
                    {contributing
                      ? "Contribuindo..."
                      : "Contribuir com este relatório"}
                  </Button>
                  {contributionStatus ? (
                    <p
                      role="status"
                      data-testid="contribution-status"
                      className="mt-3 text-sm text-brand-800"
                    >
                      {contributionStatus}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <h2 className="text-base font-semibold text-ink">
                Exportar e salvar
              </h2>
              <p className="mt-1 text-sm text-ink-muted">
                Baixar é para ler ou processar. Salvar cria um registro imutável
                deste relatório — só disponível sem recorte.
              </p>
              <div className="mt-4 grid gap-2">
                <Button
                  variant="secondary"
                  className="justify-start"
                  onClick={() => baixarRelatorio("txt")}
                >
                  <Download aria-hidden="true" />
                  Baixar para leitura
                </Button>
                <Button
                  variant="secondary"
                  className="justify-start"
                  onClick={() => baixarRelatorio("json")}
                >
                  <Download aria-hidden="true" />
                  Baixar dados
                </Button>
                <Button
                  variant="soft"
                  className="justify-start"
                  onClick={exportReport}
                  disabled={exporting || relatorioRecortado}
                >
                  <Save aria-hidden="true" />
                  {exporting ? "Exportando..." : "Salvar relatório"}
                </Button>
              </div>
              {exportStatus ? (
                <p key={exportStatus} role="status" className="motion-rise-in mt-3 text-sm text-ink-muted">
                  {exportStatus}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

/** Alterna a presenca de um item numa selecao, preservando a ordem de clique. */
function alternar<T>(atual: T[], item: T): T[] {
  return atual.includes(item)
    ? atual.filter((valor) => valor !== item)
    : [...atual, item];
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-ink">{label}</p>
      <div className="mt-2 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterChip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "min-h-11 rounded-pill border px-3.5 text-sm transition-colors duration-150 lg:min-h-9",
        on
          ? "border-brand-300 bg-brand-100 font-medium text-brand-700"
          : "border-line-strong bg-surface text-ink-muted hover:border-brand-200 hover:bg-surface-brand",
      )}
    >
      {label}
    </button>
  );
}

function InsightCard({
  tone,
  icon,
  title,
  body,
}: {
  tone: "brand" | "cycle";
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li>
      <div className="h-full rounded-control border border-line bg-surface-muted/60 p-4">
        <div className="flex items-start gap-3">
          <IconPill tone={tone} size="sm">
            {icon}
          </IconPill>
          <div>
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            <p className="mt-1 text-sm text-ink-muted">{body}</p>
          </div>
        </div>
      </div>
    </li>
  );
}

function shortLabel(date: string): string {
  const d = fromISODate(date);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatDate(date: string): string {
  return fromISODate(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}
