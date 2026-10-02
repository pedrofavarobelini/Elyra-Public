"use client";

import { Check } from "lucide-react";

import {
  PRIMARY_FEELINGS,
  PRIMARY_FEELING_LABEL,
  type PrimaryFeeling,
} from "@/lib/contracts/emotional";
import { cn } from "@/lib/utils";

const EMOJI: Record<PrimaryFeeling, string> = {
  feliz: "\u{1F604}",
  tranquilo: "\u{1F60C}",
  neutro: "\u{1F610}",
  triste: "\u{1F641}",
  ansioso: "\u{1F630}",
};

const TONE: Record<PrimaryFeeling, string> = {
  feliz: "bg-attention-soft",
  tranquilo: "bg-metric-energy-soft",
  neutro: "bg-surface-muted",
  triste: "bg-metric-sleep-soft",
  ansioso: "bg-metric-anxiety-soft",
};

/**
 * Seletor de sentimento predominante.
 *
 * Campo SEPARADO dos scores: nao e derivado de humor, ansiedade ou energia.
 * Padrao da figura 1.
 */
export function FeelingPicker({
  value,
  onChange,
  name = "primaryFeeling",
}: {
  value: PrimaryFeeling | null;
  onChange: (value: PrimaryFeeling | null) => void;
  name?: string;
}) {
  return (
    <fieldset>
      <legend className="sr-only">Sentimento predominante</legend>
      {/*
        Flex centralizado, e nao grid: com 5 opcoes em 3 colunas, a ultima linha
        centraliza em vez de deixar um orfao encostado a esquerda.
      */}
      <div className="flex flex-wrap justify-center gap-2 sm:gap-3">
        {PRIMARY_FEELINGS.map((feeling) => {
          const selected = value === feeling;
          return (
            <label
              key={feeling}
              className={cn(
                "relative flex w-[calc((100%-1rem)/3)] cursor-pointer flex-col items-center gap-1.5 rounded-card border px-1 py-3 transition-[background-color,border-color,box-shadow] duration-150 min-[440px]:w-[calc((100%-2rem)/5)] sm:w-[calc((100%-3rem)/5)] sm:gap-2",
                // O input e sr-only: sem espelhar o foco no cartao, quem navega
                // por teclado nao enxerga a opcao ativa (WCAG 2.4.7).
                "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand-600",
                selected
                  ? "border-brand-400 bg-brand-50 ring-2 ring-brand-200"
                  : "border-line bg-surface hover:border-brand-200 hover:bg-surface-brand",
              )}
            >
              <input
                type="radio"
                name={name}
                value={feeling}
                checked={selected}
                onChange={() => onChange(feeling)}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-11 items-center justify-center rounded-pill text-2xl sm:size-12",
                  TONE[feeling],
                )}
              >
                {EMOJI[feeling]}
              </span>
              <span className="max-w-full truncate text-sm text-ink">
                {PRIMARY_FEELING_LABEL[feeling]}
              </span>
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-pill bg-brand-600 text-white"
                >
                  <Check className="size-3" />
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
