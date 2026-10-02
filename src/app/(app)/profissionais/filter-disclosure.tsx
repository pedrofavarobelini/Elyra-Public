"use client";

import { SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";


export function FilterDisclosure({ activeCount, children }: { activeCount: number; children: ReactNode }) {
  const [open, setOpen] = useState(activeCount > 0);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls="descoberta-mais-filtros"
        onClick={() => setOpen((value) => !value)}
        className="motion-press inline-flex min-h-11 items-center gap-2 self-start rounded-control text-sm font-medium text-brand-700 sm:col-span-2 lg:hidden"
      >
        <SlidersHorizontal className="size-4" aria-hidden="true" />
        {open ? "Menos filtros" : activeCount > 0 ? `Mais filtros (${activeCount} ativos)` : "Mais filtros"}
      </button>
      <div id="descoberta-mais-filtros" className={cn(open ? "contents" : "hidden lg:contents")}>
        {children}
      </div>
    </>
  );
}
