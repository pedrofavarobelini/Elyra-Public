"use client";

import { useMemo } from "react";

import { Card } from "@/components/ui/card";
import {
  derivarSemana,
  intervaloEmTexto,
  resumoEmTexto,
  type EstadoDaSemana,
} from "@/lib/week";
import { cn } from "@/lib/utils";


export function WeekSummary({
  estado,
  className,
}: {
  estado: EstadoDaSemana;
  className?: string;
}) {
  const resumo = useMemo(() => derivarSemana(estado), [estado]);
  const frases = useMemo(() => resumoEmTexto(resumo), [resumo]);

  const numeros = [
    { rotulo: "Check-ins", valor: resumo.contagem.checkins },
    { rotulo: "Noites de sono", valor: resumo.contagem.noitesDeSono },
    { rotulo: "Anotações", valor: resumo.contagem.anotacoes },
    ...(resumo.contagem.metasAtivas > 0
      ? [
          {
            rotulo: "Metas com progresso",
            valor: resumo.contagem.metasComProgresso,
            de: resumo.contagem.metasAtivas,
          },
        ]
      : []),
    ...(resumo.contagem.registrosDeCiclo > 0
      ? [{ rotulo: "Registros de ciclo", valor: resumo.contagem.registrosDeCiclo }]
      : []),
  ].filter((n) => n.valor > 0 || n.rotulo === "Check-ins");

  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="minha-semana" className="text-base font-semibold text-ink lg:text-lg">
          Minha semana
        </h2>
        <p className="text-sm text-ink-muted">{intervaloEmTexto(resumo)}</p>
      </div>

      {resumo.vazia ? (
        <p className="mt-3 text-sm text-ink-muted">
          Ainda não há registros nesta semana. O que você registrar aparece aqui.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {numeros.map((n) => (
              <div
                key={n.rotulo}
                className="rounded-control border border-line bg-surface-muted/60 p-3"
              >
                <dt className="text-xs font-medium text-ink-muted">{n.rotulo}</dt>
                <dd className="mt-0.5 text-lg font-semibold text-ink">
                  {n.valor}
                  {"de" in n && n.de !== undefined ? (
                    <span className="text-sm font-normal text-ink-muted"> de {n.de}</span>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>

          <h3 className="mt-4 text-sm font-semibold text-ink">Minha semana em resumo</h3>
          <ul className="mt-1.5 flex flex-col gap-1">
            {frases.map((frase) => (
              <li key={frase} className="text-sm text-ink-muted">
                {frase}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
