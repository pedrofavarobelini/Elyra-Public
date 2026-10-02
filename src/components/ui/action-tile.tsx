import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import type * as React from "react";

import { IconPill, type iconPillVariants } from "@/components/ui/icon-pill";
import { cn } from "@/lib/utils";
import type { VariantProps } from "class-variance-authority";

type Tone = NonNullable<VariantProps<typeof iconPillVariants>["tone"]>;

/**
 * Atalho de acao (Design System V2).
 *
 * Um card inteiro e **um** link: alvo grande no celular, nome acessivel igual ao
 * rotulo visivel. A descricao curta diz o que acontece ao tocar, sem prometer
 * nada que a tela de destino nao faca.
 */
export function ActionTile({
  href,
  label,
  description,
  icon,
  tone = "brand",
  className,
}: {
  href: Route;
  label: string;
  description?: string;
  icon: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "motion-lift group flex min-h-16 flex-col items-start gap-2.5 rounded-card border border-line bg-surface p-3.5 shadow-card hover:border-brand-200 hover:shadow-raised sm:flex-row sm:items-center sm:gap-3 sm:p-4",
        className,
      )}
    >
      <IconPill tone={tone}>{icon}</IconPill>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 hidden text-xs leading-4 text-ink-muted sm:block">
            {description}
          </span>
        ) : null}
      </span>
      <ChevronRight
        className="hidden size-4 shrink-0 text-ink-subtle transition-transform duration-150 group-hover:translate-x-0.5 sm:block"
        aria-hidden="true"
      />
    </Link>
  );
}
