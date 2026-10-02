import type * as React from "react";

import { cn } from "@/lib/utils";

/*
  16px no celular e deliberado: abaixo disso o Safari do iOS aproxima a pagina
  ao focar o campo, e a pessoa perde o contexto do formulario. A partir de `lg`
  o texto volta a 14px, proporcional a densidade do desktop.
*/
const FIELD = [
  "w-full rounded-control border border-line-input bg-surface text-base text-ink lg:text-sm",
  "placeholder:text-ink-subtle",
  "transition-[border-color,box-shadow] duration-150",
  "hover:border-ink-subtle",
  "focus-visible:border-brand-500 focus-visible:shadow-[0_0_0_3px_var(--color-brand-100)] focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-60",
  "aria-[invalid=true]:border-destructive",
];

export function Input({
  className,
  type = "text",
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(FIELD, "h-11 px-3.5", className)}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(FIELD, "min-h-24 p-3.5 leading-relaxed", className)}
      {...props}
    />
  );
}
