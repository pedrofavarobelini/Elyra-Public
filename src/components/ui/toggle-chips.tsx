"use client";

import { cn } from "@/lib/utils";

/**
 * Selecao multipla em chips (`aria-pressed`). Extraida do editor de perfil
 * publico (PRO-5) para o onboarding profissional (F2) usar a mesma peca.
 */
export function ToggleChips({
  name,
  options,
  selected,
  onChange,
  max,
}: {
  name: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  selected: string[];
  onChange: (next: string[]) => void;
  max?: number;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const on = selected.includes(option.value);
        const full = !on && max !== undefined && selected.length >= max;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            disabled={full}
            data-option={`${name}:${option.value}`}
            onClick={() => onChange(on ? selected.filter((item) => item !== option.value) : [...selected, option.value])}
            className={cn(
              "motion-press inline-flex min-h-10 items-center rounded-pill border px-3 text-sm font-medium transition-colors disabled:opacity-50",
              on ? "border-brand-300 bg-surface-brand text-brand-700" : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
