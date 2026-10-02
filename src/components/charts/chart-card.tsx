import { Info } from "lucide-react";
import type * as React from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Moldura padrao de grafico: titulo + ajuda + subtitulo + acao a direita.
 * Padrao das figuras 1, 3, 4 e 8.
 */
export function ChartCard({
  title,
  description,
  hint,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-ink">{title}</h3>
            {hint ? (
              <span title={hint} className="text-ink-subtle">
                <Info className="size-3.5" aria-hidden="true" />
                <span className="sr-only">{hint}</span>
              </span>
            ) : null}
          </div>
          {description ? (
            <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </Card>
  );
}
