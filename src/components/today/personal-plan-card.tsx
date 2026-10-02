"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";

import { RoutinePlayer } from "@/components/routines/routine-player";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PRIMARY_GOAL_LABEL } from "@/lib/contracts/identity";
import { planoPara } from "@/lib/personal-plan";
import { rotinaPorId } from "@/lib/routines";
import { cn } from "@/lib/utils";
import { useMockStore } from "@/mocks/store";


export function PersonalPlanCard({ className }: { className?: string }) {
  const { preferences } = useMockStore();
  const [rotinaAberta, setRotinaAberta] = useState(false);

  const objetivo = preferences.primaryGoal ?? null;
  const plano = planoPara(objetivo);
  const rotina = plano.rotina ? rotinaPorId(plano.rotina) : null;

  return (
    <section aria-labelledby="meu-plano" className={cn("mb-4 sm:mb-5", className)}>
      <Card className="p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="meu-plano" className="text-base font-semibold text-ink lg:text-lg">
            Meu caminho na Elyra
          </h2>
          {objetivo ? (
            <p className="text-sm text-ink-muted">{PRIMARY_GOAL_LABEL[objetivo]}</p>
          ) : null}
        </div>
        <p className="mt-1 text-sm text-ink-muted">{plano.chamada}</p>

        <ul className="mt-3 grid gap-2 sm:grid-cols-3">
          {plano.passos.map((passo) => (
            <li key={`${passo.href}-${passo.label}`}>
              <Link
                href={passo.href as Route}
                className="motion-lift flex h-full min-h-16 flex-col rounded-control border border-line bg-surface p-3 shadow-card hover:border-brand-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                <span className="text-sm font-medium text-ink">{passo.label}</span>
                <span className="mt-0.5 text-xs text-ink-muted">{passo.descricao}</span>
              </Link>
            </li>
          ))}
        </ul>

        {rotina ? (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
            <Button variant="secondary" size="sm" onClick={() => setRotinaAberta(true)}>
              Fazer agora: {rotina.nome}
            </Button>
            <span className="text-xs text-ink-muted">{rotina.descricao}</span>
          </div>
        ) : null}

        {objetivo === null ? (
          <p className="mt-3 text-xs text-ink-muted">
            Se quiser, você pode escolher um objetivo em{" "}
            <Link
              href={"/configuracoes" as Route}
              /*
                Sublinhado **sempre**, e nao so no hover: link dentro de
                paragrafo que se distingue apenas pela cor reprova no
                `link-in-text-block` do axe — e, mais importante, some para quem
                nao percebe a diferenca de cor.
              */
              className="text-brand-700 underline underline-offset-4"
            >
              Configurações
            </Link>
            .
          </p>
        ) : null}
      </Card>

      {rotina ? (
        <RoutinePlayer
          // Remonta limpo a cada abertura: sem efeito de reset no player.
          key={`${rotina.id}-${String(rotinaAberta)}`}
          rotina={rotina}
          aberto={rotinaAberta}
          aoFechar={() => setRotinaAberta(false)}
        />
      ) : null}
    </section>
  );
}
