"use client";

import { ChevronRight } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { cn } from "@/lib/utils";

/** Blocos do hub de Configuracoes, compartilhados pelos dois contextos (F4). */
export function HubGroup({
  title,
  id,
  description,
  className,
  children,
}: {
  title: string;
  id: string;
  description?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} id={id} className={cn("scroll-mt-20", className)}>
      <Card>
        <CardHeader className="pb-2">
          <h2 id={`${id}-title`} className="text-base font-semibold text-ink lg:text-lg">
            {title}
          </h2>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="flex flex-col divide-y divide-line px-0 pb-1 sm:px-0">
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

export function HubLink({
  href,
  icon,
  title,
  status,
  tone = "default",
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  status: string;
  tone?: "default" | "destructive";
}) {
  return (
    <Link
      href={href as Route}
      className="motion-press group flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-muted/70"
    >
      <IconPill tone={tone === "destructive" ? "neutral" : "brand"} size="sm">
        {icon}
      </IconPill>
      <span className="min-w-0 flex-1">
        <span
          className={
            tone === "destructive"
              ? "block text-sm font-medium text-destructive"
              : "block text-sm font-medium text-ink"
          }
        >
          {title}
        </span>
        <span className="block text-sm text-ink-muted">{status}</span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
