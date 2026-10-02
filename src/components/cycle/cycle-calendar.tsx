"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CyclePeriod } from "@/lib/contracts/cycle";
import {
  addDays,
  estimatedNextPeriodStart,
  fromISODate,
  isRegisteredPeriodDay,
  toISODate,
} from "@/lib/cycle";
import { cn } from "@/lib/utils";

/**
 * Calendario mensal do ciclo (figura 3).
 *
 * Regra de produto que o componente materializa: **registro e estimativa nunca
 * se parecem**. Menstruacao registrada e um circulo rosa preenchido; menstruacao
 * estimada e um contorno tracejado. Um palpite nunca ganha a mesma aparencia de
 * um dado que a pessoa informou.
 */

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;

const MONTHS = [
  "Janeiro", "Fevereiro", "Marco", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
] as const;

export interface DayMarkers {
  /** Ha sintoma registrado neste dia. */
  symptoms?: boolean;
  /** Ha check-in emocional neste dia. */
  mood?: boolean;
  /** Ha outro registro (sono, diario, meta) neste dia. */
  other?: boolean;
}

export interface CycleCalendarProps {
  /** Primeiro dia do mes exibido, em `YYYY-MM-DD`. */
  month: string;
  periods: CyclePeriod[];
  markers: Record<string, DayMarkers>;
  selected: string;
  today: string;
  /** Duracao media do periodo, usada para a janela estimada. */
  estimatedPeriodLength: number;
  onSelect: (date: string) => void;
  onMonthChange: (month: string) => void;
}

export function CycleCalendar({
  month,
  periods,
  markers,
  selected,
  today,
  estimatedPeriodLength,
  onSelect,
  onMonthChange,
}: CycleCalendarProps) {
  const first = fromISODate(month);
  const monthIndex = first.getMonth();
  const year = first.getFullYear();

  // Grade comecando na segunda-feira.
  const leading = (first.getDay() + 6) % 7;
  const gridStart = addDays(month, -leading);

  const nextStart = estimatedNextPeriodStart(periods);
  const estimatedDays = new Set<string>();
  if (nextStart) {
    for (let i = 0; i < estimatedPeriodLength; i += 1) {
      estimatedDays.add(addDays(nextStart, i));
    }
  }

  const weeks = Array.from({ length: 6 }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)),
  );

  const shiftMonth = (delta: number) => {
    const d = fromISODate(month);
    d.setMonth(d.getMonth() + delta);
    onMonthChange(toISODate(new Date(d.getFullYear(), d.getMonth(), 1)));
  };

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <h2 className="mr-auto text-base font-semibold text-ink">
          {MONTHS[monthIndex]} {year}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Mês anterior"
          onClick={() => shiftMonth(-1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Próximo mês"
          onClick={() => shiftMonth(1)}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            const d = fromISODate(today);
            onMonthChange(toISODate(new Date(d.getFullYear(), d.getMonth(), 1)));
            onSelect(today);
          }}
        >
          Hoje
        </Button>
      </div>

      {/* `role="grid"` exige `role="row"` entre a grade e as celulas. Sem as
          linhas, o axe acusa aria-required-children/parent e o leitor de tela
          perde a nocao de semana. */}
      <div role="grid" aria-label="Calendário do ciclo">
        <div role="row" className="grid grid-cols-7">
          {WEEKDAYS.map((w) => (
            <span
              key={w}
              role="columnheader"
              className="pb-2 text-center text-xs font-medium text-ink-muted"
            >
              {w}
            </span>
          ))}
        </div>

        {weeks.map((week) => (
          <div role="row" key={week[0]} className="grid grid-cols-7 gap-y-1">
        {week.map((date) => {
          const d = fromISODate(date);
          const inMonth = d.getMonth() === monthIndex;
          const registered = isRegisteredPeriodDay(periods, date);
          const estimated = !registered && estimatedDays.has(date);
          const mark = markers[date] ?? {};
          const isSelected = date === selected;

          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              aria-selected={isSelected}
              aria-current={date === today ? "date" : undefined}
              aria-label={dayLabel(date, { registered, estimated, mark })}
              onClick={() => onSelect(date)}
              className="flex flex-col items-center gap-1 rounded-control py-1.5 transition-colors hover:bg-surface-muted"
            >
              <span
                className={cn(
                  "flex size-8 items-center justify-center rounded-pill text-sm tabular-nums",
                  // Sem opacidade: `text-ink-subtle/60` derrubava o contraste
                  // dos dias fora do mes para 2,39:1. O tom mais claro que
                  // `text-ink` ja basta para distinguir.
                  !inMonth && "text-ink-subtle",
                  inMonth && "text-ink",
                  registered && "bg-cycle-soft font-medium text-cycle",
                  estimated &&
                    "border border-dashed border-cycle text-cycle",
                  isSelected && "bg-brand-600 font-semibold text-white",
                )}
              >
                {d.getDate()}
              </span>

              <span className="flex h-1.5 items-center gap-0.5" aria-hidden="true">
                {mark.symptoms ? (
                  <span className="size-1.5 rounded-pill bg-attention" />
                ) : null}
                {mark.mood ? (
                  <span className="size-1.5 rounded-pill bg-positive" />
                ) : null}
                {mark.other ? (
                  <span className="size-1.5 rounded-pill bg-metric-sleep" />
                ) : null}
              </span>
            </button>
          );
        })}
          </div>
        ))}
      </div>

      <ul className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-line pt-4 text-xs text-ink-muted">
        <LegendItem className="bg-cycle-soft ring-1 ring-cycle/30">
          Menstruação registrada
        </LegendItem>
        <LegendItem className="border border-dashed border-cycle">
          Menstruação estimada
        </LegendItem>
        <LegendItem className="bg-attention">Sintomas registrados</LegendItem>
        <LegendItem className="bg-positive">Dados de humor</LegendItem>
        <LegendItem className="bg-metric-sleep">Outros registros</LegendItem>
      </ul>
    </div>
  );
}

function LegendItem({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={cn("size-2.5 shrink-0 rounded-pill", className)}
      />
      {children}
    </li>
  );
}

function dayLabel(
  date: string,
  state: { registered: boolean; estimated: boolean; mark: DayMarkers },
): string {
  const d = fromISODate(date);
  const parts = [d.toLocaleDateString("pt-BR")];
  if (state.registered) parts.push("menstruação registrada");
  if (state.estimated) parts.push("menstruação estimada");
  if (state.mark.symptoms) parts.push("sintomas registrados");
  if (state.mark.mood) parts.push("dados de humor");
  if (state.mark.other) parts.push("outros registros");
  return parts.join(", ");
}
