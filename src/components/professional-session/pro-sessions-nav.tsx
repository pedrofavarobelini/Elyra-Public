import type { Route } from "next";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Barra comum de Sessoes do profissional (ADR-0029 §6): Proximas · Agenda ·
 * Historico. Sao links entre paginas (com `aria-current`), nao abas: cada
 * destino tem URL propria e o menu profissional nao muda de estrutura.
 */
const LINKS: { key: "proximas" | "agenda" | "historico"; href: Route; label: string }[] = [
  { key: "proximas", href: "/pro/sessoes", label: "Próximas" },
  { key: "agenda", href: "/pro/agenda", label: "Agenda" },
  { key: "historico", href: "/pro/sessoes#historico" as Route, label: "Histórico" },
];

export function ProSessionsNav({ current }: { current: "proximas" | "agenda" }) {
  return (
    <nav aria-label="Sessões e agenda" className="mb-5 lg:mb-6" data-testid="pro-sessions-nav">
      <ul className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-control bg-surface-muted p-1">
        {LINKS.map((link) => {
          const active = link.key === current;
          return (
            <li key={link.key}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center whitespace-nowrap rounded-[0.625rem] px-3.5 text-sm font-medium transition-colors duration-150 lg:min-h-10",
                  active ? "bg-surface text-brand-700 shadow-card" : "text-ink-muted hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
