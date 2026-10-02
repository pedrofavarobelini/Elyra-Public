"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId } from "react";
import type * as React from "react";

import {
  navGroupsFor,
  type NavContext,
  type NavEntry,
} from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";

/**
 * Lista de destinos da navegacao principal.
 *
 * Uma unica implementacao para a sidebar persistente (desktop) e para o drawer
 * (tablet/mobile), para que as duas nunca divirjam em rotulo, ordem, icone ou
 * marcacao de rota ativa. O `nav` com nome acessivel fica com quem a monta.
 *
 * Contexto profissional (ADR-0020): grupos com cabecalho. Cada grupo e uma
 * lista rotulada pelo proprio cabecalho (`aria-labelledby`), entao leitor de
 * tela anuncia "Trabalho, lista, 2 itens". Na navegacao compacta o cabecalho
 * sai da tela (continua na arvore) e vira um separador fino.
 */
export function NavList({
  context = "user",
  onNavigate,
  stagger = false,
}: {
  context?: NavContext;
  /** Chamado no clique de qualquer destino (o drawer fecha por aqui). */
  onNavigate?: () => void;
  /** Entrada escalonada — so faz sentido quando a lista aparece de uma vez. */
  stagger?: boolean;
}) {
  const pathname = usePathname();
  const groups = navGroupsFor(context);
  const baseId = useId();
  let index = 0;

  if (groups.length === 1 && !groups[0]?.label) {
    return (
      <ul className={cn("flex flex-col gap-1", stagger && "motion-stagger")}>
        {groups[0]!.entries.map((entry) => (
          <NavItem
            key={entry.href}
            entry={entry}
            pathname={pathname}
            onNavigate={onNavigate}
            staggerIndex={stagger ? index++ : undefined}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", stagger && "motion-stagger")}>
      {groups.map((group, groupIndex) => {
        const headingId = `${baseId}-group-${groupIndex}`;
        return (
          <div
            key={group.label ?? `global-${groupIndex}`}
            className={cn(!group.label && "nav-group-global border-t border-line pt-3")}
          >
            {group.label ? (
              <p
                id={headingId}
                className="nav-group-label px-3 pb-1 text-xs font-medium text-ink-subtle"
              >
                {group.label}
              </p>
            ) : null}
            <ul
              className="flex flex-col gap-1"
              aria-labelledby={group.label ? headingId : undefined}
            >
              {group.entries.map((entry) => (
                <NavItem
                  key={entry.href}
                  entry={entry}
                  pathname={pathname}
                  onNavigate={onNavigate}
                  staggerIndex={stagger ? index++ : undefined}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function NavItem({
  entry: { href, label, icon: Icon, match },
  pathname,
  onNavigate,
  staggerIndex,
}: {
  entry: NavEntry;
  pathname: string;
  onNavigate?: () => void;
  staggerIndex?: number;
}) {
  const active = [href, ...(match ?? [])].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  return (
    <li
      style={
        staggerIndex !== undefined
          ? ({ "--stagger-index": staggerIndex } as React.CSSProperties)
          : undefined
      }
    >
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        title={label}
        className={cn(
          "nav-link motion-press group relative flex min-h-11 items-center gap-3 rounded-control px-3 text-sm font-medium transition-colors duration-[var(--duration-normal)]",
          active
            ? "bg-gradient-to-r from-brand-100 to-brand-50 text-brand-700 shadow-[inset_0_0_0_1px_var(--color-brand-200)]"
            : "text-ink-muted hover:bg-surface-muted hover:text-ink",
        )}
      >
        {active ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-2.5 left-0 w-1 rounded-r-pill bg-brand-600"
          />
        ) : null}
        <Icon
          className={cn(
            "size-5 shrink-0",
            active ? "text-brand-600" : "text-ink-subtle group-hover:text-ink-muted",
          )}
          aria-hidden="true"
        />
        <span className="nav-label">{label}</span>
      </Link>
    </li>
  );
}
