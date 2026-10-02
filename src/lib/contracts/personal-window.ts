

export const PERSONAL_WINDOW_DAYS = 120;

/** Inicio da janela, em data civil (YYYY-MM-DD), a partir de `now`. */
export function personalWindowStart(now: Date = new Date()): string {
  const start = new Date(now.getTime() - PERSONAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  return start.toISOString().slice(0, 10);
}

/** Instante de inicio da janela, para colunas `timestamptz`. */
export function personalWindowStartInstant(now: Date = new Date()): string {
  return `${personalWindowStart(now)}T00:00:00.000Z`;
}

/** Dominios que a janela recorta e que a historia sob demanda sabe buscar. */
export const HISTORY_DOMAIN = {
  CHECKINS: "checkins",
  JOURNAL: "journal",
  SLEEP: "sleep",
  CYCLE_RECORDS: "cycle_records",
  GOAL_PROGRESS: "goal_progress",
} as const;
export type HistoryDomain = (typeof HISTORY_DOMAIN)[keyof typeof HISTORY_DOMAIN];

/** Teto por pagina de historia — o mesmo motivo do bloco de IDs: URI e memoria. */
export const HISTORY_PAGE_SIZE = 200;

export interface PersonalWindowInfo {
  days: number;
  /** Data civil de inicio da janela carregada. */
  since: string;
  /** Ha registro anterior a janela em algum dominio? */
  hasOlder: boolean;
  /** Totais por dominio, para a tela dizer quanto ficou fora. */
  olderCounts: Record<HistoryDomain, number>;
}

export const EMPTY_OLDER_COUNTS: Record<HistoryDomain, number> = {
  checkins: 0,
  journal: 0,
  sleep: 0,
  cycle_records: 0,
  goal_progress: 0,
};
