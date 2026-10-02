"use client";

import { useId } from "react";

import { useChartAnimation } from "@/lib/use-reduced-motion";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
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

export interface ScoreSeries {
  key: ChartSeriesKey;
  label: string;
}

export interface CycleBand {
  from: string;
  to: string;
}

/** Ponto da serie: `label` no eixo X e um score anulavel por serie. */
export type ScorePoint = { label: string } & Partial<
  Record<ChartSeriesKey, number | null>
>;

export interface ScoreLineChartProps {
  data: ScorePoint[];
  series: ScoreSeries[];
  /** Faixas de periodo menstrual desenhadas ao fundo (figuras 3 e 4). */
  cycleBands?: CycleBand[];
  height?: number;
  /** Legenda (leitor de tela) da tabela alternativa. */
  tableCaption?: string;
}

/**
 * Wrapper Recharts para series de score 0-10.
 *
 * `connectNulls` fica FALSE de proposito: uma lacuna e ausencia de registro,
 * nao um valor interpolado. NULL nao e zero.
 */
export function ScoreLineChart({
  data,
  series,
  cycleBands = [],
  height = 280,
  tableCaption,
}: ScoreLineChartProps) {
  const animate = useChartAnimation(
    data.length,
    data.some((point) => series.some(({ key }) => point[key] !== null && point[key] !== undefined)),
  );
  // Hachura da lacuna com id unico: dois graficos na tela nao disputam o pattern.
  const gapPatternId = `elyra-gap-${useId().replace(/:/g, "")}`;
  return (
    <>
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <GapPatternDefs id={gapPatternId} />
        <CartesianGrid {...CHART_GRID} />
        <XAxis dataKey="label" {...CHART_AXIS} />
        <YAxis domain={SCORE_DOMAIN} ticks={[0, 2, 5, 7, 10]} {...CHART_AXIS} />

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
            x1={band.from}
            x2={band.to}
            fill={gapPatternFill(gapPatternId)}
            fillOpacity={1}
          />
        ))}

        {cycleBands.map((band) => (
          <ReferenceArea
            key={`${band.from}-${band.to}`}
            x1={band.from}
            x2={band.to}
            fill={CHART_COLORS.cycleBand}
            fillOpacity={1}
            /* `discard` (padrao): uma faixa que caia fora do dominio nao e
               desenhada. Com `extendDomain` o Recharts esticava a area por todo
               o grafico e a marcacao de periodo deixava de significar algo. */
          />
        ))}

        <Tooltip contentStyle={CHART_TOOLTIP_STYLE} labelStyle={CHART_TOOLTIP_LABEL_STYLE} />

        {series.map(({ key, label }) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            name={label}
            stroke={CHART_COLORS[key]}
            strokeWidth={2}
            strokeDasharray={SERIES_DASH[key]}
            dot={{ r: 3, strokeWidth: 0, fill: CHART_COLORS[key] }}
            activeDot={{ r: 5 }}
            connectNulls={false}
            /* Desenho da linha so com dado real e fora de automacao: o
               screenshot canonico continua deterministico (ver
               useChartAnimation). */
            isAnimationActive={animate}
            animationDuration={700}
            animationEasing="ease-out"
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
    <ChartDataTable
      rows={data}
      series={series.map(({ key, label }) => ({ key, label }))}
      caption={tableCaption ?? "Valores do gráfico por dia"}
    />
    </>
  );
}
