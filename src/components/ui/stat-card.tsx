import { ArrowDown, ArrowUp, Info } from "lucide-react";
import type * as React from "react";

import { IconPill, type iconPillVariants } from "@/components/ui/icon-pill";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

type Tone = NonNullable<VariantProps<typeof iconPillVariants>["tone"]>;

export type DeltaDirection = "up" | "down";

export interface StatCardProps {
  label: string;
  /** Valor ja formatado. `null` significa ausencia de registro - nunca zero. */
  value: string | null;
  /** Unidade exibida menor ao lado do valor, ex.: "/10". */
  unit?: string;
  icon: React.ReactNode;
  tone?: Tone;
  hint?: string;
  /** Linha curta de contexto abaixo do valor (ex.: "Como você está agora?"). */
  caption?: string;
  delta?: {
    direction: DeltaDirection;
    label: string;
    /** Se a direcao representa melhora. Sobe nem sempre e bom (ansiedade). */
    isPositive: boolean;
  };
  className?: string;
}

/**
 * Card de metrica. Padrao presente nas figuras 1, 3, 4 e 8.
 *
 * Regra de contrato: `value === null` renderiza o estado de ausencia, nunca "0".
 *
 * Design System V2: o numero e o protagonista (tabular, `ink`), o rotulo vem
 * acima e pequeno, e o icone fica em pilula tingida pelo dominio.
 */
export function StatCard({
  label,
  value,
  unit,
  icon,
  tone = "brand",
  hint,
  caption,
  delta,
  className,
}: StatCardProps) {
  const DeltaIcon = delta?.direction === "up" ? ArrowUp : ArrowDown;

  return (
    <Card
      role="group"
      aria-label={label}
      className={cn("flex flex-col items-start gap-2.5 p-3.5 sm:flex-row sm:gap-4 sm:p-4", className)}
    >
      <IconPill tone={tone}>{icon}</IconPill>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-ink-muted">{label}</span>
          {hint ? (
            <span title={hint} className="text-ink-subtle">
              <Info className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{hint}</span>
            </span>
          ) : null}
        </div>

        {value === null ? (
          <p className="mt-1 text-sm font-medium text-ink-subtle">Sem registro</p>
        ) : (
          <p className="mt-0.5 flex items-baseline gap-1">
            <span className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
              {value}
            </span>
            {unit ? (
              <span className="text-sm text-ink-muted">{unit}</span>
            ) : null}
          </p>
        )}

        {caption ? (
          <p className="mt-0.5 text-xs text-ink-subtle">{caption}</p>
        ) : null}

        {delta ? (
          <p
            className={cn(
              "mt-1 flex items-center gap-1 text-xs",
              delta.isPositive ? "text-positive" : "text-ink-muted",
            )}
          >
            <DeltaIcon className="size-3" aria-hidden="true" />
            {delta.label}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
