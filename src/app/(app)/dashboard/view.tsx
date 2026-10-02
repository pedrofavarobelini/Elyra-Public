"use client";

import {
  BatteryCharging,
  Bed,
  Brain,
  CalendarRange,
  LineChart as LineChartIcon,
  Flower2,
  History,
  Moon,
  NotebookPen,
  Sparkles,
  Target,
  Video,
} from "lucide-react";
import Link from "next/link";

import { ChartCard } from "@/components/charts/chart-card";
import { ComparisonCard } from "@/components/charts/comparison-card";
import {
  describeSampleSize,
  SampleSizeNote,
} from "@/components/charts/sample-size";
import { ChartLegend } from "@/components/charts/chart-legend";
import { hasAnyGap } from "@/components/charts/gaps";
import { ScoreLineChart } from "@/components/charts/score-line-chart";
import { EmptyState } from "@/components/states";
import { ProductArtwork } from "@/components/product/product-artwork";
import { PersonalPlanCard } from "@/components/today/personal-plan-card";
import { TodayPanel } from "@/components/today/today-panel";
import { ActionTile } from "@/components/ui/action-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { NonClinicalNotice } from "@/components/ui/non-clinical-notice";
import { StatCard } from "@/components/ui/stat-card";
import { PRIMARY_FEELING_LABEL } from "@/lib/contracts/emotional";
import { PHASE_LABEL } from "@/lib/contracts/cycle";
import {
  cycleDay,
  derivedPhase,
  effectiveCycleLength,
  fromISODate,
} from "@/lib/cycle";
import { latestCheckin, latestSleep } from "@/lib/derive";
import {
  buildAnalyticsReport,
  civilDateInTimeZone,
  MIN_DAYS_FOR_COMPARISON,
} from "@/lib/reports";
import { COMPARISON_WINDOW_DAYS } from "@/lib/contracts/reports";
import {
  buildFactorFrequency,
  daysWithGoalProgress,
} from "@/lib/cross-domain";
import { formatDuration, formatScore } from "@/lib/utils";
import { useMockStore } from "@/mocks/store";

const SERIES = [
  { key: "mood" as const, label: "Humor" },
  { key: "anxiety" as const, label: "Ansiedade percebida" },
];


export function DashboardView() {
  const { user, checkins, sleep, cycle, periods, factors, goalProgress } =
    useMockStore();

  const last = latestCheckin(checkins);
  const night = latestSleep(sleep);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const referenceDate = civilDateInTimeZone(new Date(), timeZone);
  const analytics = buildAnalyticsReport({
    referenceDate,
    days: 7,
    timeZone,
    checkins,
    sleep,
    periods,
    cycleEnabled: cycle.enabled,
  });
  // "melhorou em tres meses?" e uma pergunta diferente de "como foi a semana?",
  // e nenhuma responde a outra. A janela longa usa a **mesma** funcao - o que
  // muda e o tamanho, nao a regra.
  const quarter = buildAnalyticsReport({
    referenceDate,
    days: 90,
    timeZone,
    checkins,
    sleep,
    periods,
    cycleEnabled: cycle.enabled,
  });
  // Contagem observada, nao interpretacao: diz em quantos dias o fator apareceu
  // e nada alem disso. Tres, porque uma lista longa aqui vira decoracao.
  const fatoresFrequentes = buildFactorFrequency({
    window: analytics.window,
    timeZone,
    checkins,
    factors,
  }).slice(0, 3);
  const diasComMeta = daysWithGoalProgress({
    window: analytics.window,
    goalProgress,
  });

  const series = analytics.series.map((point) => ({
    day: point.date,
    label: dailyLabel(point.date),
    mood: point.mood,
    anxiety: point.anxiety,
  }));
  const hasData = series.some((p) => p.mood !== null || p.anxiety !== null);

  // Base amostral da semana: se as quatro comparacoes tem exatamente a mesma
  // frase, ela aparece uma vez para o grupo em vez de quatro vezes identicas.
  const weekComparisons = [
    analytics.metrics.mood,
    analytics.metrics.anxiety,
    analytics.metrics.energy,
    analytics.metrics.sleepDurationMinutes,
  ];
  const sharedWeekNote = new Set(weekComparisons.map(describeSampleSize)).size === 1;
  // Semana sem nenhum registro: uma unica explicacao substitui quatro linhas
  // "Sem registro" identicas. Com qualquer dado, cada comparacao volta a ter a
  // propria linha e a propria base amostral.
  const weekEmpty = weekComparisons.every(
    (comparison) => comparison.current === null && comparison.previous === null,
  );

  const todayLabel = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <>
      {/*
        A + B. Um unico painel responde "como estou hoje?": saudacao, convite
        ao check-in e as metricas do ultimo registro. A atmosfera (degrade e
        relevo) fica so aqui, atras do conteudo, sem carregar informacao.
      */}
      <section
        aria-labelledby="dashboard-saudacao"
        className="relative mb-4 overflow-hidden rounded-panel border border-line bg-gradient-to-br from-brand-100 via-surface-brand to-identity-50 shadow-card sm:mb-5"
      >
        <ProductArtwork
          avifSrc="/placeholder/artwork.svg"
          webpSrc="/placeholder/artwork.svg"
          width={1344}
          height={768}
          eager
          className="pointer-events-none absolute inset-0 hidden overflow-hidden sm:block"
          imageClassName="h-full w-full object-cover object-center opacity-55 [mask-image:linear-gradient(to_left,black_12%,rgba(0,0,0,0.72)_58%,transparent_92%)] dark:brightness-[0.45] dark:saturate-[1.15] dark:opacity-45"
        />

        <div className="relative grid gap-4 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] lg:items-center lg:gap-8 lg:p-8">
          <div className="min-w-0">
            <p
              className="text-sm font-medium first-letter:uppercase text-brand-700"
              suppressHydrationWarning
            >
              {todayLabel}
            </p>
            <h1
              id="dashboard-saudacao"
              className="mt-1 text-[1.625rem] font-semibold leading-8 tracking-tight text-ink lg:text-[2rem] lg:leading-10"
            >
              Olá, {user.name}
            </h1>
            <p className="mt-2 max-w-md text-[0.9375rem] leading-6 text-ink-muted">
              Pequenos passos de hoje constroem um amanhã mais leve. Você está
              fazendo um ótimo trabalho.
            </p>
          </div>

          <div className="rounded-card border border-surface/70 bg-surface/85 p-4 shadow-card backdrop-blur-sm sm:p-5">
            <h2 className="text-base font-semibold text-ink lg:text-lg">
              Como você está se sentindo hoje?
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Registrar como você se sente ajuda a entender seus padrões.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button asChild className="w-full sm:w-auto">
                <Link href="/meu-humor">Fazer check-in</Link>
              </Button>
              {last?.primaryFeeling ? (
                <span className="text-sm text-ink-muted">
                  Último registro:{" "}
                  <strong className="font-medium text-ink">
                    {PRIMARY_FEELING_LABEL[last.primaryFeeling]}
                  </strong>
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <section
          aria-label="Métricas do dia"
          className="relative grid grid-cols-2 gap-3 px-4 pb-4 sm:px-6 sm:pb-6 lg:grid-cols-4 lg:px-8 lg:pb-8"
        >
          <StatCard
            label="Ansiedade percebida"
            value={formatScore(last?.perceivedAnxiety ?? null)}
            unit="/10"
            tone="anxiety"
            icon={<Brain />}
            hint="Valor autorrelatado por você, não medido pelo sistema."
          />
          <StatCard
            label="Qualidade do sono"
            value={formatScore(night?.quality ?? null)}
            unit="/10"
            tone="sleep"
            icon={<Moon />}
          />
          <StatCard
            label="Horas dormidas"
            value={formatDuration(night?.durationMinutes ?? null)}
            tone="sleep"
            icon={<Bed />}
          />
          <StatCard
            label="Energia"
            value={formatScore(last?.energy ?? null)}
            unit="/10"
            tone="energy"
            icon={<BatteryCharging />}
          />
        </section>
      </section>

      {/*
        Hoje na Elyra (Era 8, 8.1). Entra depois do heroi e antes das acoes
        rapidas: primeiro "como estou", depois "o que ha hoje", depois "o que
        posso fazer". A derivacao e pura e vive em `@/lib/today`.
      */}
      <TodayPanel />

      {/*
        Meu caminho na Elyra (Era 8, 8.8 + acesso as rotinas de 8.7). Le o
        `primaryGoal` que ja existia; nenhuma pergunta nova.
      */}
      <PersonalPlanCard />

      {/* C. Acoes rapidas: os gestos diarios a um toque. */}
      <section
        aria-label="Ações rápidas"
        className="mb-4 grid grid-cols-2 gap-3 sm:mb-5 xl:grid-cols-4"
      >
        <ActionTile
          href="/diario"
          label="Nova anotação"
          description="Escreva no seu diário privado"
          icon={<NotebookPen />}
        />
        <ActionTile
          href="/sessoes"
          label="Preparar sessão"
          description="Você escolhe os recursos de cada sessão"
          icon={<Video />}
        />
        <ActionTile
          href="/metas"
          label="Acompanhar metas"
          description="Registre o progresso de hoje"
          icon={<Target />}
          tone="positive"
        />
        <ActionTile
          href="/historico"
          label="Rever check-ins"
          description="Veja e edite registros anteriores"
          icon={<History />}
          tone="neutral"
        />
      </section>

      {/* D + E. O grafico ganha a posicao forte; o resumo fica ao lado. */}
      <div className="mb-4 grid gap-4 sm:mb-5 lg:gap-5 xl:grid-cols-12">
        <ChartCard
          className="self-start xl:col-span-7 2xl:col-span-8"
          title="Evolução emocional"
          description="Seu humor e ansiedade percebida ao longo da semana."
          hint="Dias sem registro aparecem como lacuna e não são estimados."
          action={
            <div className="flex items-center gap-2">
              <Badge tone="brand">Últimos {COMPARISON_WINDOW_DAYS[0]} dias</Badge>
              <Button asChild variant="link" size="sm" className="px-2">
                <Link href="/historico">Ver histórico</Link>
              </Button>
            </div>
          }
        >
          {hasData ? (
            <>
              <ChartLegend
                items={SERIES}
                showGap={hasAnyGap(series, SERIES.map((s) => s.key))}
                className="mb-3"
              />
              <ScoreLineChart data={series} series={SERIES} />
            </>
          ) : (
            <EmptyState
              size="compact"
              icon={<LineChartIcon />}
              title="Ainda não há registros nesta semana"
              description="O gráfico aparece a partir do primeiro check-in. Dias sem registro ficam como lacuna."
              action={
                <Button asChild size="sm">
                  <Link href="/meu-humor">Fazer check-in</Link>
                </Button>
              }
            />
          )}
        </ChartCard>

        <section
          aria-labelledby="dashboard-semana"
          className="rounded-card border border-line bg-surface p-4 shadow-card sm:p-5 xl:col-span-5 2xl:col-span-4"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="dashboard-semana" className="text-base font-semibold text-ink">
              Como foi sua semana
            </h2>
            <Badge tone="brand">
              {COMPARISON_WINDOW_DAYS[0]} dias vs. os {COMPARISON_WINDOW_DAYS[0]} anteriores
            </Badge>
          </div>
          {weekEmpty ? (
            <EmptyState
              size="compact"
              icon={<CalendarRange />}
              title="Sem registros para comparar"
              description={`As comparações de humor, ansiedade, energia e sono aparecem quando houver ao menos ${MIN_DAYS_FOR_COMPARISON} dias com registro em cada semana.`}
            />
          ) : (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1">
            <ComparisonCard
              layout="row"
              showSampleNote={!sharedWeekNote}
              label="Humor"
              comparison={analytics.metrics.mood}
              format={(v) => formatScore(v) ?? "—"}
              unit="/10"
              tone="brand"
              icon={<Sparkles />}
              higherIsBetter
              windowDays={COMPARISON_WINDOW_DAYS[0]}
            />
            <ComparisonCard
              layout="row"
              showSampleNote={!sharedWeekNote}
              label="Ansiedade percebida"
              comparison={analytics.metrics.anxiety}
              format={(v) => formatScore(v) ?? "—"}
              unit="/10"
              tone="anxiety"
              icon={<Brain />}
              higherIsBetter={false}
              windowDays={COMPARISON_WINDOW_DAYS[0]}
            />
            <ComparisonCard
              layout="row"
              showSampleNote={!sharedWeekNote}
              label="Energia"
              comparison={analytics.metrics.energy}
              format={(v) => formatScore(v) ?? "—"}
              unit="/10"
              tone="energy"
              icon={<BatteryCharging />}
              higherIsBetter
              windowDays={COMPARISON_WINDOW_DAYS[0]}
            />
            <ComparisonCard
              layout="row"
              showSampleNote={!sharedWeekNote}
              label="Horas dormidas"
              comparison={analytics.metrics.sleepDurationMinutes}
              format={(v) => formatDuration(v) ?? "—"}
              formatDelta={(v) => formatDuration(Math.abs(v)) ?? "—"}
              tone="sleep"
              icon={<Bed />}
              higherIsBetter
              windowDays={COMPARISON_WINDOW_DAYS[0]}
            />
          </div>
          )}
          {sharedWeekNote && !weekEmpty ? (
            <SampleSizeNote
              comparison={analytics.metrics.mood}
              className="mt-3 rounded-control bg-surface-muted px-3 py-2"
            />
          ) : null}
        </section>
      </div>

      {/* F. Contexto. */}
      <div className="grid gap-4 md:grid-cols-2 lg:gap-5 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <CycleCard enabled={cycle.enabled} periods={periods} />
        </div>

        <section aria-label="O que apareceu na semana" className="contents">
          <Card className="p-4 sm:p-5 xl:col-span-4">
            <h2 className="text-base font-semibold text-ink">
              Quais fatores apareceram mais
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Contagem de dias em que você registrou cada fator nesta semana.
            </p>
            {fatoresFrequentes.length === 0 ? (
              <p className="mt-3 text-sm text-ink-subtle">
                Nenhum fator registrado nesta semana.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {fatoresFrequentes.map((fator) => (
                  <li
                    key={fator.factorId}
                    className="flex items-baseline justify-between gap-3 rounded-control bg-surface-muted px-3 py-2 text-sm"
                  >
                    <span className="text-ink">{fator.label}</span>
                    <span className="tabular-nums text-ink-muted">
                      {fator.days === 1 ? "1 dia" : `${fator.days} dias`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4 sm:p-5 xl:col-span-4">
            <h2 className="text-base font-semibold text-ink">
              Como as metas evoluíram
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Dias com progresso registrado nesta semana.
            </p>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-ink">
                {diasComMeta}
              </span>
              <span className="text-sm text-ink-muted">
                de {COMPARISON_WINDOW_DAYS[0]} dias
              </span>
            </p>
            <div aria-hidden="true" className="mt-2 flex gap-1">
              {Array.from({ length: COMPARISON_WINDOW_DAYS[0] }, (_, index) => (
                <span
                  key={index}
                  style={{ animationDelay: `${index * 40}ms` }}
                  className={
                    index < diasComMeta
                      ? "motion-grow-x h-1.5 flex-1 rounded-pill bg-positive"
                      : "h-1.5 flex-1 rounded-pill bg-surface-sunken"
                  }
                />
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-subtle">
              Dia sem registro é ausência de registro, e não ausência de
              progresso.
            </p>
          </Card>
        </section>

        <section aria-label="Leitura de longo prazo" className="xl:col-span-6">
          <Card className="h-full p-4 sm:p-5">
            <h2 className="text-base font-semibold text-ink">
              E em três meses?
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              Humor nos últimos 90 dias, comparado com os 90 anteriores. A
              comparação é sempre com o seu próprio histórico.
            </p>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums tracking-tight text-ink">
                {formatScore(quarter.metrics.mood.current) ?? "Sem registro"}
              </span>
              {quarter.metrics.mood.current !== null ? (
                <span className="text-sm text-ink-muted">/10</span>
              ) : null}
            </p>
            <SampleSizeNote comparison={quarter.metrics.mood} />
          </Card>
        </section>

        <Card className="flex flex-col gap-4 p-4 sm:p-5 xl:col-span-6">
          <div className="flex items-start gap-3 sm:gap-4">
            <IconPill tone="brand">
              <Sparkles />
            </IconPill>
            <div>
              <h3 className="font-semibold text-ink">Análise inteligente</h3>
              <p className="mt-1 text-sm text-ink-muted">
                Nesta semana há registros emocionais em{" "}
                {Math.max(
                  analytics.dataQuality.daysWithMood,
                  analytics.dataQuality.daysWithAnxiety,
                )}{" "}
                de {COMPARISON_WINDOW_DAYS[0]} dias. Dias sem registro continuam
                como lacunas.
              </p>
            </div>
          </div>
          <NonClinicalNotice context="insight" className="mt-auto" />
        </Card>
      </div>
    </>
  );
}

/**
 * Card de ciclo do dashboard (figura 1).
 *
 * So aparece com dado quando o modulo esta ativado: o opt-in governa o acesso em
 * toda superficie, nao apenas na rota do ciclo. Desativado, o card e um convite
 * - nunca uma previa dos dados.
 */
function CycleCard({
  enabled,
  periods,
}: {
  enabled: boolean;
  periods: ReturnType<typeof useMockStore>["periods"];
}) {
  if (!enabled) {
    return (
      <Card className="flex h-full items-start gap-3 p-4 sm:gap-4 sm:p-5">
        <IconPill tone="cycle">
          <Flower2 />
        </IconPill>
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">Acompanhe seu ciclo</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Observe como o seu ciclo aparece junto de humor, sono e energia.
            Você ativa quando quiser.
          </p>
          <Button asChild variant="soft" size="sm" className="mt-3">
            <Link href="/ciclo">Conhecer o acompanhamento</Link>
          </Button>
        </div>
      </Card>
    );
  }

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = civilDateInTimeZone(new Date(), timeZone);
  const day = cycleDay(periods, today);
  const length = effectiveCycleLength(periods);
  const phase = derivedPhase(periods, today);

  return (
    <Card className="flex h-full items-start gap-3 p-4 sm:gap-4 sm:p-5">
      <IconPill tone="cycle">
        <Flower2 />
      </IconPill>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-ink">Seu ciclo</h3>
        {day === null ? (
          <p className="mt-1 text-sm text-ink-subtle">
            Sem período registrado ainda.
          </p>
        ) : (
          <>
            <p className="mt-1 text-lg font-semibold text-cycle">
              Dia {day} de {length}
            </p>
            <div
              role="progressbar"
              aria-valuenow={Math.round((day / length) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progresso do ciclo atual"
              className="mt-2 h-2 overflow-hidden rounded-pill bg-cycle-soft"
            >
              <div
                className="motion-grow-x h-full rounded-pill bg-cycle"
                style={{ width: `${Math.min(100, (day / length) * 100)}%` }}
              />
            </div>
            {phase ? (
              <p className="mt-1.5 text-xs text-ink-subtle">
                {PHASE_LABEL[phase]} (estimada)
              </p>
            ) : null}
          </>
        )}
        <Button asChild variant="link" size="sm" className="mt-2 px-0">
          <Link href="/ciclo">Ver ciclo</Link>
        </Button>
      </div>
    </Card>
  );
}

const WEEKDAY = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

function dailyLabel(date: string): string {
  const value = fromISODate(date);
  return `${WEEKDAY[value.getDay()]} ${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}`;
}
