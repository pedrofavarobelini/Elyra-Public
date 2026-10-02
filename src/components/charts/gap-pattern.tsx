import { CHART_GAP_BAND, CHART_GAP_STROKE } from "@/components/charts/chart-theme";

/**
 * Hachura da lacuna "Sem registro" (F7). `id` unico por grafico: dois graficos
 * na mesma tela nao podem disputar o mesmo `<pattern>`.
 */
export function GapPatternDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="6" height="6" fill={CHART_GAP_BAND} />
        <line x1="0" y1="0" x2="0" y2="6" stroke={CHART_GAP_STROKE} strokeWidth="2" />
      </pattern>
    </defs>
  );
}

export function gapPatternFill(id: string) {
  return `url(#${id})`;
}
