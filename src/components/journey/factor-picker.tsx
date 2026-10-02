"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import type { EmotionalFactor } from "@/lib/contracts/emotional";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";


export function FactorPicker({
  factors,
  selected,
  onToggle,
  onCreate,
}: {
  factors: EmotionalFactor[];
  selected: string[];
  onToggle: (id: string) => void;
  onCreate: (label: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);

  const submit = async () => {
    const label = draft.trim();
    if (!label || creating) return;
    setCreating(true);
    try {
      await onCreate(label);
      setDraft("");
    } catch {
      // A superficie dona exibe a mensagem sanitizada.
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {factors.map((factor) => {
          const active = selected.includes(factor.id);
          return (
            <button
              key={factor.id}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(factor.id)}
              className={cn(
                "rounded-pill border px-3 text-sm transition-colors min-h-11 lg:min-h-9",
                active
                  ? "border-brand-500 bg-surface-brand text-brand-700"
                  : "border-line-strong bg-surface text-ink-muted hover:bg-surface-muted",
              )}
            >
              {factor.label}
              {factor.origin === "custom" ? (
                <span className="ml-1.5 text-2xs text-ink-subtle">seu</span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Criar fator próprio"
          aria-label="Criar fator próprio"
          maxLength={40}
          className="max-w-xs"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!draft.trim() || creating}
          aria-label="Adicionar fator"
          className="flex size-11 shrink-0 items-center justify-center rounded-control border border-line-strong lg:size-10 text-ink-muted transition-colors hover:bg-surface-muted disabled:opacity-40"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
