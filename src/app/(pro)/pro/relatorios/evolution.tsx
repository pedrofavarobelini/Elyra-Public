"use client";

import { useState } from "react";

import { ChartLegend } from "@/components/charts/chart-legend";
import { CHART_COLORS, SERIES_DASH } from "@/components/charts/chart-theme";
import { EvolutionChart, type EvolutionPoint, type EvolutionSeries } from "@/components/charts/evolution-chart";
import { hasAnyGap } from "@/components/charts/gaps";
import { EmptyState } from "@/components/states";
import { cn } from "@/lib/utils";


export function ReportEvolution({ points, series }: { points: EvolutionPoint[]; series: EvolutionSeries[] }) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(series.slice(1).map((item) => item.key)));
  const visible = series.filter((item) => !hidden.has(item.key));
  const round = (value: number | null | undefined) => (typeof value === "number" ? Math.round(value * 10) / 10 : value);
  const data = points.map((point) => ({
    ...point,
    mood: round(point.mood),
    anxiety: round(point.anxiety),
    energy: round(point.energy),
    sleep: round(point.sleep),
  }));

  return (
    <>
      {series.length > 1 ? (
        <div role="group" aria-label="Séries exibidas no gráfico" className="mb-3 flex flex-wrap gap-2">
          {series.map(({ key, label }) => {
            const on = !hidden.has(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setHidden((current) => {
                    const next = new Set(current);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                className={cn(
                  "motion-press inline-flex min-h-9 items-center gap-2 rounded-pill border px-3 py-1.5 text-xs font-medium transition-colors",
                  on
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
                    opacity: on ? 1 : 0.4,
                  }}
                />
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
      {visible.length === 0 ? (
        <EmptyState
          size="compact"
          title="Nenhuma série selecionada"
          description="Escolha ao menos um indicador acima para ver a evolução."
        />
      ) : (
        <>
          <ChartLegend
            className="mb-3"
            items={visible}
            showGap={hasAnyGap(
              data,
              visible.map((item) => item.key),
            )}
          />
          <EvolutionChart
            data={data}
            series={visible}
            height={280}
            tableNote="média do dia; dia sem registro fica hachurado, nunca vira zero"
          />
        </>
      )}
    </>
  );
}
