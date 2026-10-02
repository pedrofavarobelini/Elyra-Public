import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";


const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium",
    "transition-[background-color,color,border-color,box-shadow,transform] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary:
          "bg-brand-600 text-white shadow-[0_1px_2px_rgb(30_33_66/0.08)] hover:bg-brand-700",
        secondary:
          "border border-line-strong bg-surface text-ink hover:border-brand-300 hover:bg-surface-brand",
        soft: "bg-brand-100 text-brand-700 hover:bg-brand-200/70",
        ghost: "text-ink-muted hover:bg-surface-muted hover:text-ink",
        // `text-surface`, nao `text-white`: no tema escuro o token destrutivo e
        // claro (#ff9aae) e branco sobre ele fica em 2:1 (axe, PRO-7R).
        destructive: "bg-destructive text-surface hover:brightness-95",
        link: "text-brand-700 underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-11 rounded-control px-3.5 text-sm lg:h-9",
        md: "h-11 rounded-control px-4 text-sm",
        lg: "h-12 rounded-control px-6 text-base",
        icon: "size-11 rounded-control lg:size-10",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}

export { buttonVariants };
