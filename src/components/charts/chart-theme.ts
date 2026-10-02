/**
 * Tema unico dos graficos Recharts — Elyra Data Visualization System (F7).
 *
 * Tudo vem de tokens CSS (`--color-chart-*`, em `globals.css`) com valores
 * para claro, escuro, sistema e contraste reforcado. Nenhum hex aqui: o tema
 * escuro deixava a faixa de lacuna quase branca dominar o grafico (L-312).
 * Rosa pertence ao dominio de ciclo e nao e reaproveitado para outra serie.
 */
export const CHART_COLORS = {
  mood: "var(--color-chart-mood)",
  anxiety: "var(--color-chart-anxiety)",
  sleep: "var(--color-chart-sleep)",
  energy: "var(--color-chart-energy)",
  cycle: "var(--color-chart-cycle)",
  cycleBand: "var(--color-chart-cycle-band)",
} as const;

/**
 * Lacuna "Sem registro" (`VR-003`): hachura de baixo contraste, nao bloco
 * solido. Ausencia de dado nao e evento de dominio — nao ganha cor de um, e
 * nao pode competir com a serie.
 */
export const CHART_GAP_BAND = "var(--color-chart-gap)";
export const CHART_GAP_STROKE = "var(--color-chart-gap-stroke)";

export type ChartSeriesKey = keyof typeof CHART_COLORS;

export const CHART_AXIS = {
  stroke: "var(--color-chart-axis)",
  tick: { fill: "var(--color-chart-axis)", fontSize: 12 },
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;

export const CHART_GRID = {
  stroke: "var(--color-chart-grid)",
  vertical: false,
} as const;

/** Tooltip unico: superficie, borda e texto pelos tokens do tema. */
export const CHART_TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid var(--color-chart-tooltip-border)",
  backgroundColor: "var(--color-chart-tooltip-bg)",
  color: "var(--color-chart-tooltip-ink)",
  boxShadow: "0 16px 40px rgb(30 33 66 / 0.14)",
  fontSize: 13,
} as const;

export const CHART_TOOLTIP_LABEL_STYLE = { color: "var(--color-chart-tooltip-ink)", fontWeight: 600 } as const;

/** Escala canonica de score exibida ao usuario. */
export const SCORE_DOMAIN: [number, number] = [0, 10];

/**
 * Codificacao secundaria (F7): cor nunca e o unico canal. Ansiedade tracejada
 * (figuras 1 e 8) e sono pontilhado — o validador de paleta mostrou que, entre
 * TODOS os pares, sono x ansiedade ficam proximos ate na visao normal (heranca
 * da paleta da baseline). Traco diferente resolve sem trocar a cor oficial.
 */
export const SERIES_DASH: Partial<Record<ChartSeriesKey, string>> = {
  anxiety: "6 4",
  sleep: "2 3",
};
