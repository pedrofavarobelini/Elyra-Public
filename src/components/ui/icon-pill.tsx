import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Pilula circular tingida que envolve um icone linear.
 * Padrao recorrente em todas as 8 referencias visuais.
 */
const iconPillVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-pill [&_svg]:size-5",
  {
    variants: {
      tone: {
        brand: "bg-brand-100 text-brand-600",
        identity: "bg-identity-50 text-identity-600",
        sleep: "bg-metric-sleep-soft text-metric-sleep",
        energy: "bg-metric-energy-soft text-metric-energy",
        anxiety: "bg-metric-anxiety-soft text-metric-anxiety",
        cycle: "bg-cycle-soft text-cycle",
        positive: "bg-positive-soft text-positive",
        attention: "bg-attention-soft text-attention",
        neutral: "bg-surface-muted text-ink-muted",
      },
      size: {
        sm: "size-8 [&_svg]:size-4",
        md: "size-10",
        lg: "size-12 [&_svg]:size-6",
      },
    },
    defaultVariants: { tone: "brand", size: "md" },
  },
);

export function IconPill({
  className,
  tone,
  size,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof iconPillVariants>) {
  return (
    <span
      aria-hidden="true"
      className={cn(iconPillVariants({ tone, size }), className)}
      {...props}
    />
  );
}

export { iconPillVariants };
