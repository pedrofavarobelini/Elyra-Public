import type { ChartSeriesKey } from "@/components/charts/chart-theme";



/** Ponto de serie: rotulo no eixo X e valores anulaveis por serie. */
export type AggregatablePoint = { label: string } & Partial<
  Record<ChartSeriesKey, number | null>
>;

/**
 * A partir de quantos pontos a leitura diaria deixa de compensar.
 *
 * Cinco semanas: abaixo disso o dia ainda e legivel e agregar esconderia
 * variacao que o profissional consegue ler; acima, o dia vira ruido.
 */
export const DAILY_READABLE_LIMIT = 35;

export type AggregatedPoint = AggregatablePoint & {
  /** Quantos pontos de origem sustentam este bucket. */
  sourceCount: number;
};

/**
 * Agrupa pontos em blocos de `size` e devolve a media por serie.
 *
 * A ordem de entrada e preservada: quem chama ja ordenou por data, e reordenar
 * aqui esconderia um bug de ordenacao la.
 */
export function aggregateByBucket<T extends AggregatablePoint>(
  points: readonly T[],
  seriesKeys: readonly ChartSeriesKey[],
  size: number,
): AggregatedPoint[] {
  if (size <= 1 || points.length === 0) {
    return points.map((p) => ({ ...p, sourceCount: 1 }));
  }

  const out: AggregatedPoint[] = [];

  for (let i = 0; i < points.length; i += size) {
    const bucket = points.slice(i, i + size);
    const primeiro = bucket[0];
    const ultimo = bucket[bucket.length - 1];
    if (!primeiro || !ultimo) continue;

    const agregado: AggregatedPoint = {
      // O rotulo nomeia o intervalo, e nao um dia que o bucket nao representa.
      label:
        bucket.length === 1
          ? primeiro.label
          : `${primeiro.label} – ${ultimo.label}`,
      sourceCount: bucket.length,
    };

    for (const key of seriesKeys) {
      const valores = bucket
        .map((p) => p[key])
        .filter((v): v is number => typeof v === "number");

      // Bucket sem nenhum registro na serie permanece ausente.
      agregado[key] =
        valores.length === 0
          ? null
          : valores.reduce((a, b) => a + b, 0) / valores.length;
    }

    out.push(agregado);
  }

  return out;
}

/**
 * Agrega apenas quando a janela e longa demais para leitura diaria.
 *
 * Devolve tambem `aggregated`, para que a tela possa **dizer** que esta
 * mostrando media semanal. Um grafico que agrega em silencio mente sobre a
 * granularidade do proprio eixo.
 */
export function aggregateForReadability<T extends AggregatablePoint>(
  points: readonly T[],
  seriesKeys: readonly ChartSeriesKey[],
  bucketSize = 7,
): { points: AggregatedPoint[]; aggregated: boolean } {
  if (points.length <= DAILY_READABLE_LIMIT) {
    return {
      points: points.map((p) => ({ ...p, sourceCount: 1 })),
      aggregated: false,
    };
  }
  return {
    points: aggregateByBucket(points, seriesKeys, bucketSize),
    aggregated: true,
  };
}
