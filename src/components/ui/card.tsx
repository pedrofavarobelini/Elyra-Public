import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";


const cardVariants = cva("border", {
  variants: {
    variant: {
      default: "rounded-card border-line bg-surface shadow-card",
      muted: "rounded-card border-transparent bg-surface-muted",
      interactive:
        "motion-lift rounded-card border-line bg-surface shadow-card hover:border-brand-200 hover:shadow-raised",
      hero: "rounded-panel border-line bg-surface shadow-card",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Card({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return (
    <div
      data-elyra-card={variant ?? "default"}
      className={cn(cardVariants({ variant }), className)}
      {...props}
    />
  );
}

/*
 * `card-pad` le a densidade escolhida em Personalizacao (1rem/1.25rem no
 * padrao, iguais ao antigo `p-4 sm:p-5`). Utilitarios passados por quem usa o
 * card continuam vencendo, porque `card-pad` vive na camada `components`.
 */
export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("card-pad flex flex-col gap-1 pb-0 sm:pb-0", className)}
      {...props}
    />
  );
}

/**
 * Titulo do card. `h3` por padrao — o nivel certo em telas cujo `h1` e o
 * cabecalho da pagina e cujos cards ficam sob uma secao `h2`.
 *
 * `as` existe para as telas em que o card **e** a secao de primeiro nivel: ali
 * o `h3` padrao pula de `h1` direto para `h3` e quebra a ordem de titulos. A
 * aparencia nao muda com o nivel; so a semantica.
 */
export function CardTitle({
  as: Tag = "h3",
  className,
  ...props
}: React.ComponentProps<"h3"> & { as?: "h2" | "h3" | "h4" }) {
  return (
    <Tag
      className={cn("text-base font-semibold text-ink", className)}
      {...props}
    />
  );
}

export function CardDescription({
  className,
  ...props
}: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-ink-muted", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("card-pad", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-3 p-4 pt-0 sm:p-5 sm:pt-0", className)}
      {...props}
    />
  );
}

export { cardVariants };
