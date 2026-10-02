"use client";

import { Clock3 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { HISTORY_DOMAIN, type HistoryDomain } from "@/lib/contracts/personal-window";
import { useMockStore } from "@/mocks/store";


export function OlderHistoryNotice({
  domains,
  className,
}: {
  domains: readonly HistoryDomain[];
  className?: string;
}) {
  const { window: personalWindow, loadingOlder, loadOlderHistory } = useMockStore();
  const [error, setError] = useState<string | null>(null);

  const pending = domains.reduce(
    (total, domain) => total + (personalWindow.olderCounts[domain] ?? 0),
    0,
  );
  if (pending === 0) return null;

  const label = pending === 1 ? "1 registro anterior" : `${pending} registros anteriores`;

  return (
    <div
      data-testid="older-history"
      className={`mb-4 flex flex-wrap items-center gap-2 rounded-control bg-surface-muted px-3 py-2 text-sm text-ink-muted ${className ?? ""}`}
    >
      <Clock3 className="size-4 shrink-0" aria-hidden="true" />
      <span role="status">
        Mostrando os últimos {personalWindow.days} dias. Há {label} guardados na sua conta.
      </span>
      <Button
        variant="soft"
        size="sm"
        disabled={loadingOlder}
        onClick={() => {
          setError(null);
          void loadOlderHistory(domains).catch(() =>
            setError(
              "Não foi possível carregar agora. Sem conexão, o histórico anterior fica na sua conta e volta quando a rede voltar.",
            ),
          );
        }}
      >
        {loadingOlder ? "Carregando…" : "Carregar anteriores"}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Conjuntos usados pelas telas, nomeados para nao repetir literal por pagina. */
export const HISTORY_DOMAINS = {
  history: [HISTORY_DOMAIN.CHECKINS, HISTORY_DOMAIN.SLEEP] as const,
  journal: [HISTORY_DOMAIN.JOURNAL] as const,
  cycle: [HISTORY_DOMAIN.CYCLE_RECORDS] as const,
  goals: [HISTORY_DOMAIN.GOAL_PROGRESS] as const,
  reports: [HISTORY_DOMAIN.CHECKINS, HISTORY_DOMAIN.SLEEP, HISTORY_DOMAIN.CYCLE_RECORDS] as const,

  journey: [
    HISTORY_DOMAIN.CHECKINS,
    HISTORY_DOMAIN.SLEEP,
    HISTORY_DOMAIN.JOURNAL,
    HISTORY_DOMAIN.GOAL_PROGRESS,
    HISTORY_DOMAIN.CYCLE_RECORDS,
  ] as const,
};
