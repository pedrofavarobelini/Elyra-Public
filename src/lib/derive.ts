import type {
  EmotionalCheckin,
  SleepRecord,
} from "@/lib/contracts/emotional";

/**
 * Primitivas pequenas de derivacao compartilhadas.
 *
 * A Analytics Specification V1 vive em `src/lib/reports.ts`. Este arquivo
 * mantem somente media sem ausencia e selecao do evento mais recente.
 *
 * Invariante desta camada: valores ausentes sao IGNORADOS, nunca tratados como
 * zero. Uma janela sem nenhum registro retorna `null`, nao `0`.
 */

/** Media simples ignorando ausencias. Retorna `null` se nao houver registro. */
export function averageIgnoringNulls(
  values: Array<number | null | undefined>,
): number | null {
  const present = values.filter(
    (v): v is number => v !== null && v !== undefined && !Number.isNaN(v),
  );
  if (present.length === 0) return null;
  const sum = present.reduce((a, b) => a + b, 0);
  return sum / present.length;
}

/** Registro de sono mais recente. `null` se nao houver nenhum. */
export function latestSleep(records: SleepRecord[]): SleepRecord | null {
  if (records.length === 0) return null;
  return [...records].sort((a, b) => b.night.localeCompare(a.night))[0] ?? null;
}

/** Check-in mais recente. `null` se nao houver nenhum. */
export function latestCheckin(
  checkins: EmotionalCheckin[],
): EmotionalCheckin | null {
  if (checkins.length === 0) return null;
  return (
    [...checkins].sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    )[0] ?? null
  );
}
