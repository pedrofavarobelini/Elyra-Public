"use client";

import {
  ArrowLeft,
  BookLock,
  CalendarDays,
  FileText,
  Flower2,
  Moon,
  NotebookPen,
  Target,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";

import { ChartCard } from "@/components/charts/chart-card";
import { aggregateForReadability } from "@/components/charts/aggregate";
import {
  CHART_COLORS,
  SERIES_DASH,
} from "@/components/charts/chart-theme";
import { ChartLegend } from "@/components/charts/chart-legend";
import { cn } from "@/lib/utils";
import { hasAnyGap } from "@/components/charts/gaps";
import {
  EvolutionChart,
  type EvolutionPoint,
  type EvolutionSeries,
} from "@/components/charts/evolution-chart";
import { GrantList } from "@/components/professional/grant-list";
import { EmptyState } from "@/components/states";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { Label } from "@/components/ui/label";
import { NonClinicalNotice } from "@/components/ui/non-clinical-notice";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/input";
import {
  isVisualModality,
  type ObservationModality,
} from "@/lib/contracts/capture-coverage";
import {
  SIGNAL_LABEL,
  VISUAL_SIGNALS,
  type ObservableSignalName,
} from "@/lib/contracts/multimodal-signals";
import { SESSION_KIND_LABEL } from "@/lib/contracts/session";
import {
  SHARING_SCOPE_LABEL,
  SHARING_SCOPES,
  type SharingScope,
} from "@/lib/contracts/sharing";

interface PatientData {
  connection: {
    id: string;
    client_user_id: string;
    accepted_at: string | null;
  };
  profile: { user_id: string; display_name: string };
  /** Instante da leitura no servidor (mesma classificacao de vigencia). */
  readAt: number;
  permissions: Array<{
    id: string;
    scope: string;
    journal_entry_id: string | null;
    status?: string;
    permission?: string;
    granted_at?: string;
    valid_from?: string | null;
    expires_at: string | null;
    data_from?: string | null;
    data_to?: string | null;
  }>;
  sessions: {
    sessions: Array<{
      id: string;
      kind: string;
      status: string;
      started_at: string;
      ended_at: string | null;
      /**
       * Distingue "nao houve sinal visual" de "a analise visual nem foi
       * autorizada". Sem este campo, a ausencia da secao seria ambigua no lugar
       * em que a ambiguidade custa mais.
       */
      visual_analysis_consent?: boolean;
    }>;
    coverage: Array<{
      session_id: string;
      modality: string;
      outcome: string;
      reason: string | null;
      coverage_ms: number;
      session_duration_ms: number;
    }>;
    features: Array<{
      session_id: string;
      signal_name: string;
      unit: string;
      value: number | null;
      status: string;
      personal_baseline_mean: number | null;
      personal_baseline_samples: number;
      delta_vs_personal_baseline: number | null;
      coverage_ms: number | null;
      coverage_outcome: string | null;
    }>;
    windows: Array<{
      session_id: string;
      signal_name: string;
      start_offset_ms: number;
      end_offset_ms: number;
      value: number;
    }>;
    selfReports: Array<{
      session_id: string;
      mood: number | null;
      perceived_anxiety: number | null;
      energy: number | null;
    }>;
    interpretations: Array<{
      session_id: string;
      confidence: string | null;
      provider_used: string;
      model: string;
      payload: unknown;
      created_at: string;
    }>;
    segments: Array<{
      session_id: string;
      segment_index: number;
      content: string;
      start_offset_ms: number;
      recognized_at_offset_ms: number;
    }>;
    /**
     * Proveniencia da transcricao.
     *
     * O profissional precisa saber que le saida de reconhecimento automatico, e
     * nao transcricao literal: um erro de ASR chegaria como fala da pessoa.
     */
    transcripts: Array<{
      session_id: string;
      source: string;
      status: string;
    }>;
    /**
     * Correcoes vigentes (nao revogadas) da pessoa usuaria.
     *
     * Mostrar o texto que o ASR errou e esconder a correcao dela seria pior que
     * nao mostrar nada: o profissional leria como fala o que a propria pessoa
     * ja disse que nao foi dito.
     */
    corrections: Array<{
      session_id: string;
      revision: number;
      corrected_content: string;
      created_at: string;
    }>;
  };
  data: {
    emotional: Array<{
      id: string;
      occurred_at: string;
      mood_score: number | null;
      perceived_anxiety_score: number | null;
      energy_score: number | null;
      primary_feeling: string | null;
    }>;
    sleep: Array<{
      id: string;
      night: string;
      duration_minutes: number | null;
      sleep_quality_score: number | null;
    }>;
    goals: Array<{
      id: string;
      title: string;
      kind: string;
      status: string;
      target: number | null;
      unit: string | null;
    }>;
    journal: Array<{
      id: string;
      title: string | null;
      content: string;
      updated_at: string;
    }>;
    cyclePeriods: Array<{ id: string; start_date: string; end_date: string | null }>;
    reports: Array<{
      id: string;
      schema_version: string;
      period_start: string;
      period_end: string;
      range_days: number;
      created_at: string;
    }>;
  };
  notes: Array<{
    id: string;
    connection_id: string;
    professional_user_id: string;
    client_user_id: string;
    body: string;
    created_at: string;
    updated_at: string;
  }>;
}

const SCOPE_LABEL = SHARING_SCOPE_LABEL;

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

/** Dia e mes (dd/mm). Fixa meio-dia UTC para o fuso nao empurrar a data. */
function formatDiaMes(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
}

export function PatientView({ patient }: { patient: PatientData }) {
  const [notes, setNotes] = useState(patient.notes);
  const [noteBody, setNoteBody] = useState("");
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const scopes = useMemo(
    () => new Set(patient.permissions.map((permission) => permission.scope)),
    [patient.permissions],
  );
  const chart = useMemo(() => buildChart(patient, scopes), [patient, scopes]);

  /*
   * `VR-004` - series selecionaveis, e nao todas de uma vez.
   *
   * Quatro series simultaneas com eixo duplo sobre meses produzem um emaranhado
   * onde nenhuma delas e legivel. O profissional escolhe o que quer ler; a
   * selecao comeca com a **primeira** serie disponivel, e nao com todas.
   *
   * Derivado da selecao, sem efeito: a chave nasce do `scopes`, entao uma
   * permissao revogada some da lista por consequencia, e nao por sincronizacao.
   */
  const [seriesOcultas, setSeriesOcultas] = useState<Set<string>>(
    () => new Set(chart.series.slice(1).map((s) => s.key)),
  );
  const seriesVisiveis = chart.series.filter((s) => !seriesOcultas.has(s.key));

  const chartLegivel = useMemo(
    () =>
      aggregateForReadability(
        chart.points,
        seriesVisiveis.map((s) => s.key),
      ),
    [chart.points, seriesVisiveis],
  );

  async function createNote(event: FormEvent) {
    event.preventDefault();
    setNoteBusy(true);
    setNoteError(null);
    try {
      const response = await fetch("/api/professional/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          connectionId: patient.connection.id,
          clientUserId: patient.profile.user_id,
          body: noteBody,
        }),
      });
      const payload = (await response.json()) as {
        data?: PatientData["notes"][number];
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Não foi possível salvar a nota.");
      }
      setNotes((current) => [payload.data!, ...current]);
      setNoteBody("");
    } catch (caught) {
      setNoteError(
        caught instanceof Error ? caught.message : "Não foi possível salvar a nota.",
      );
    } finally {
      setNoteBusy(false);
    }
  }

  return (
    <>
      <Link
        href="/pro/acompanhamentos"
        className="mb-4 flex w-fit items-center gap-2 text-sm font-medium text-brand-600 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Voltar para acompanhamentos
      </Link>

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center gap-6">
          <Avatar className="size-14">
            <AvatarFallback className="text-lg">
              {initials(patient.profile.display_name)}
            </AvatarFallback>
          </Avatar>
          <div className="mr-auto">
            <h1 className="text-xl font-semibold tracking-tight text-ink sm:text-2xl">
              {patient.profile.display_name}
            </h1>
            <p className="mt-0.5 text-sm text-ink-muted">
              Acompanhamento ativo desde{" "}
              {patient.connection.accepted_at
                ? new Date(patient.connection.accepted_at).toLocaleDateString("pt-BR")
                : "—"}
            </p>
          </div>
          <Badge tone="brand">Somente leitura</Badge>
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-[1.7fr_1fr]" data-layout="columns">
        <div className="flex min-w-0 flex-col gap-6" data-layout-column="main">
        <Tabs defaultValue="evolucao" className="min-w-0">
          <TabsList>
            <TabsTrigger value="evolucao">Evolução</TabsTrigger>
            <TabsTrigger value="sono">Sono</TabsTrigger>
            <TabsTrigger value="metas">Metas</TabsTrigger>
            <TabsTrigger value="ciclo">Ciclo</TabsTrigger>
            <TabsTrigger value="sessoes">Sessões</TabsTrigger>
            <TabsTrigger value="diario">Diário</TabsTrigger>
            <TabsTrigger value="relatorios">Relatórios</TabsTrigger>
            <TabsTrigger value="acesso">Acesso</TabsTrigger>
          </TabsList>

          <TabsContent value="evolucao">
            <ChartCard
              title="Evolução longitudinal"
              description="Somente registros cobertos por permissões vigentes."
              hint="Dias sem registro aparecem como lacuna e não são estimados."
            >
              {chart.series.length === 0 || chart.points.length === 0 ? (
                <EmptyState
                  title="Nenhum indicador compartilhado"
                  description="Dados emocionais e de sono não fazem parte deste acesso."
                />
              ) : (
                <>
                  {/*
                    `VR-004`: em vez de empilhar quatro series com eixo duplo,
                    o profissional escolhe o que ler. O rotulo do controle diz
                    o que ele faz, e `aria-pressed` diz em que estado esta.
                  */}
                  <div
                    role="group"
                    aria-label="Séries exibidas no gráfico"
                    className="mb-3 flex flex-wrap gap-2"
                  >
                    {chart.series.map(({ key, label }) => {
                      const visivel = !seriesOcultas.has(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          aria-pressed={visivel}
                          onClick={() =>
                            setSeriesOcultas((atual) => {
                              const proximo = new Set(atual);
                              if (proximo.has(key)) proximo.delete(key);
                              else proximo.add(key);
                              return proximo;
                            })
                          }
                          className={cn(
                            "motion-press inline-flex items-center gap-2 rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors",
                            visivel
                              ? "border-brand-300 bg-surface-brand text-brand-700"
                              : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className="inline-block h-0 w-4 border-t-2"
                            style={{
                              borderColor: CHART_COLORS[key],
                              borderTopStyle: SERIES_DASH[key] === "2 3" ? "dotted" : SERIES_DASH[key] ? "dashed" : "solid",
                              opacity: visivel ? 1 : 0.4,
                            }}
                          />
                          {label}
                        </button>
                      );
                    })}
                  </div>

                  {seriesVisiveis.length === 0 ? (
                    <EmptyState
                      title="Nenhuma série selecionada"
                      description="Escolha ao menos um indicador acima para ver a evolução."
                    />
                  ) : (
                    <>
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <ChartLegend
                          items={seriesVisiveis}
                          showGap={hasAnyGap(
                            chartLegivel.points,
                            seriesVisiveis.map((s) => s.key),
                          )}
                        />
                        {chartLegivel.aggregated ? (
                          /* Agregar em silencio mentiria sobre a granularidade
                             do proprio eixo. */
                          <p className="text-xs text-ink-subtle">
                            Média semanal · janela longa
                          </p>
                        ) : null}
                      </div>
                      <EvolutionChart
                        data={chartLegivel.points}
                        series={seriesVisiveis}
                      />
                    </>
                  )}
                </>
              )}
            </ChartCard>
            <NonClinicalNotice context="professional" className="mt-4" />
          </TabsContent>

          <DataTab value="sono" label="Sono" shared={scopes.has("sleep")} layer="observed">
            <RecordList
              empty="Nenhum registro de sono compartilhado."
              rows={patient.data.sleep.map((record) => ({
                id: record.id,
                title: new Date(`${record.night}T12:00:00Z`).toLocaleDateString("pt-BR"),
                body: record.duration_minutes === null
                  ? `Duração não informada · qualidade ${record.sleep_quality_score ?? "—"}/10`
                  : `${Math.floor(record.duration_minutes / 60)}h ${String(record.duration_minutes % 60).padStart(2, "0")}m · qualidade ${record.sleep_quality_score ?? "—"}/10`,
              }))}
            />
          </DataTab>

          <DataTab value="metas" label="Metas" shared={scopes.has("goals")} layer="observed">
            <RecordList
              empty="Nenhuma meta compartilhada."
              rows={patient.data.goals.map((goal) => ({
                id: goal.id,
                title: goal.title,
                body: `${goal.status} · ${goal.kind}`,
              }))}
            />
          </DataTab>

          <DataTab value="ciclo" label="Ciclo" shared={scopes.has("cycle")} layer="observed">
            <RecordList
              empty="Nenhum período compartilhado."
              rows={patient.data.cyclePeriods.map((period) => ({
                id: period.id,
                title: `Inicio ${new Date(`${period.start_date}T12:00:00Z`).toLocaleDateString("pt-BR")}`,
                body: period.end_date
                  ? `Fim ${new Date(`${period.end_date}T12:00:00Z`).toLocaleDateString("pt-BR")}`
                  : "Período em aberto",
              }))}
            />
          </DataTab>

          <DataTab
            value="sessoes"
            label="Resultado multimodal"
            shared={scopes.has("multimodal_result")}
            layer="deterministic"
          >
            <SessionReport
              sessions={patient.sessions}
              transcriptShared={scopes.has("multimodal_transcript")}
              interpretationShared={scopes.has("multimodal_ai_interpretation")}
            />
          </DataTab>

          <DataTab
            value="diario"
            label="Diário compartilhado"
            shared={scopes.has("journal_entry")}
            layer="observed"
          >
            <RecordList
              empty="Nenhuma entrada individual foi compartilhada."
              rows={patient.data.journal.map((entry) => ({
                id: entry.id,
                title: entry.title || "Sem título",
                body: entry.content,
              }))}
            />
          </DataTab>

          <DataTab
            value="relatorios"
            label="Relatórios"
            shared={scopes.has("reports")}
            layer="deterministic"
          >
            <RecordList
              empty="Nenhum snapshot de relatório compartilhado."
              rows={patient.data.reports.map((report) => ({
                id: report.id,
                title: `${new Date(`${report.period_start}T12:00:00Z`).toLocaleDateString("pt-BR")} a ${new Date(`${report.period_end}T12:00:00Z`).toLocaleDateString("pt-BR")}`,
                body: `${report.range_days} dias · ${report.schema_version}`,
              }))}
            />
          </DataTab>

          <TabsContent value="acesso">
            <GrantsPanel permissions={patient.permissions} now={patient.readAt} />
          </TabsContent>
        </Tabs>
        </div>

        <div className="flex min-w-0 flex-col gap-6" data-layout-column="side">
          <Card>
            <CardContent>
              <h2 className="mb-1 text-base font-semibold text-ink">Dados compartilhados</h2>
              <p className="mb-4 text-sm text-ink-muted">
                A conexão não concede acesso. Cada escopo abaixo é independente.
              </p>
              <ul className="flex flex-col divide-y divide-line">
                {SHARING_SCOPES.map((scope) => (
                  <li key={scope} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm text-ink">{SCOPE_LABEL[scope]}</span>
                    <Badge
                      tone={scopes.has(scope) ? "positive" : "neutral"}
                      data-testid={`sharing-${scope}`}
                    >
                      {scopes.has(scope) ? "Compartilhado" : "Não compartilhado"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <div className="mb-4 flex items-center gap-3">
                <IconPill tone="brand" size="sm"><NotebookPen /></IconPill>
                <div>
                  <h2 className="font-semibold text-ink">Notas profissionais</h2>
                  <p className="text-sm text-ink-muted">
                    Suas, separadas dos dados da pessoa e fora de IA e aprendizado.
                  </p>
                </div>
              </div>
              <form className="mb-4 flex flex-col gap-2" onSubmit={createNote}>
                <Label htmlFor="professional-note">Nova nota</Label>
                <Textarea
                  id="professional-note"
                  rows={3}
                  value={noteBody}
                  onChange={(event) => setNoteBody(event.target.value)}
                  maxLength={4000}
                  required
                />
                {noteError ? <p role="alert" className="text-sm text-destructive">{noteError}</p> : null}
                <Button className="self-start" size="sm" disabled={noteBusy} type="submit">
                  {noteBusy ? "Salvando..." : "Salvar nota"}
                </Button>
              </form>
              <RecordList
                empty="Nenhuma nota profissional."
                rows={notes.map((note) => ({
                  id: note.id,
                  title: new Date(note.created_at).toLocaleString("pt-BR"),
                  body: note.body,
                }))}
              />
            </CardContent>
          </Card>

        </div>
      </div>
    </>
  );
}

function buildChart(patient: PatientData, scopes: Set<string>) {
  const byDay = new Map<string, EvolutionPoint>();
  if (scopes.has("emotional")) {
    for (const record of patient.data.emotional) {
      const day = record.occurred_at.slice(0, 10);
      byDay.set(day, {
        ...byDay.get(day),
        label: formatDiaMes(day),
        mood: record.mood_score,
        anxiety: record.perceived_anxiety_score,
        energy: record.energy_score,
      });
    }
  }
  if (scopes.has("sleep")) {
    for (const record of patient.data.sleep) {
      byDay.set(record.night, {
        ...byDay.get(record.night),
        label: formatDiaMes(record.night),
        sleep:
          record.duration_minutes === null ? null : record.duration_minutes / 60,
      });
    }
  }
  const series: EvolutionSeries[] = [
    ...(scopes.has("emotional")
      ? ([
          { key: "mood", label: "Humor" },
          { key: "anxiety", label: "Ansiedade percebida" },
          { key: "energy", label: "Energia" },
        ] as EvolutionSeries[])
      : []),
    ...(scopes.has("sleep")
      ? ([{ key: "sleep", label: "Sono" }] as EvolutionSeries[])
      : []),
  ];
  return {
    points: [...byDay.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, point]) => point),
    series,
  };
}


function SessionReport({
  sessions,
  transcriptShared,
  interpretationShared,
}: {
  sessions: PatientData["sessions"];
  transcriptShared: boolean;
  interpretationShared: boolean;
}) {
  if (sessions.sessions.length === 0) {
    return (
      /*
        Este ramo so e alcancado com a permissao **concedida** - `DataTab` trata
        o caso nao compartilhado com um vazio proprio. Entao a copy aqui precisa
        dizer que a ausencia e **de registro**, e nunca deixar no ar que possa ser
        de permissao: confundir os dois faz o profissional supor ausencia onde ha
        ausencia de autorizacao, e isso e pior do que nao mostrar nada.
      */
      <EmptyState
        icon={<Video className="size-8" />}
        title="Nenhuma sessão para mostrar"
        description="Você tem permissão para este dado. Nenhuma sessão foi registrada, ou nenhuma está dentro da janela autorizada — não é ausência de permissão."
      />
    );
  }

  return (
    <div className="grid gap-5">
      {sessions.sessions.map((session) => {
        const coverage = sessions.coverage.filter(
          (item) => item.session_id === session.id,
        );
        const allFeatures = sessions.features.filter(
          (item) => item.session_id === session.id,
        );
        /*
          Sinais visuais tem secao propria, e nao uma linha a mais na lista de
          calculo.

          Nao e organizacao: cada um deles depende de uma cobertura diferente da
          camera, e misturados a `speech_rate` eles herdariam visualmente a
          cobertura do microfone na leitura de quem passa o olho. A separacao e
          o que torna possivel mostrar, ao lado de cada numero, de que fracao da
          sessao ele fala.
        */
        const visualFeatures = allFeatures.filter((item) =>
          VISUAL_SIGNALS.has(item.signal_name as ObservableSignalName),
        );
        const features = allFeatures.filter(
          (item) => !VISUAL_SIGNALS.has(item.signal_name as ObservableSignalName),
        );
        const visualCoverage = coverage.filter((item) =>
          isVisualModality(item.modality as ObservationModality),
        );
        const windows = sessions.windows.filter(
          (item) => item.session_id === session.id,
        );
        const visualWindowCount = windows.filter((item) =>
          VISUAL_SIGNALS.has(item.signal_name as ObservableSignalName),
        ).length;
        const selfReport = sessions.selfReports.find(
          (item) => item.session_id === session.id,
        );
        const interpretation = sessions.interpretations.find(
          (item) => item.session_id === session.id,
        );
        const segments = sessions.segments.filter(
          (item) => item.session_id === session.id,
        );
        const transcriptRow = sessions.transcripts.find(
          (item) => item.session_id === session.id,
        );
        // A correcao vigente e a de maior revisao; a query ja exclui revogadas
        // e ordena decrescente.
        const correction = sessions.corrections.find(
          (item) => item.session_id === session.id,
        );

        return (
          <article
            key={session.id}
            aria-label={`Sessão de ${new Date(session.started_at).toLocaleDateString("pt-BR")}`}
            className="rounded-card border border-line bg-surface p-4"
            data-testid="pro-session-report"
          >
            <header className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">
                {new Date(session.started_at).toLocaleString("pt-BR")}
              </h3>
              <span className="text-xs text-ink-subtle">
                {SESSION_KIND_LABEL[
                  session.kind as keyof typeof SESSION_KIND_LABEL
                ] ?? session.kind}
              </span>
            </header>

            {/* 1. Cobertura, antes de qualquer numero. */}
            <section className="mt-3" aria-label="Cobertura da captura">
              <p className="text-xs font-medium text-ink-muted">
                O que foi capturado
              </p>
              <ul className="mt-1 grid gap-1">
                {coverage.length === 0 ? (
                  <li className="text-xs text-ink-subtle">
                    Cobertura não registrada para esta sessão.
                  </li>
                ) : (
                  coverage.map((item) => (
                    <li key={item.modality} className="text-xs text-ink-muted">
                      <strong>
                        {MODALITY_LABEL[item.modality] ?? item.modality}:
                      </strong>{" "}
                      {describeCoverage(item)}
                    </li>
                  ))
                )}
              </ul>
            </section>

            {/* 2. Calculo deterministico, com a cobertura que o produziu. */}
            <section className="mt-3" aria-label="Sinais calculados">
              <p className="text-xs font-medium text-ink-muted">
                Cálculo da Elyra
              </p>
              {features.length === 0 ? (
                <p className="mt-1 text-xs text-ink-subtle">
                  Nenhum sinal compartilhado para esta sessão.
                </p>
              ) : (
                <ul className="mt-1 grid gap-1">
                  {features.map((item) => (
                    <li
                      key={item.signal_name}
                      className="text-xs text-ink-muted"
                    >
                      {SIGNAL_LABEL[item.signal_name as ObservableSignalName] ??
                        item.signal_name}
                      :{" "}
                      {item.status === "not_captured" || item.value === null
                        ? "sem registro"
                        : String(item.value)}
                      {item.coverage_outcome === "partial"
                        ? " · derivado de parte da sessão"
                        : ""}
                      {item.status === "insufficient_baseline"
                        ? " · sem base pessoal para comparar"
                        : ""}
                    </li>
                  ))}
                </ul>
              )}
              {windows.length > 0 ? (
                <p className="mt-1 text-xs text-ink-subtle">
                  {windows.length} janelas de um minuto disponíveis para leitura
                  ao longo da sessão.
                </p>
              ) : null}
            </section>

            {/*
              2b. Sinais visuais: evidencia **antes** da interpretacao.

              Valor, baseline pessoal, diferenca, cobertura e serie. O
              profissional precisa poder ver de onde o numero veio antes de ler
              qualquer frase sobre ele - e, quando nao ha base pessoal, ver que
              nao ha, em vez de uma comparacao inventada.

              Nenhum destes numeros e emocao. O rotulo de cada um descreve a
              medida, e a nota ao final diz isso com todas as letras.
            */}
            {session.visual_analysis_consent ? (
              <section className="mt-3" aria-label="Sinais visuais observados">
                <p className="text-xs font-medium text-ink-muted">
                  Sinais visuais observados
                </p>
                <ul className="mt-1 grid gap-1">
                  {visualCoverage.map((item) => (
                    <li
                      key={`cobertura-${item.modality}`}
                      className="text-xs text-ink-subtle"
                    >
                      <strong>
                        {MODALITY_LABEL[item.modality] ?? item.modality}:
                      </strong>{" "}
                      {describeCoverage(item)}
                    </li>
                  ))}
                </ul>
                {visualFeatures.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-subtle">
                    Nenhum sinal visual disponível para esta sessão.
                  </p>
                ) : (
                  <ul className="mt-1 grid gap-1" data-testid="pro-visual-signals">
                    {visualFeatures.map((item) => (
                      <li
                        key={item.signal_name}
                        className="text-xs text-ink-muted"
                      >
                        {SIGNAL_LABEL[
                          item.signal_name as ObservableSignalName
                        ] ?? item.signal_name}
                        :{" "}
                        {item.status === "not_captured" || item.value === null
                          ? "sem registro"
                          : String(item.value)}
                        {item.status === "insufficient_baseline"
                          ? " · sem base pessoal para comparar"
                          : item.personal_baseline_mean !== null
                            ? ` · base pessoal ${item.personal_baseline_mean}` +
                              (item.delta_vs_personal_baseline !== null
                                ? `, diferença ${item.delta_vs_personal_baseline}`
                                : "")
                            : ""}
                        {item.coverage_outcome === "partial"
                          ? " · derivado de parte da sessão"
                          : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {visualWindowCount > 0 ? (
                  <p className="mt-1 text-xs text-ink-subtle">
                    {visualWindowCount} janelas visuais de um minuto ao longo da
                    sessão.
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-ink-subtle">
                  Medidas de movimento observado, processadas no aparelho da
                  pessoa. Não indicam emoção, não constituem avaliação clínica e
                  a comparação é sempre com a própria pessoa.
                </p>
              </section>
            ) : null}

            {/* 3. O que a pessoa disse. Nunca corrigido pelo sinal. */}
            <section className="mt-3" aria-label="Autorrelato">
              <p className="text-xs font-medium text-ink-muted">
                O que a pessoa relatou
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {selfReport
                  ? describeSelfReport(selfReport)
                  : "A pessoa não registrou autorrelato nesta sessão."}
              </p>
            </section>

            {/* 4. Transcricao: escopo proprio, e nunca embutida no resultado. */}
            <section className="mt-3" aria-label="Transcrição">
              <p className="text-xs font-medium text-ink-muted">Transcrição</p>
              <p className="mt-1 text-xs text-ink-muted">
                {!transcriptShared
                  ? "Não compartilhada. A transcrição tem permissão própria."
                  : segments.length === 0
                    ? "Compartilhada, mas sem trechos disponíveis para esta sessão."
                    : `${segments.length} trechos disponíveis. O instante indicado é o de reconhecimento, não o da fala.`}
              </p>
              {/*
                Proveniencia, quando ha o que ler.

                O profissional precisa saber que esta diante de saida de
                reconhecimento automatico, e nao de uma transcricao literal: um
                erro de ASR chegaria como fala da pessoa, e a diferenca entre
                "ela disse" e "a maquina entendeu" e o tipo de coisa sobre a
                qual alguem decide.

                Nenhuma taxa de erro aparece aqui, e nenhum polegar da pessoa
                usuaria: avaliacao de produto e opiniao sobre a ferramenta, e
                traze-la para o dossie a transformaria em dado sobre quem falou.
              */}
              {transcriptShared && segments.length > 0 ? (
                <p
                  className="mt-1 text-xs text-ink-subtle"
                  data-testid="pro-transcript-provenance"
                >
                  {correction
                    ? "Transcrição automática revisada pela pessoa usuária."
                    : transcriptRow?.source === "local_whisper"
                      ? "Transcrição automática local, não revisada. Pode conter erros de reconhecimento."
                      : "Transcrição automática no aparelho, não revisada. Pode conter erros de reconhecimento."}
                </p>
              ) : null}
            </section>

            {/* 5. Interpretacao, por ultimo, com escopo proprio. */}
            <section className="mt-3" aria-label="Interpretação assistida">
              <p className="text-xs font-medium text-ink-muted">
                Interpretação assistida
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {!interpretationShared
                  ? "Não compartilhada. A interpretação por IA tem permissão própria, separada do cálculo."
                  : !interpretation
                    ? "Nenhuma interpretação foi produzida para esta sessão."
                    : `Confiança declarada: ${
                        CONFIDENCE_LABEL[interpretation.confidence ?? ""] ??
                        "não declarada"
                      }. Leitura de modelo — não é medição, e não substitui a sua avaliação.`}
              </p>
            </section>
          </article>
        );
      })}
    </div>
  );
}

const MODALITY_LABEL: Record<string, string> = {
  screen: "Tela",
  camera: "Câmera",
  microphone: "Microfone",
  /*
    As tres visuais aparecem ao lado das de captura, e nao dentro de "Camera".

    "Camera: completa" e "Rosto no enquadramento: parcial, 22 de 30 minutos" sao
    duas verdades sobre a mesma sessao, e so a segunda diz de que fracao o sinal
    de cabeca esta falando. Aninhar uma na outra faria o profissional ler a
    primeira e supor a segunda.
  */
  visual_face: "Rosto no enquadramento",
  visual_body: "Corpo no enquadramento",
  visual_hands: "Mãos no enquadramento",
};

const REASON_TEXT: Record<string, string> = {
  not_requested: "não autorizada para esta sessão",
  unsupported: "não suportada no navegador",
  denied: "permissão negada",
  cancelled: "seleção cancelada",
  error: "falha ao iniciar",
  interrupted: "encerrada antes do fim",
  recording_capped: "gravação atingiu o limite de tamanho",
};

const CONFIDENCE_LABEL: Record<string, string> = {
  low: "baixa — os dados disponíveis não sustentam leitura forte",
  moderate: "moderada",
  high: "alta",
};

function describeCoverage(item: PatientData["sessions"]["coverage"][number]) {
  const reason = REASON_TEXT[item.reason ?? ""] ?? item.reason ?? "";
  if (item.outcome === "absent") return `não capturada — ${reason}`;
  const span = `${formatMs(item.coverage_ms)} de ${formatMs(item.session_duration_ms)}`;
  return item.outcome === "partial"
    ? `${span} — parcial (${reason})`
    : `${span} — completa`;
}

function describeSelfReport(
  report: PatientData["sessions"]["selfReports"][number],
) {
  const parts: Array<[string, number | null]> = [
    ["Humor", report.mood],
    ["Ansiedade percebida", report.perceived_anxiety],
    ["Energia", report.energy],
  ];
  // Ausencia continua sendo ausencia: campo em branco nunca vira `0`.
  return parts
    .map(([label, value]) =>
      value === null ? `${label}: não informado` : `${label}: ${value}/10`,
    )
    .join(" · ");
}

function formatMs(value: number): string {
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}


type DataLayer = "observed" | "deterministic" | "ai";

const LAYER_LABEL: Record<DataLayer, string> = {
  observed: "Registro da pessoa",
  deterministic: "Cálculo da Elyra",
  ai: "Leitura de modelo",
};

const LAYER_HINT: Record<DataLayer, string> = {
  observed: "O que a pessoa registrou, como registrou.",
  deterministic: "Derivado dos registros por regra fixa e reproduzível.",
  ai: "Interpretação gerada por modelo. Não é medição.",
};

export function DataTab({
  value,
  label,
  shared,
  layer,
  children,
}: {
  value: string;
  label: string;
  shared: boolean;
  layer: DataLayer;
  children: React.ReactNode;
}) {
  const icons = {
    Sono: Moon,
    Metas: Target,
    Ciclo: Flower2,
    "Resultado multimodal": Video,
    "Diário compartilhado": BookLock,
    Relatórios: FileText,
  };
  const Icon = icons[label as keyof typeof icons] ?? CalendarDays;
  return (
    <TabsContent value={value}>
      <Card>
        <CardContent>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-semibold text-ink">
              <Icon className="size-4" aria-hidden="true" /> {label}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral" data-testid={`layer-${value}`}>
                {LAYER_LABEL[layer]}
              </Badge>
              <Badge tone={shared ? "positive" : "neutral"}>
                {shared ? "Compartilhado" : "Não compartilhado"}
              </Badge>
            </div>
          </div>
          <p className="mb-3 text-xs text-ink-subtle">{LAYER_HINT[layer]}</p>
          {shared ? children : (
            <EmptyState
              title="Não disponível para este acesso"
              description="Este tipo de registro não faz parte do que foi compartilhado com você. Isso não indica se existem registros."
            />
          )}
        </CardContent>
      </Card>
    </TabsContent>
  );
}

function RecordList({
  rows,
  empty,
}: {
  rows: Array<{ id: string; title: string; body: string }>;
  empty: string;
}) {
  if (rows.length === 0) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {rows.map((row) => (
        <li key={row.id} className="py-3 first:pt-0 last:pb-0">
          <p className="text-sm font-medium text-ink">{row.title}</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{row.body}</p>
        </li>
      ))}
    </ul>
  );
}


function GrantsPanel({
  permissions,
  now,
}: {
  permissions: PatientData["permissions"];
  now: number;
}) {
  return (
    <Card>
      <CardContent>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-ink">Acesso e validade</h2>
          <Badge tone="brand">Somente leitura</Badge>
        </div>
        <p className="mb-4 text-sm text-ink-muted">
          Só a pessoa concede, recorta ou revoga. Uma mudança dela vale na sua próxima consulta.
        </p>
        {permissions.length === 0 ? (
          <EmptyState
            size="compact"
            title="Nada compartilhado no momento"
            description="O vínculo existe, mas nenhum escopo está vigente."
          />
        ) : (
          <GrantList
            now={now}
            label="Escopos compartilhados com você"
            grants={permissions.map((permission) => ({
              id: permission.id,
              scope: permission.scope as SharingScope,
              journalEntryId: permission.journal_entry_id,
              status: permission.status ?? "granted",
              grantedAt: permission.granted_at ?? null,
              validFrom: permission.valid_from ?? null,
              validUntil: permission.expires_at,
              revokedAt: null,
              dataFrom: permission.data_from ?? null,
              dataTo: permission.data_to ?? null,
            }))}
          />
        )}
      </CardContent>
    </Card>
  );
}
