import {
  CHART_COLORS,
  CHART_GAP_BAND,
  CHART_GAP_STROKE,
  SERIES_DASH,
  type ChartSeriesKey,
} from "@/components/charts/chart-theme";
import { cn } from "@/lib/utils";


export function ChartLegend({
  items,
  showGap = false,
  className,
}: {
  items: Array<{ key: ChartSeriesKey; label: string }>;
  showGap?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-5 gap-y-2", className)}>
      {items.map(({ key, label }) => (
        <li key={key} className="flex items-center gap-2 text-xs text-ink-muted">
          <span
            aria-hidden="true"
            className="inline-block h-0 w-5 border-t-2"
            style={{
              borderColor: CHART_COLORS[key],
              borderTopStyle: SERIES_DASH[key] === "2 3" ? "dotted" : SERIES_DASH[key] ? "dashed" : "solid",
            }}
          />
          {label}
        </li>
      ))}

      {showGap ? (
        <li className="flex items-center gap-2 text-xs text-ink-muted">
          <span
            aria-hidden="true"
            className="inline-block h-3 w-5 rounded-[2px] border border-line"
            style={{
              backgroundColor: CHART_GAP_BAND,
              backgroundImage: `repeating-linear-gradient(45deg, ${CHART_GAP_STROKE} 0 2px, transparent 2px 5px)`,
            }}
          />
          Sem registro no período
        </li>
      ) : null}
    </ul>
  );
}
