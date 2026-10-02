import { Disclosure } from "@/components/ui/disclosure";
import type { ChartSeriesKey } from "@/components/charts/chart-theme";
import { formatScore } from "@/lib/utils";

export interface ChartTableSeries {
  key: ChartSeriesKey;
  label: string;
  /** `hours` = sono no eixo de horas; o resto e score 0-10. */
  unit?: "score" | "hours";
}

type Row = { label: string } & Partial<Record<ChartSeriesKey, number | null>>;

function formatValue(value: number | null | undefined, unit: ChartTableSeries["unit"]) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (unit === "hours") {
    const minutes = Math.round(value * 60);
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
  }
  return `${formatScore(value)}/10`;
}

/**
 * Resumo textual por serie: dias com registro e media. So contagem e media do
 * que foi registrado — nunca interpretacao, nunca "melhorou/piorou".
 */
export function chartSummary(rows: Row[], series: ChartTableSeries[]) {
  return series.map(({ key, label, unit }) => {
    const values = rows.map((row) => row[key]).filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
    if (values.length === 0) return `${label}: nenhum registro no período.`;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    return `${label}: ${values.length} de ${rows.length} ${rows.length === 1 ? "dia" : "dias"} com registro; média ${formatValue(mean, unit)}.`;
  });
}

/**
 * Alternativa acessivel ao grafico (F7): resumo + tabela dos numeros. Lacuna
 * aparece como "Sem registro", nunca como 0 (NULL nao e zero).
 */
export function ChartDataTable({
  rows,
  series,
  caption,
  note,
}: {
  rows: Row[];
  series: ChartTableSeries[];
  caption: string;
  /** Nota curta ao lado do "Ver os números": uma linha a menos no card. */
  note?: string;
}) {
  if (rows.length === 0 || series.length === 0) return null;
  const summary = note ? (
    <>
      Ver os números <span className="ml-1 font-normal text-ink-subtle">· {note}</span>
    </>
  ) : (
    "Ver os números"
  );
  return (
    <Disclosure summary={summary} className="mt-1" tone="subtle">
      <div className="mt-2 flex flex-col gap-2" data-testid="chart-data-table">
        <ul className="flex flex-col gap-0.5 text-sm text-ink-muted">
          {chartSummary(rows, series).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div
          className="max-h-72 overflow-auto rounded-control border border-line"
          // Rolagem por teclado: a regiao precisa ser focavel (axe scrollable-region-focusable).
          tabIndex={0}
          role="region"
          aria-label={caption}
        >
          <table className="w-full min-w-[18rem] border-collapse text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="sticky top-0 bg-surface-muted text-left text-xs text-ink-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Dia
                </th>
                {series.map(({ key, label }) => (
                  <th key={key} scope="col" className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={`${row.label}-${index}`} className="border-t border-line">
                  <th scope="row" className="px-3 py-1.5 text-left font-normal text-ink-muted">
                    {row.label}
                  </th>
                  {series.map(({ key, unit }) => {
                    const value = formatValue(row[key], unit);
                    return (
                      <td key={key} className={value ? "px-3 py-1.5 tabular-nums text-ink" : "px-3 py-1.5 text-ink-subtle"}>
                        {value ?? "Sem registro"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Disclosure>
  );
}
