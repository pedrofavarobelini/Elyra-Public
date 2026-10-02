"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { duracaoEmTexto, duracaoTotal, posicaoEm, type Rotina } from "@/lib/routines";
import { cn } from "@/lib/utils";


export function RoutinePlayer({
  rotina,
  aberto,
  aoFechar,
}: {
  rotina: Rotina;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const reduzido = usePrefersReducedMotion();
  const [decorridos, setDecorridos] = useState(0);
  const [rodando, setRodando] = useState(false);

  const total = duracaoTotal(rotina);
  const posicao = posicaoEm(rotina, decorridos);
  const passo = rotina.passos[posicao.indice];

  /*
    Nao ha efeito para "zerar ao abrir": quem monta passa `key` com o id da
    rotina e o estado de abertura, e o React remonta com estado limpo. Resetar
    com `setState` dentro de efeito e o caminho que parece obvio e custa um
    render extra a cada abertura — alem de ser exatamente o que a regra
    `react-hooks/set-state-in-effect` existe para impedir.
  */

  useEffect(() => {
    if (!rodando || posicao.terminou) return;
    const id = setInterval(() => setDecorridos((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [rodando, posicao.terminou]);

  const progresso = total === 0 ? 0 : Math.min(100, (decorridos / total) * 100);

  return (
    <Dialog open={aberto} onOpenChange={(v) => (!v ? aoFechar() : undefined)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{rotina.nome}</DialogTitle>
          <DialogDescription>
            {rotina.descricao} · {duracaoEmTexto(rotina)}
          </DialogDescription>
        </DialogHeader>

        <div
          className="rounded-card border border-line bg-surface-muted/60 p-4"
          // A instrucao muda sozinha: quem usa leitor de tela precisa ser avisado.
          aria-live="polite"
        >
          {posicao.terminou ? (
            <p className="text-base text-ink">Rotina concluída.</p>
          ) : (
            <>
              <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
                Passo {posicao.indice + 1} de {rotina.passos.length}
              </p>
              <p className="mt-1.5 text-base leading-relaxed text-ink">{passo?.texto}</p>
              <p className="mt-2 text-sm tabular-nums text-ink-muted">
                {posicao.restante}s neste passo
              </p>
            </>
          )}
        </div>

        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={Math.min(decorridos, total)}
          aria-valuetext={`${Math.min(decorridos, total)} de ${total} segundos`}
          className="mt-3 h-1.5 w-full overflow-hidden rounded-pill bg-surface-muted"
        >
          <div
            className={cn(
              "h-full rounded-pill bg-brand-500",
              // Sem transicao quando o sistema pede menos movimento.
              reduzido ? undefined : "transition-[width] duration-1000 ease-linear",
            )}
            style={{ width: `${progresso}%` }}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {posicao.terminou ? (
            <>
              <Button onClick={() => setDecorridos(0)}>Repetir</Button>
              <Button variant="secondary" onClick={aoFechar}>
                Fechar
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => setRodando((r) => !r)}>
                {rodando ? "Pausar" : decorridos === 0 ? "Começar" : "Continuar"}
              </Button>
              <Button variant="ghost" onClick={aoFechar}>
                Sair
              </Button>
            </>
          )}
        </div>

        <p className="mt-3 text-xs text-ink-muted">
          Você pode parar quando quiser. Nada aqui é registrado.
        </p>
      </DialogContent>
    </Dialog>
  );
}
