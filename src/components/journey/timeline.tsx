"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EVENTO, type EventoJornada, type TipoEvento } from "@/lib/journey";
import { cn } from "@/lib/utils";



const ROTULO_TIPO: Record<TipoEvento, string> = {
  [EVENTO.CHECKIN]: "Meu Humor",
  [EVENTO.SONO]: "Sono",
  [EVENTO.DIARIO]: "Diário",
  [EVENTO.META]: "Metas",
  [EVENTO.CICLO]: "Ciclo",
};

/** Ponto do tipo — reforco visual; o tipo tambem esta escrito ao lado. */
const COR_TIPO: Record<TipoEvento, string> = {
  [EVENTO.CHECKIN]: "bg-brand-500",
  [EVENTO.SONO]: "bg-identity-400",
  [EVENTO.DIARIO]: "bg-positive",
  [EVENTO.META]: "bg-attention",
  [EVENTO.CICLO]: "bg-brand-300",
};

const DIAS_POR_PAGINA = 7;

export function Timeline({
  eventos,
  className,
}: {
  eventos: readonly EventoJornada[];
  className?: string;
}) {
  const [paginas, setPaginas] = useState(1);

  const porDia = agruparPorDia(eventos);
  const visiveis = porDia.slice(0, paginas * DIAS_POR_PAGINA);
  const restantes = porDia.length - visiveis.length;

  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <h2 id="linha-do-tempo" className="text-base font-semibold text-ink lg:text-lg">
        Linha do tempo
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        Seus registros em ordem, reunidos de todos os espaços da Elyra.
      </p>

      {porDia.length === 0 ? (
        <p className="mt-4 text-sm text-ink-muted">
          Quando você registrar algo, aparece aqui em ordem.
        </p>
      ) : (
        <>
          <ol className="mt-4 flex flex-col gap-5">
            {visiveis.map(([dia, doDia]) => (
              <li key={dia}>
                <h3 className="text-sm font-semibold capitalize text-ink">
                  {rotuloDoDia(dia)}
                </h3>
                <ul className="mt-2 flex flex-col gap-1.5 border-l border-line pl-3.5">
                  {doDia.map((evento) => (
                    <li key={evento.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span
                        aria-hidden="true"
                        className={cn("size-2 shrink-0 rounded-full", COR_TIPO[evento.tipo])}
                      />
                      <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                        {ROTULO_TIPO[evento.tipo]}
                      </span>
                      <Link
                        href={evento.href as Route}
                        className="min-w-0 flex-1 text-sm text-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
                      >
                        {evento.titulo}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>

          {restantes > 0 ? (
            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button variant="secondary" size="sm" onClick={() => setPaginas((p) => p + 1)}>
                Mostrar mais dias
              </Button>
              <span className="text-sm text-ink-muted">
                {restantes === 1
                  ? "mais 1 dia com registro"
                  : `mais ${restantes} dias com registro`}
              </span>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function agruparPorDia(
  eventos: readonly EventoJornada[],
): Array<[string, EventoJornada[]]> {
  const mapa = new Map<string, EventoJornada[]>();
  for (const evento of eventos) {
    const atual = mapa.get(evento.dia);
    if (atual) atual.push(evento);
    else mapa.set(evento.dia, [evento]);
  }
  // `derivarLinhaDoTempo` ja devolve em ordem decrescente; o Map preserva a insercao.
  return [...mapa.entries()];
}

function rotuloDoDia(dia: string): string {
  const data = new Date(`${dia}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  }).format(data);
}
