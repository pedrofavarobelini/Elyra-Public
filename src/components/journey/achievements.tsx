"use client";

import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import { consistenciaDaSemana, derivarConquistas } from "@/lib/achievements";
import { derivarDiasAcompanhados, type EventoJornada } from "@/lib/journey";
import { semanaDe } from "@/lib/week";
import { cn } from "@/lib/utils";


export function Achievements({
  eventos,
  className,
}: {
  eventos: readonly EventoJornada[];
  className?: string;
}) {
  const conquistas = useMemo(() => derivarConquistas(eventos), [eventos]);

  const diasNaSemana = useMemo(() => {
    const semana = semanaDe(new Date());
    const dias = derivarDiasAcompanhados(eventos);
    return [...dias.keys()].filter((dia) => dia >= semana.inicio && dia <= semana.fim)
      .length;
  }, [eventos]);

  // Sem registro nenhum, o bloco inteiro some: nao ha o que descrever.
  if (eventos.length === 0) return null;

  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <h2 id="conquistas" className="text-base font-semibold text-ink lg:text-lg">
        Seu acompanhamento
      </h2>
      <p className="mt-1 text-sm text-ink-muted">{consistenciaDaSemana(diasNaSemana)}</p>

      {conquistas.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {conquistas.map((conquista) => (
            <li
              key={conquista.id}
              className="rounded-control border border-line bg-surface-muted/60 p-3"
            >
              <p className="text-sm font-medium text-ink">{conquista.titulo}</p>
              <p className="mt-0.5 text-sm text-ink-muted">{conquista.detalhe}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}
