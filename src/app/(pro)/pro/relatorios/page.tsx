import { Brain, Moon, Smile, Sparkles, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ComparisonCard } from "@/components/charts/comparison-card";
import { describeSampleSize, SampleSizeNote } from "@/components/charts/sample-size";
import { type EvolutionSeries } from "@/components/charts/evolution-chart";
import { PageHeader } from "@/components/journey/page-header";
import { EmptyState, InlineEmpty } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NonClinicalNotice } from "@/components/ui/non-clinical-notice";
import { formatDate } from "@/lib/professional/portal";
import { ReportEvolution } from "./evolution";
import { MIN_DAYS_FOR_COMPARISON, type AnalyticsReport } from "@/lib/reports";
import { formatScore } from "@/lib/utils";
import { requireVerifiedProfessional } from "@/server/professional-gate";
import {
  getProfessionalReports,
  PROFESSIONAL_REPORT_DAYS,
  ProfessionalAccessError,
} from "@/server/services/professional-service";

export const metadata: Metadata = { title: "Relatórios e evolução" };

function hours(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Os tres niveis de leitura, com o mesmo nome em toda a tela. */
function LayerBadge({ layer }: { layer: "observed" | "deterministic" | "ai" }) {
  const label =
    layer === "observed"
      ? "Registro da pessoa"
      : layer === "deterministic"
        ? "Cálculo da Elyra"
        : "Leitura assistida por IA";
  return (
    <Badge tone={layer === "ai" ? "attention" : layer === "deterministic" ? "brand" : "neutral"} data-layer={layer}>
      {label}
    </Badge>
  );
}

function SnapshotDetail({ payload }: { payload: unknown }) {
  const report = payload as Partial<AnalyticsReport> | null;
  const metrics = report?.metrics;
  const quality = report?.dataQuality;
  if (!metrics || !quality) {
    return (
      <p className="text-sm text-ink-muted">
        Este snapshot usa um formato que esta tela não sabe ler. Nada foi inferido.
      </p>
    );
  }
  const rows = [
    { label: "Humor médio", value: metrics.mood?.current, days: quality.daysWithMood, format: (v: number) => `${formatScore(v)} /10` },
    { label: "Ansiedade média", value: metrics.anxiety?.current, days: quality.daysWithAnxiety, format: (v: number) => `${formatScore(v)} /10` },
    { label: "Energia média", value: metrics.energy?.current, days: quality.daysWithEnergy, format: (v: number) => `${formatScore(v)} /10` },
    { label: "Sono médio", value: metrics.sleepDurationMinutes?.current, days: quality.daysWithSleep, format: hours },
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {rows.map((row) => (
        <div key={row.label} className="rounded-control bg-surface-muted/70 px-3.5 py-3">
          <dt className="text-xs text-ink-muted">{row.label}</dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums text-ink">
            {row.value === null || row.value === undefined ? "Sem registro" : row.format(row.value)}
          </dd>
          <dd className="text-xs text-ink-subtle">
            {row.days} de {quality.daysInWindow} dias com registro
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default async function ProRelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ pessoa?: string; periodo?: string; snapshot?: string }>;
}) {
  const { supabase, user } = await requireVerifiedProfessional();
  const query = await searchParams;
  let data;
  try {
    data = await getProfessionalReports(supabase, user, query);
  } catch (error) {
    if (error instanceof ProfessionalAccessError) {
      return (
        <>
          <PageHeader title="Relatórios e evolução" />
          <Card>
            <CardContent>
              <EmptyState
                title="Perfil profissional necessário"
                description="Cadastre seu registro para acompanhar pessoas."
                action={
                  <Button asChild>
                    <Link href="/area-profissional/cadastro">Cadastrar registro</Link>
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </>
      );
    }
    throw error;
  }

  const selected = data.selected;
  const report = selected?.report ?? null;
  const series: EvolutionSeries[] = [
    ...(selected?.emotionalShared
      ? ([
          { key: "mood", label: "Humor" },
          { key: "anxiety", label: "Ansiedade percebida" },
          { key: "energy", label: "Energia" },
        ] as EvolutionSeries[])
      : []),
    ...(selected?.sleepShared ? ([{ key: "sleep", label: "Sono (h)" }] as EvolutionSeries[]) : []),
  ];
  const points =
    report?.series.map((point) => ({
      label: point.date.slice(8, 10) + "/" + point.date.slice(5, 7),
      mood: point.mood,
      anxiety: point.anxiety,
      energy: point.energy,
      sleep: point.sleepHours,
    })) ?? [];
  /*
    Quatro comparacoes com a mesma frase de base amostral: a frase aparece uma
    vez para o grupo (mesma regra do dashboard do titular). Com bases
    diferentes, cada cartao mantem a sua.
  */
  const shownComparisons = report
    ? [
        ...(selected?.emotionalShared
          ? [report.metrics.mood, report.metrics.anxiety, report.metrics.energy]
          : []),
        ...(selected?.sleepShared ? [report.metrics.sleepDurationMinutes] : []),
      ]
    : [];
  const allInsufficient =
    shownComparisons.length > 1 &&
    shownComparisons.every((comparison) => comparison.trend === "insufficient_data");
  const sameNote =
    allInsufficient ||
    (shownComparisons.length > 1 &&
      new Set(shownComparisons.map((comparison) => describeSampleSize(comparison))).size === 1);
  const hasAnyPoint = points.some(
    (point) => point.mood !== null || point.anxiety !== null || point.energy !== null || point.sleep !== null,
  );

  return (
    <>
      <PageHeader
        title="Relatórios e evolução"
        description="Evolução de uma pessoa no período escolhido, comparada com o período anterior, só com o que ela compartilhou."
      />

      <Card className="mb-5 lg:mb-6">
        <CardContent>
          {data.people.length === 0 ? (
            <EmptyState
              size="compact"
              title="Nenhum acompanhamento ativo"
              description={
                data.verified
                  ? "Relatórios aparecem quando alguém com vínculo ativo compartilhar registros."
                  : "Relatórios dependem da verificação do seu registro."
              }
              action={
                <Button asChild size="sm">
                  <Link href={data.verified ? "/pro/solicitacoes" : "/pro/perfil"}>
                    {data.verified ? "Gerar convite" : "Ver verificação"}
                  </Link>
                </Button>
              }
            />
          ) : (
            <form method="get" className="flex flex-col gap-4 md:flex-row md:items-end">
              <div className="min-w-0 flex-1">
                <label htmlFor="relatorio-pessoa" className="text-sm font-medium text-ink">
                  Pessoa acompanhada
                </label>
                <select
                  id="relatorio-pessoa"
                  name="pessoa"
                  defaultValue={selected?.clientUserId ?? ""}
                  required
                  className="mt-1.5 flex min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  <option value="" disabled>
                    Escolha uma pessoa
                  </option>
                  {data.people.map((person) => (
                    <option key={person.clientUserId} value={person.clientUserId}>
                      {person.displayName ?? "Pessoa acompanhada"}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:w-48">
                <label htmlFor="relatorio-periodo" className="text-sm font-medium text-ink">
                  Período
                </label>
                <select
                  id="relatorio-periodo"
                  name="periodo"
                  defaultValue={String(data.days)}
                  className="mt-1.5 flex min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                >
                  {PROFESSIONAL_REPORT_DAYS.map((days) => (
                    <option key={days} value={days}>
                      Últimos {days} dias
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Ver relatório</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {data.denied ? (
        <Card>
          <CardContent>
            <EmptyState
              size="compact"
              title="Relatório indisponível para você agora"
              description="O acesso exige vínculo ativo e verificação vigente. Escolha outra pessoa na lista."
            />
          </CardContent>
        </Card>
      ) : !selected ? (
        data.people.length > 0 ? (
          <p className="text-sm text-ink-muted">
            Escolha uma pessoa e o período. O cálculo usa a mesma regra do relatório que a própria pessoa vê.
          </p>
        ) : null
      ) : (
        <div className="flex flex-col gap-5 lg:gap-6">
            <Card data-report-block="comparison">
              <CardContent>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-ink lg:text-lg">
                    {selected.displayName ?? "Pessoa acompanhada"} · últimos {data.days} dias
                  </h2>
                  <LayerBadge layer="deterministic" />
                </div>
                <p className="mb-4 text-sm text-ink-muted">
                  {report
                    ? `${formatDate(report.window.from)} a ${formatDate(report.window.to)}, comparado com ${formatDate(report.previousWindow.from)} a ${formatDate(report.previousWindow.to)}. Datas no fuso de São Paulo.`
                    : "Nenhum dado emocional ou de sono faz parte deste acesso."}
                </p>
                {report ? (
                  <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
                    {selected.emotionalShared ? (
                      <>
                        <ComparisonCard
                          label="Humor médio"
                          comparison={report.metrics.mood}
                          format={(v) => formatScore(v) ?? "—"}
                          unit="/10"
                          tone="brand"
                          icon={<Smile />}
                          higherIsBetter
                          layout="row"
                          showSampleNote={!sameNote}
                        />
                        <ComparisonCard
                          label="Ansiedade média"
                          comparison={report.metrics.anxiety}
                          format={(v) => formatScore(v) ?? "—"}
                          unit="/10"
                          tone="anxiety"
                          icon={<Brain />}
                          higherIsBetter={false}
                          layout="row"
                          showSampleNote={!sameNote}
                        />
                        <ComparisonCard
                          label="Energia média"
                          comparison={report.metrics.energy}
                          format={(v) => formatScore(v) ?? "—"}
                          unit="/10"
                          tone="energy"
                          icon={<Zap />}
                          higherIsBetter
                          layout="row"
                          showSampleNote={!sameNote}
                        />
                      </>
                    ) : null}
                    {selected.sleepShared ? (
                      <ComparisonCard
                        label="Sono médio"
                        comparison={report.metrics.sleepDurationMinutes}
                        format={hours}
                        tone="sleep"
                        icon={<Moon />}
                        higherIsBetter
                        layout="row"
                          showSampleNote={!sameNote}
                      />
                    ) : null}
                  </div>
                ) : null}
                {allInsufficient ? (
                  <p className="mt-3 text-xs text-ink-muted">
                    Ainda não dá para afirmar uma tendência em nenhum indicador: são necessários ao menos{" "}
                    {MIN_DAYS_FOR_COMPARISON} dias com registro em cada um dos dois períodos.
                  </p>
                ) : sameNote && shownComparisons[0] ? (
                  <SampleSizeNote comparison={shownComparisons[0]} className="mt-3" />
                ) : null}
              </CardContent>
            </Card>
            <div className="grid items-start gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" data-layout="columns">
              <div className="flex min-w-0 flex-col gap-5 lg:gap-6" data-layout-column="main">
                {report && series.length > 0 ? (
            <Card data-report-block="evolution">
              <CardContent>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-ink lg:text-lg">Evolução diária</h2>
                  <LayerBadge layer="observed" />
                </div>
                {hasAnyPoint ? (
                  <ReportEvolution points={points} series={series} />
                ) : (
                  <EmptyState
                    size="compact"
                    title="Sem registro no período"
                    description="Há permissão para estes dados, mas nenhum dia com registro nesta janela."
                  />
                )}
              </CardContent>
            </Card>
                ) : (
                  <Card>
                    <CardContent>
                      <p className="text-sm text-ink-muted">
                        Evolução diária aparece quando dados emocionais ou de sono fazem parte do acesso.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-5 lg:gap-6" data-layout-column="side">
            <Card data-report-block="snapshots">
              <CardContent>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-ink lg:text-lg">Relatórios salvos</h2>
                  <LayerBadge layer="deterministic" />
                </div>
                {!selected.reportsShared ? (
                  <p className="text-sm text-ink-muted">Relatórios salvos não fazem parte deste acesso.</p>
                ) : !selected.snapshots || selected.snapshots.length === 0 ? (
                  <p className="text-sm text-ink-muted">A pessoa ainda não tem relatórios salvos dentro do período compartilhado.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-line">
                    {selected.snapshots.map((snapshot) => {
                      const open = selected.snapshot?.id === snapshot.id;
                      return (
                        <li key={snapshot.id} className="py-2.5 first:pt-0 last:pb-0">
                          <Link
                            href={{
                              pathname: "/pro/relatorios",
                              query: {
                                pessoa: selected.clientUserId,
                                periodo: String(data.days),
                                snapshot: snapshot.id,
                              },
                            }}
                            aria-current={open ? "true" : undefined}
                            className="flex items-center justify-between gap-3 rounded-control text-sm hover:text-brand-700"
                          >
                            <span className="font-medium text-ink">
                              {formatDate(snapshot.period_start)} a {formatDate(snapshot.period_end)}
                            </span>
                            <span className="text-xs text-ink-muted">{snapshot.range_days} dias</span>
                          </Link>
                          {open && selected.snapshot ? (
                            <div className="mt-3">
                              <SnapshotDetail payload={selected.snapshot.payload} />
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card data-report-block="ai">
              <CardContent>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-ink lg:text-lg">
                    <Sparkles className="size-4 text-attention" aria-hidden="true" />
                    Leituras de sessão
                  </h2>
                  <LayerBadge layer="ai" />
                </div>
                {!selected.aiShared ? (
                  <p className="text-sm text-ink-muted">
                    Leituras assistidas por IA não fazem parte deste acesso.
                  </p>
                ) : !selected.interpretations || selected.interpretations.length === 0 ? (
                  <InlineEmpty>Nenhuma leitura de sessão no período.</InlineEmpty>
                ) : (
                  <>
                    <p className="text-sm text-ink">
                      {selected.interpretations.length === 1
                        ? "1 leitura de sessão no período."
                        : `${selected.interpretations.length} leituras de sessão no período.`}
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">
                      É o que um modelo leu dos sinais da sessão, não um fato sobre a pessoa. Abra no dossiê, aba Sessões.
                    </p>
                    <Button asChild size="sm" variant="secondary" className="mt-3">
                      <Link href={`/pro/acompanhamentos/${selected.clientUserId}`}>Abrir dossiê</Link>
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
              </div>
            </div>
            <NonClinicalNotice context="professional" />
        </div>
      )}
    </>
  );
}
