"use client";

import { BadgeCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";

import type { NavContext } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";

/**
 * Chegada numa area da conta (MOTION-2, MOTION-GAP-04).
 *
 * A troca Pessoal <-> Profissional e uma Server Action com redirect: nada no
 * seletor muda. Aqui o shell compara o contexto atual com o ultimo desta aba
 * (`sessionStorage`); so quando MUDOU mostra uma faixa curta dizendo onde a
 * pessoa esta. Primeira carga, reload e navegacao dentro da mesma area nao
 * mostram nada.
 *
 * O texto e a informacao (anunciado pelo contenedor `aria-live`, sem
 * `role="status"` proprio para nao competir com o status da tela); o
 * movimento e so `motion-rise-in`,
 * que o CSS global zera com movimento reduzido (sistema ou preferencia interna).
 * Nao move foco.
 */
const KEY = "elyra:last-context";
const VISIBLE_MS = 4_000;

const COPY: Record<NavContext, string> = {
  professional: "Você está na área profissional. A mesma conta, outro ambiente.",
  user: "Você voltou para a área pessoal.",
};

export function ContextArrival({ context }: { context: NavContext }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    void (async () => {
      let previous: string | null = null;
      try {
        previous = sessionStorage.getItem(KEY);
        sessionStorage.setItem(KEY, context);
      } catch {
        return; // sem storage (modo privado restrito): so nao anuncia.
      }
      await Promise.resolve();
      if (cancelled || !previous || previous === context) return;
      setShown(true);
      timer = setTimeout(() => setShown(false), VISIBLE_MS);
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [context]);

  const professional = context === "professional";
  const Icon = professional ? BadgeCheck : UserRound;
  return (
    <div aria-live="polite" className="mx-auto w-full max-w-[100rem] px-4 sm:px-6 lg:px-8 2xl:px-10">
      {shown ? (
        <p
          data-testid="context-arrival"
          data-context={context}
          className={cn(
            "motion-rise-in mt-3 flex items-center gap-2 rounded-control border px-3 py-2 text-sm",
            professional ? "border-identity-100 bg-identity-50 text-identity-700" : "border-line bg-surface text-ink",
          )}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {COPY[context]}
        </p>
      ) : null}
    </div>
  );
}
