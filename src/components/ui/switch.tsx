"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import type * as React from "react";

import { cn } from "@/lib/utils";

/*
  O trilho visual tem 28x48, mas a area de toque e ampliada por um pseudo
  elemento para >= 44px de altura: toggles de permissao sao o controle mais
  sensivel da Elyra, e errar o alvo num deles e ligar ou desligar um recurso.
*/
export function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-pill border-2 border-transparent transition-colors duration-150",
        "after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']",
        "data-[state=checked]:bg-brand-600 data-[state=unchecked]:bg-line-input",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-6 rounded-pill bg-white shadow-[0_1px_3px_rgb(30_33_66/0.25)] transition-transform duration-[var(--duration-normal)] ease-[var(--ease-emphasis)]",
          "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}
