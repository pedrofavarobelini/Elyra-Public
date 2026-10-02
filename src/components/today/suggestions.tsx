"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo } from "react";

import { SUGESTAO, sugerir, type EstadoDasSugestoes } from "@/lib/suggestions";
import { cn } from "@/lib/utils";


export function Suggestions({
  estado,
  className,
}: {
  estado: EstadoDasSugestoes;
  className?: string;
}) {
  const sugestoes = useMemo(
    () => sugerir(estado).filter((s) => s.id !== SUGESTAO.CHECKIN_HOJE),
    [estado],
  );

  // Sem fato que sustente, a secao inteira some. Sugestao generica ensina a ignorar.
  if (sugestoes.length === 0) return null;

  return (
    <div className={cn("mt-4 border-t border-line pt-3", className)}>
      <h3 className="text-sm font-semibold text-ink">Se fizer sentido agora</h3>
      <ul className="mt-2 flex flex-col gap-2">
        {sugestoes.map((sugestao) => (
          <li
            key={sugestao.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
          >
            <span className="min-w-0 flex-1 text-ink-muted">{sugestao.texto}</span>
            <Link
              href={sugestao.acao.href as Route}
              className="inline-flex min-h-11 items-center font-medium text-brand-700 underline underline-offset-4"
            >
              {sugestao.acao.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
