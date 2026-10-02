"use client";

import { Eraser, Pencil } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Slider de score 0-10 com ausencia como escolha explicita.
 *
 * A ausencia precisa ser uma decisao da pessoa, e nao o efeito colateral de um
 * campo deixado em zero. `NULL` nao e zero.
 *
 * `VR-006` - por que o rotulo do botao mudou. Antes ele dizia "Sem registro",
 * a mesma frase que o **valor** exibe quando esta vazio. Com o slider em
 * `7/10`, a tela mostrava "7/10" e "Sem registro" lado a lado: lia-se como
 * status contradizendo o valor, e nao como o botao de limpar que sempre foi.
 *
 * A correcao e de forma, nao de conceito - o conceito ja estava certo. O
 * rotulo passou a nomear a **acao** ("Deixar sem registro"), ganhou icone e
 * moldura de controle, e ficou visualmente distinto do numero.
 */
export function ScoreSlider({
  id,
  label,
  value,
  onChange,
  hint,
  tone = "brand",
  className,
}: {
  id: string;
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  hint?: string;
  tone?: "brand" | "anxiety" | "energy" | "sleep";
  className?: string;
}) {
  const accent = {
    brand: "var(--color-brand-600)",
    anxiety: "var(--color-metric-anxiety)",
    energy: "var(--color-metric-energy)",
    sleep: "var(--color-metric-sleep)",
  }[tone];

  // Trilho desenhado pela propria folha de estilo: `accent-color` produzia
  // aparencias diferentes conforme a luminosidade da cor. Ver `L-012`.
  const position = ((value ?? 5) / 10) * 100;

  const toggleLabel =
    value === null ? `Registrar um valor para ${label}` : `Deixar ${label} sem registro`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <label htmlFor={id} className="min-w-0 text-sm font-medium text-ink">
          {label}
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              "text-sm tabular-nums",
              value === null ? "text-ink-subtle" : "text-base font-semibold text-brand-700",
            )}
            data-testid={`${id}-value`}
          >
            {value === null ? "Sem registro" : `${value}/10`}
          </span>
          {/*
            R2 (homologacao fisica): o botao com texto se repetia em cada slider
            e pesava a tela. Virou um controle de icone ao lado do valor — mesma
            acao, mesmo alvo de 44px, nome acessivel com o campo. Cada variavel
            continua podendo ficar sem registro de forma independente.
          */}
          <button
            type="button"
            data-testid={`${id}-toggle`}
            onClick={() => onChange(value === null ? 5 : null)}
            aria-label={toggleLabel}
            title={value === null ? "Registrar valor" : "Deixar sem registro"}
            className={cn(
              "motion-press inline-flex size-11 shrink-0 items-center justify-center rounded-pill",
              "text-ink-subtle transition-colors",
              "hover:bg-surface-brand hover:text-brand-700",
            )}
          >
            {value === null ? (
              <Pencil className="size-4" aria-hidden="true" />
            ) : (
              <Eraser className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <input
        id={id}
        type="range"
        min={0}
        max={10}
        step={1}
        value={value ?? 5}
        data-unset={value === null}
        aria-valuetext={value === null ? "Sem registro" : `${value} de 10`}
        onChange={(e) => onChange(Number(e.target.value))}
        style={
          {
            "--slider-accent": accent,
            "--slider-fill": `${position}%`,
          } as React.CSSProperties
        }
        className={cn("score-slider", className)}
      />

      {hint ? <p className="text-xs text-ink-subtle">{hint}</p> : null}
    </div>
  );
}
