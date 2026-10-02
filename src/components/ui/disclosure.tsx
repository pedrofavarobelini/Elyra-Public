import { ChevronDown } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";


export function Disclosure({
  summary,
  children,
  className,
  defaultOpen = false,
  tone = "subtle",
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
  tone?: "subtle" | "boxed";
}) {
  return (
    <details
      open={defaultOpen || undefined}
      className={cn(
        "group/disclosure",
        tone === "boxed" && "rounded-control border border-line bg-surface-muted/50",
        className,
      )}
    >
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-brand-700 lg:min-h-9",
          "rounded-control transition-colors duration-[var(--duration-fast)] hover:text-brand-800 [&::-webkit-details-marker]:hidden",
          tone === "boxed" && "px-3",
        )}
      >
        <ChevronDown
          className="size-4 shrink-0 transition-transform duration-[var(--duration-normal)] ease-[var(--ease-standard)] group-open/disclosure:rotate-180"
          aria-hidden="true"
        />
        <span className="min-w-0">{summary}</span>
      </summary>
      <div
        className={cn(
          "group-open/disclosure:motion-rise-in text-sm text-ink-muted",
          tone === "boxed" ? "px-3 pb-3" : "pb-1 pt-1",
        )}
      >
        {children}
      </div>
    </details>
  );
}
