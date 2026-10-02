import type { ChartSeriesKey } from "@/components/charts/chart-theme";



export interface GapBand {
  /** Rotulo do eixo X onde a faixa comeca. */
  from: string;
  /** Rotulo do eixo X onde a faixa termina. */
  to: string;
}

type MaybePoint = { label: string } & Partial<
  Record<ChartSeriesKey, number | null | undefined>
>;

/** O ponto nao tem registro em nenhuma das series exibidas? */
function vazio(point: MaybePoint, keys: readonly ChartSeriesKey[]): boolean {
  return keys.every((key) => {
    const value = point[key];
    return value === null || value === undefined;
  });
}

export function findGapBands(
  data: readonly MaybePoint[],
  seriesKeys: readonly ChartSeriesKey[],
): GapBand[] {
  if (data.length === 0 || seriesKeys.length === 0) return [];

  const bands: GapBand[] = [];
  let inicio: string | null = null;

  for (const point of data) {
    if (vazio(point, seriesKeys)) {
      inicio ??= point.label;
      continue;
    }
    if (inicio !== null) {
      bands.push({ from: inicio, to: point.label });
      inicio = null;
    }
  }

  /*
   * Lacuna que vai ate o fim da janela.
   *
   * Fecha no ultimo rotulo, e nao no primeiro ponto com dado seguinte - que
   * nao existe. Sem este ramo, a ausencia mais recente - justamente a que a
   * pessoa mais provavelmente quer entender - seria a unica sem marcacao.
   */
  const ultimo = data[data.length - 1];
  if (inicio !== null && ultimo) {
    bands.push({ from: inicio, to: ultimo.label });
  }

  return bands;
}

/**
 * Ha pelo menos um ponto sem registro em alguma serie exibida?
 *
 * Decide se a legenda menciona lacunas. Explicar sombreado que nao existe
 * na tela e ruido; omitir a explicacao quando ele existe e o defeito original.
 */
export function hasAnyGap(
  data: readonly MaybePoint[],
  seriesKeys: readonly ChartSeriesKey[],
): boolean {
  return data.some((point) =>
    seriesKeys.some((key) => {
      const value = point[key];
      return value === null || value === undefined;
    }),
  );
}
