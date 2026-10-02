"use client";

import {
  AlertTriangle,
  CalendarDays,
  Download,
  Droplet,
  Flower2,
  Plus,
  Sparkles,
} from "lucide-react";
import { useState } from "react";

import { ChartCard } from "@/components/charts/chart-card";
import { ChartLegend } from "@/components/charts/chart-legend";
import { hasAnyGap } from "@/components/charts/gaps";
import { ScoreLineChart } from "@/components/charts/score-line-chart";
import { CycleCalendar, type DayMarkers } from "@/components/cycle/cycle-calendar";
import { DayPanel } from "@/components/cycle/day-panel";
import { CycleRecordDialog } from "@/components/cycle/record-dialog";
import { PageHeader } from "@/components/journey/page-header";
import { HISTORY_DOMAINS, OlderHistoryNotice } from "@/components/journey/older-history";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { NonClinicalNotice } from "@/components/ui/non-clinical-notice";
import { toDay } from "@/lib/contracts/goals";
import {
  addDays,
  averageCycleLength,
  averagePeriodLength,
  cycleDay,
  cyclesConsidered,
  daysBetween,
  daysUntilNextPeriod,
  derivedPhase,
  effectiveCycleLength,
  estimatedNextPeriodStart,
  fromISODate,
  registeredPeriodBands,
  sortedPeriods,
  toISODate,
} from "@/lib/cycle";
import { PHASE_LABEL } from "@/lib/contracts/cycle";
import { averageIgnoringNulls } from "@/lib/derive";
import { useMockStore } from "@/mocks/store";

/**
 * Ciclo e bem-estar (figura 3).
 *
 * Duas regras governam esta tela:
 *
 *  1. **Estimativa nunca vira certeza.** Toda previsao carrega a palavra
 *     "estimada" e o calendario usa marcador visual distinto do registro real.
 *  2. **Sobreposicao nao e causalidade.** O grafico coloca ciclo e bem-estar no
 *     mesmo eixo do tempo; o texto fala em associacao temporal, nunca em causa.
 */

const SERIES = [
  { key: "mood" as const, label: "Humor" },
  { key: "anxiety" as const, label: "Ansiedade percebida" },
  { key: "sleep" as const, label: "Sono (horas)" },
  { key: "energy" as const, label: "Energia" },
];

const WINDOW_DAYS = 56;

export function CycleView() {
  const {
    periods,
    cycleRecords,
    symptoms,
    checkins,
    sleep,
    goalProgress,
    journal,
    saveCycleRecord,
    deleteCycleRecord,
    addCustomSymptom,
  } = useMockStore();

  const today = toDay(new Date());
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => {
    const d = fromISODate(today);
    return toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [editing, setEditing] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const ordered = sortedPeriods(periods);
  const last = ordered.at(-1) ?? null;
  const day = cycleDay(periods, today);
  const length = effectiveCycleLength(periods);
  const average = averageCycleLength(periods);
  const periodLength = averagePeriodLength(periods);
  const nextStart = estimatedNextPeriodStart(periods);
  const untilNext = daysUntilNextPeriod(periods, today);
  const phase = derivedPhase(periods, today);

  const record = cycleRecords.find((r) => r.date === selected) ?? null;
  const dayCheckins = checkins.filter(
    (c) => toDay(new Date(c.occurredAt)) === selected,
  );
  const daySleep = sleep.find((s) => s.night === selected) ?? null;

  const markers: Record<string, DayMarkers> = {};
  for (const r of cycleRecords) {
    markers[r.date] = {
      ...markers[r.date],
      symptoms: r.symptoms.length > 0,
    };
  }
  for (const c of checkins) {
    const d = toDay(new Date(c.occurredAt));
    markers[d] = { ...markers[d], mood: true };
  }
  for (const s of sleep) {
    markers[s.night] = { ...markers[s.night], other: true };
  }
  for (const g of goalProgress) {
    markers[g.day] = { ...markers[g.day], other: true };
  }
  for (const j of journal) {
    const d = toDay(new Date(j.createdAt));
    markers[d] = { ...markers[d], other: true };
  }

  const series = buildSeries(today, checkins, sleep);
  const bands = registeredPeriodBands(
    periods,
    addDays(today, -(WINDOW_DAYS - 1)),
    today,
  ).map((b) => ({ from: shortLabel(b.from), to: shortLabel(b.to) }));

  const periodStart = last ? fromISODate(last.startDate).toLocaleDateString("pt-BR") : null;
  const periodEnd = last?.endDate
    ? fromISODate(last.endDate).toLocaleDateString("pt-BR")
    : null;

  const deleteSelectedRecord = async () => {
    setOperationError(null);
    try {
      await deleteCycleRecord(selected);
    } catch (caught) {
      setOperationError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível excluir o registro.",
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Ciclo"
        description="Acompanhe seu ciclo menstrual e como você se sente em cada fase."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled>
              <Download aria-hidden="true" />
              Exportar
            </Button>
            <Button
              onClick={() => {
                setSelected(today);
                setEditing(true);
              }}
            >
              <Plus aria-hidden="true" />
              Registrar dados
            </Button>
          </div>
        }
      />

      <OlderHistoryNotice domains={HISTORY_DOMAINS.cycle} />

      <section
        aria-label="Resumo do ciclo"
        className="mb-5 grid gap-3 sm:grid-cols-2 lg:gap-4 xl:grid-cols-4"
      >
        <Card role="group" aria-label="Ciclo atual" className="p-4 sm:p-5">
          <div className="flex items-start gap-4">
            {day === null ? (
              <IconPill tone="cycle">
                <Flower2 />
              </IconPill>
            ) : (
              <CycleRing value={Math.min(1, day / length)} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-muted">Ciclo atual</p>
              {day === null ? (
                <p className="mt-1 text-sm text-ink-subtle">Sem registro</p>
              ) : (
                <>
                  <p className="mt-0.5 text-xl font-semibold text-cycle">
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
                      className="h-full rounded-pill bg-cycle"
                      style={{ width: `${Math.min(100, (day / length) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-ink-subtle">
                    {Math.round((day / length) * 100)}% do ciclo
                    {/* PHASE_LABEL ja comeca com "Fase" nas fases folicular e
                        lutea - prefixar de novo produzia "fase fase lutea". */}
                    {phase ? ` · ${PHASE_LABEL[phase]} (estimada)` : ""}
                  </p>
                </>
              )}
            </div>
          </div>
        </Card>

        <Card
          role="group"
          aria-label="Próxima menstruação estimada"
          className="flex items-start gap-4 p-4 sm:p-5"
        >
          <IconPill tone="brand">
            <CalendarDays />
          </IconPill>
          <div>
            <p className="text-sm text-ink-muted">
              Próxima menstruação estimada
            </p>
            {nextStart === null || untilNext === null ? (
              <p className="mt-1 text-sm text-ink-subtle">Sem registro</p>
            ) : (
              <>
                <p className="mt-0.5 text-lg font-semibold text-ink">
                  Em aproximadamente {Math.max(0, untilNext)}{" "}
                  {untilNext === 1 ? "dia" : "dias"}
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {fromISODate(nextStart).toLocaleDateString("pt-BR", {
                    day: "numeric",
                    month: "long",
                  })}{" "}
                  · estimativa, não uma certeza
                </p>
              </>
            )}
          </div>
        </Card>

        <Card
          role="group"
          aria-label="Último período"
          className="flex items-start gap-4 p-4 sm:p-5"
        >
          <IconPill tone="cycle">
            <Droplet />
          </IconPill>
          <div>
            <p className="text-sm text-ink-muted">Último período</p>
            {last === null ? (
              <p className="mt-1 text-sm text-ink-subtle">Sem registro</p>
            ) : (
              <>
                <p className="mt-0.5 text-lg font-semibold text-ink">
                  {formatRange(last.startDate, last.endDate)}
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  {last.endDate
                    ? `Duração: ${daysBetween(last.startDate, last.endDate) + 1} dias`
                    : "Em curso"}
                </p>
              </>
            )}
          </div>
        </Card>

        <Card
          role="group"
          aria-label="Média dos ciclos"
          className="flex items-start gap-4 p-4 sm:p-5"
        >
          <IconPill tone="brand">
            <CalendarDays />
          </IconPill>
          <div>
            <p className="text-sm text-ink-muted">Média dos ciclos</p>
            {average === null ? (
              <>
                <p className="mt-1 text-sm text-ink-subtle">Sem registro</p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  É preciso mais de um período para calcular
                </p>
              </>
            ) : (
              <>
                <p className="mt-0.5 text-lg font-semibold text-ink">
                  {average} dias
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  Baseado nos últimos {cyclesConsidered(periods)} ciclos
                  {periodLength ? ` · período de ${periodLength} dias` : ""}
                </p>
              </>
            )}
          </div>
        </Card>
      </section>

      <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(20rem,1fr)] 2xl:grid-cols-[minmax(0,1.7fr)_minmax(24rem,1fr)]">
        <Card>
          <CardContent>
            <CycleCalendar
              month={month}
              periods={periods}
              markers={markers}
              selected={selected}
              today={today}
              estimatedPeriodLength={periodLength ?? 5}
              onSelect={setSelected}
              onMonthChange={setMonth}
            />
          </CardContent>
        </Card>

        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardContent>
            <DayPanel
              date={selected}
              record={record}
              symptoms={symptoms}
              periodStart={periodStart}
              periodEnd={periodEnd}
              flowDays={
                last?.endDate
                  ? daysBetween(last.startDate, last.endDate) + 1
                  : null
              }
              checkins={dayCheckins}
              sleep={daySleep}
              onEdit={() => setEditing(true)}
              onDelete={() => void deleteSelectedRecord()}
            />
          </CardContent>
        </Card>
      </div>

      {operationError ? (
        <p role="alert" className="mb-6 text-sm text-destructive">
          {operationError}
        </p>
      ) : null}

      <ChartCard
        title="Ciclo e bem-estar"
        description="Veja a relação entre seu ciclo menstrual e seus registros de bem-estar ao longo do tempo."
        hint="As faixas rosas marcam períodos registrados, nunca estimados."
        action={<Badge tone="cycle">Últimos {WINDOW_DAYS} dias</Badge>}
      >
        <ChartLegend
          items={SERIES}
          showGap={hasAnyGap(series, SERIES.map((s) => s.key))}
          className="mb-3"
        />
        <ScoreLineChart data={series} series={SERIES} cycleBands={bands} height={300} />

        <p
          role="note"
          data-testid="cycle-estimate-disclaimer"
          className="mt-5 flex items-start gap-3 rounded-control bg-attention-soft p-4 text-sm text-ink"
        >
          <AlertTriangle
            className="mt-0.5 size-4 shrink-0 text-attention"
            aria-hidden="true"
          />
          <span>
            As previsões de menstruação, de ovulação e as fases exibidas são{" "}
            <strong className="font-medium">estimativas</strong> calculadas a
            partir das datas que você registrou. A Elyra não é método
            contraceptivo, não indica fertilidade e não substitui avaliação
            profissional.
          </span>
        </p>

        <Card className="mt-5 border-0 bg-surface-brand shadow-none">
          <CardContent className="flex items-start gap-3">
            <IconPill tone="brand" size="sm">
              <Sparkles />
            </IconPill>
            <p className="text-sm text-brand-800">
              Nos seus registros, houve <strong>associação temporal</strong>{" "}
              entre a semana que antecede o período menstrual e níveis maiores de
              cansaço e de ansiedade percebida. Associação temporal descreve
              coincidência no tempo e não indica causa.
            </p>
          </CardContent>
        </Card>

        <NonClinicalNotice context="cycle" className="mt-4" />
      </ChartCard>

      <CycleRecordDialog
        open={editing}
        date={selected}
        record={record}
        symptoms={symptoms}
        onClose={() => setEditing(false)}
        onSave={saveCycleRecord}
        onCreateSymptom={addCustomSymptom}
      />
    </>
  );
}

/**
 * Anel do ciclo atual (decorativo; o valor legivel e a barra `progressbar` e o
 * texto "Dia X de Y" ao lado). Rosa, porque pertence ao dominio de ciclo.
 */
function CycleRing({ value }: { value: number }) {
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 48 48"
      className="size-12 shrink-0 -rotate-90"
    >
      <circle cx="24" cy="24" r={radius} fill="none" strokeWidth="5" className="stroke-cycle-soft" />
      <circle
        cx="24"
        cy="24"
        r={radius}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        className="stroke-cycle"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - value)}
      />
    </svg>
  );
}

function shortLabel(date: string): string {
  const d = fromISODate(date);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatRange(start: string, end: string | null): string {
  const s = fromISODate(start);
  if (!end) return `${s.toLocaleDateString("pt-BR")} — em curso`;
  const e = fromISODate(end);
  const month = e.toLocaleDateString("pt-BR", { month: "long" });
  return `${String(s.getDate()).padStart(2, "0")} a ${String(e.getDate()).padStart(2, "0")} de ${month}`;
}


function buildSeries(
  today: string,
  checkins: ReturnType<typeof useMockStore>["checkins"],
  sleep: ReturnType<typeof useMockStore>["sleep"],
) {
  const points = [];

  for (let i = WINDOW_DAYS - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const ofDay = checkins.filter(
      (c) => toDay(new Date(c.occurredAt)) === date,
    );
    const night = sleep.find((s) => s.night === date);

    points.push({
      label: shortLabel(date),
      mood: round1(averageIgnoringNulls(ofDay.map((c) => c.mood))),
      anxiety: round1(
        averageIgnoringNulls(ofDay.map((c) => c.perceivedAnxiety)),
      ),
      energy: round1(averageIgnoringNulls(ofDay.map((c) => c.energy))),
      sleep:
        night?.durationMinutes === null || night?.durationMinutes === undefined
          ? null
          : round1(night.durationMinutes / 60),
    });
  }

  return points;
}

function round1(value: number | null): number | null {
  return value === null ? null : Math.round(value * 10) / 10;
}
