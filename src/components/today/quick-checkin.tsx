"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  PRIMARY_FEELINGS,
  PRIMARY_FEELING_LABEL,
  type PrimaryFeeling,
} from "@/lib/contracts/emotional";
import { cn } from "@/lib/utils";
import { useMockStore } from "@/mocks/store";


export function QuickCheckin({ className }: { className?: string }) {
  const { addCheckin } = useMockStore();
  const [salvando, setSalvando] = useState<PrimaryFeeling | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function registrar(feeling: PrimaryFeeling) {
    if (salvando) return;
    setSalvando(feeling);
    setErro(null);
    try {
      await addCheckin({
        mood: null,
        perceivedAnxiety: null,
        energy: null,
        primaryFeeling: feeling,
        factorIds: [],
        note: null,
      });
      /*
        Sem mensagem de sucesso propria: quem confirma e a propria tela, que se
        recalcula e passa a dizer "Voce registrou como esta hoje". Um "salvo!"
        aqui competiria com esse sinal e desapareceria em seguida.
      */
    } catch {
      // Copy sem jargao: a pessoa nao precisa saber se foi rede, fila ou servidor.
      setErro("Não foi possível registrar agora. Tente de novo em instantes.");
    } finally {
      setSalvando(null);
    }
  }

  return (
    <div className={cn("mt-3", className)}>
      <p id="checkin-rapido-rotulo" className="text-sm font-medium text-ink">
        Como você está agora?
      </p>
      <div className="mt-2 flex flex-wrap gap-2" role="group" aria-labelledby="checkin-rapido-rotulo">
        {PRIMARY_FEELINGS.map((feeling) => (
          <button
            key={feeling}
            type="button"
            onClick={() => void registrar(feeling)}
            disabled={salvando !== null}
            /* min-h-11 = 44px: alvo de toque do baseline de acessibilidade. */
            className="motion-lift inline-flex min-h-11 items-center rounded-control border border-line bg-surface px-3.5 text-sm font-medium text-ink shadow-card hover:border-brand-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-60"
          >
            {salvando === feeling ? "Registrando…" : PRIMARY_FEELING_LABEL[feeling]}
          </button>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button asChild variant="ghost" size="sm">
          <Link href="/meu-humor">Adicionar detalhes</Link>
        </Button>
        <span className="text-xs text-ink-muted">
          Você pode completar o registro quando quiser.
        </span>
      </div>
      {erro ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
