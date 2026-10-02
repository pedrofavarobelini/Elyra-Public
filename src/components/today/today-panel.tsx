"use client";

import Link from "next/link";
import type { Route } from "next";
import { useMemo } from "react";

import { QuickCheckin } from "@/components/today/quick-checkin";
import { Suggestions } from "@/components/today/suggestions";
import { Card } from "@/components/ui/card";
import { FATO_HOJE, derivarHoje, type FatoDeHoje } from "@/lib/today";
import { cn } from "@/lib/utils";
import { useMockStore } from "@/mocks/store";


export function TodayPanel({ className }: { className?: string }) {
  const {
    checkins,
    goals,
    goalProgress,
    journal,
    cycle,
    cycleRecords,
    sleep,
    factors,
    isPendingSync,
  } = useMockStore();

  const fatos = useMemo(() => {
    /*
      A fila e contada sobre as entidades que a pessoa ve nesta janela. Sem
      gateway (testes, area profissional) `isPendingSync` responde `false` para
      todas, e o item simplesmente nao aparece.
    */
    const pendentes = [
      ...checkins.map((c) => c.id),
      ...journal.map((j) => j.id),
      ...goals.map((g) => g.id),
    ].filter((id) => isPendingSync(id)).length;

    return derivarHoje({
      checkins,
      goals,
      goalProgress,
      journal,
      cycle,
      cycleRecords,
      pendentes,
    });
  }, [checkins, goals, goalProgress, journal, cycle, cycleRecords, isPendingSync]);

  if (fatos.length === 0) return null;

  const precisaCheckin =
    fatos.find((f) => f.tipo === FATO_HOJE.CHECKIN)?.tom === "convite";

  return (
    <section
      aria-labelledby="hoje-na-elyra"
      className={cn("mb-4 sm:mb-5", className)}
    >
      <Card className="p-4 sm:p-5">
        <h2 id="hoje-na-elyra" className="text-base font-semibold text-ink lg:text-lg">
          Hoje na Elyra
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          O que já está registrado hoje, e o que está aberto se você quiser.
        </p>

        <ul className="mt-3 flex flex-col gap-2.5">
          {fatos.map((fato) => (
            <li key={fato.id}>
              <ItemDeHoje fato={fato} />
              {fato.tipo === FATO_HOJE.CHECKIN && precisaCheckin ? (
                <QuickCheckin />
              ) : null}
            </li>
          ))}
        </ul>

        {/* Sugestoes (8.9): o mesmo motor, outra saida. */}
        <Suggestions
          estado={{
            checkins,
            goals,
            goalProgress,
            journal,
            cycle,
            cycleRecords,
            pendentes: 0,
            sleep,
            factors,
          }}
        />
      </Card>
    </section>
  );
}

/**
 * Um fato.
 *
 * O tom muda a cor **e** o texto — nunca so a cor. Quem nao distingue as duas
 * cores continua lendo a mesma informacao (WCAG 1.4.1).
 */
function ItemDeHoje({ fato }: { fato: FatoDeHoje }) {

  const marcador =
    fato.tom === "registro"
      ? "bg-positive"
      : fato.tom === "aviso"
        ? "bg-attention"
        : "bg-brand-500";

  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-control border border-line bg-surface-muted/60 p-3">
      <span
        aria-hidden="true"
        className={cn("mt-1.5 size-2 shrink-0 rounded-full", marcador)}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{fato.titulo}</p>
        {fato.detalhe ? (
          <p className="mt-0.5 text-sm text-ink-muted">{fato.detalhe}</p>
        ) : null}
      </div>
      {fato.acao ? (
        <Link
          href={fato.acao.href as Route}
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        >
          {fato.acao.label}
        </Link>
      ) : null}
    </div>
  );
}
