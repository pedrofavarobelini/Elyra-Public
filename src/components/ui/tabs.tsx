"use client";

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type * as React from "react";

import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;

type TabsVariant = "underline" | "segmented";

/**
 * Abas do Design System V2.
 *
 * `underline` para navegacao de conteudo (padrao da figura 8); `segmented` para
 * alternar recortes de uma mesma lista (status de metas, anotacoes/lixeira).
 * Em ambos, a lista rola **dentro** do proprio container quando nao cabe — a
 * pagina nunca rola na horizontal.
 */
export function TabsList({
  className,
  variant = "underline",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return (
    <TabsPrimitive.List
      data-variant={variant}
      className={cn(
        "group/tabs flex max-w-full items-center overflow-x-auto",
        variant === "underline"
          ? "gap-5 border-b border-line"
          : "w-fit gap-1 rounded-control bg-surface-muted p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex min-h-11 items-center gap-2 whitespace-nowrap text-sm font-medium text-ink-muted transition-colors duration-150 hover:text-ink",
        "group-data-[variant=underline]/tabs:-mb-px group-data-[variant=underline]/tabs:border-b-2 group-data-[variant=underline]/tabs:border-transparent group-data-[variant=underline]/tabs:px-1",
        "group-data-[variant=underline]/tabs:data-[state=active]:border-brand-600 group-data-[variant=underline]/tabs:data-[state=active]:text-brand-content",
        "group-data-[variant=segmented]/tabs:lg:min-h-10 group-data-[variant=segmented]/tabs:rounded-[0.625rem] group-data-[variant=segmented]/tabs:px-3.5",
        "group-data-[variant=segmented]/tabs:data-[state=active]:bg-surface group-data-[variant=segmented]/tabs:data-[state=active]:text-brand-content group-data-[variant=segmented]/tabs:data-[state=active]:shadow-card",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("pt-5", className)} {...props} />;
}
