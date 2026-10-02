"use client";

import { useId } from "react";

import { useChartAnimation } from "@/lib/use-reduced-motion";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  CHART_AXIS,
  CHART_COLORS,
  CHART_TOOLTIP_LABEL_STYLE,
  CHART_TOOLTIP_STYLE,
  CHART_GRID,
  SCORE_DOMAIN,
  SERIES_DASH,
  type ChartSeriesKey,
} from "@/components/charts/chart-theme";
import { ChartDataTable } from "@/components/charts/chart-data-table";
import { GapPatternDefs, gapPatternFill } from "@/components/charts/gap-pattern";
import { findGapBands } from "@/components/charts/gaps";

/**
 * Grafico de evolucao com eixo duplo (figura 4).
 *
 * Existe separado do `ScoreLineChart` porque acrescenta duas coisas que a
 * jornada basica nao precisa: um segundo eixo em horas (sono) e marcadores de
 * evento para as sessoes multimodais. Sobrecarregar o wrapper compartilhado
 * faria toda tela pagar por um recurso que so esta usa.
 *
 * `connectNulls` continua FALSE: lacuna e ausencia de registro, nao valor
 * interpolado.
 */

export interface EvolutionPoint {
  label: string;
  mood?: number | null;
  anxiety?: number | null;
  energy?: number | null;
  /** Sono em horas - vai para o eixo da direita. */
  sleep?: number | null;
}

export interface EvolutionSeries {
  key: ChartSeriesKey;
  label: string;
}

/** Escala do eixo da direita: horas de sono. */
export const HOURS_DOMAIN: [number, number] = [0, 12];

export function EvolutionChart({
  data,
  series,
  cycleBands = [],
  sessionLabels = [],
  height = 320,
  tableCaption,
  tableNote,
}: {
  data: EvolutionPoint[];
  series: EvolutionSeries[];
  cycleBands?: Array<{ from: string; to: string }>;
  /** Rotulos do eixo X em que houve sessao multimodal. */
  sessionLabels?: string[];
  height?: number;
  /** Legenda (leitor de tela) da tabela alternativa. */
  tableCaption?: string;
  /** Nota curta ao lado de "Ver os números". */
  tableNote?: string;
}) {
  const hasSleep = series.some((s) => s.key === "sleep");
  const animate = useChartAnimation(
    data.length,
    data.some((point) =>
      series.some(({ key }) => {
        const value = (point as unknown as Record<string, unknown>)[key];
        return value !== null && value !== undefined;
      }),
    ),
  );

  // Hachura da lacuna com id unico: dois graficos na tela nao disputam o pattern.
  const gapPatternId = `elyra-gap-${useId().replace(/:/g, "")}`;
  return (
    <>
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <GapPatternDefs id={gapPatternId} />
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="label" {...CHART_AXIS} interval="preserveStartEnd" minTickGap={24} />

        <YAxis
          yAxisId="score"
          domain={SCORE_DOMAIN}
          ticks={[0, 2, 5, 7, 10]}
          {...CHART_AXIS}
        />
        {hasSleep ? (
          <YAxis
            yAxisId="hours"
            orientation="right"
            domain={HOURS_DOMAIN}
            ticks={[0, 4, 8, 12]}
            tickFormatter={(v: number) => `${v}h`}
            {...CHART_AXIS}
          />
        ) : null}

        {/*
          `VR-003`: intervalo sem registro ganha faixa neutra ao fundo. A
          lacuna continua lacuna - nada e interpolado - mas passa a ser uma
          lacuna **anunciada**, em vez de parecer renderizacao quebrada.
          Desenhada antes das faixas de ciclo para nao competir com um evento
          de dominio real.
        */}
        {findGapBands(data, series.map((s) => s.key)).map((band) => (
          <ReferenceArea
            key={`gap-${band.from}-${band.to}`}
            yAxisId="score"
            x1={band.from}
            x2={band.to}
            fill={gapPatternFill(gapPatternId)}
            fillOpacity={1}
          />
        ))}

        {cycleBands.map((band) => (
          <ReferenceArea
            key={`${band.from}-${band.to}`}
            yAxisId="score"
            x1={band.from}
            x2={band.to}
            fill={CHART_COLORS.cycleBand}
            fillOpacity={1}
            /* `discard` (padrao): uma faixa que caia fora do dominio nao e
               desenhada. Com `extendDomain` o Recharts esticava a area por todo
               o grafico e a marcacao de periodo deixava de significar algo. */
          />
        ))}

        {sessionLabels.map((label) => (
          <ReferenceDot
            key={`session-${label}`}
            yAxisId="score"
            x={label}
            y={0}
            r={4}
            fill={CHART_COLORS.mood}
            stroke="none"
            ifOverflow="extendDomain"
          />
        ))}

        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} />

        {series.map(({ key, label }) => (
          <Line
            key={key}
            yAxisId={key === "sleep" ? "hours" : "score"}
            type="monotone"
            dataKey={key}
            name={label}
            stroke={CHART_COLORS[key]}
            strokeWidth={2}
            strokeDasharray={SERIES_DASH[key]}
            dot={false}
            activeDot={{ r: 5 }}
            connectNulls={false}
            isAnimationActive={animate}
            animationDuration={700}
            animationEasing="ease-out"
          />
        ))}
      </ComposedChart>
    </ResponsiveContainer>
    <ChartDataTable
      rows={data}
      series={series.map(({ key, label }) => ({ key, label, unit: key === "sleep" ? ("hours" as const) : ("score" as const) }))}
      caption={tableCaption ?? "Valores do gráfico de evolução por dia"}
      note={tableNote}
    />
    </>
  );
}
