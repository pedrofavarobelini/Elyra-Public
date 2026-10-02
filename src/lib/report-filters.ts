import type { CyclePeriod, CyclePhase } from "@/lib/contracts/cycle";
import { CYCLE_PHASES } from "@/lib/contracts/cycle";
import type { EmotionalCheckin, SleepRecord } from "@/lib/contracts/emotional";
import type { JournalEntry } from "@/lib/contracts/journal";
import { derivedPhase } from "@/lib/cycle";
import { civilDateInTimeZone } from "@/lib/reports";



export const REPORT_DOMAINS = ["emotional", "sleep", "cycle"] as const;

export type ReportDomain = (typeof REPORT_DOMAINS)[number];

export const REPORT_DOMAIN_LABEL: Record<ReportDomain, string> = {
  emotional: "Emocional",
  sleep: "Sono",
  cycle: "Ciclo",
};

export interface ReportFilterSelection {
  /** Dominios cujos registros alimentam o motor. */
  domains: ReportDomain[];
  /** Dias em que qualquer um destes fatores foi registrado. */
  factorIds: string[];
  /** Dias com entrada de diario salva marcada com qualquer uma destas tags. */
  journalTagIds: string[];
  /** Dias cuja fase derivada e uma destas. */
  cyclePhases: CyclePhase[];
}

/** Nenhum recorte: todos os dominios, nenhum filtro de dia. */
export const NO_REPORT_FILTERS: ReportFilterSelection = {
  domains: [...REPORT_DOMAINS],
  factorIds: [],
  journalTagIds: [],
  cyclePhases: [],
};

export interface ReportFilterInput {
  selection: ReportFilterSelection;
  timeZone: string;
  checkins: EmotionalCheckin[];
  sleep: SleepRecord[];
  periods: CyclePeriod[];
  journal: JournalEntry[];
  cycleEnabled: boolean;
}

export interface FilteredAnalyticsInput {
  checkins: EmotionalCheckin[];
  sleep: SleepRecord[];
  periods: CyclePeriod[];
  cycleEnabled: boolean;
}

/**
 * `true` quando a selecao recorta alguma coisa.
 *
 * Serve para uma decisao especifica e nao cosmetica: um relatorio recortado
 * **nao pode virar snapshot**. O snapshot e persistido pelo servidor a partir de
 * `{days, referenceDate, timeZone}` e nao carrega filtro nenhum - salvar um
 * relatorio filtrado gravaria um artefato que descreve outro conjunto que o da
 * tela, e esse artefato e justamente o que pode alcancar o Veltrix.
 */
export function hasReportFilter(selection: ReportFilterSelection): boolean {
  return (
    selection.domains.length !== REPORT_DOMAINS.length ||
    selection.factorIds.length > 0 ||
    selection.journalTagIds.length > 0 ||
    selection.cyclePhases.length > 0
  );
}

/** `true` quando alguma dimensao recorta **dias** (fator, tag ou fase). */
export function hasDayFilter(selection: ReportFilterSelection): boolean {
  return (
    selection.factorIds.length > 0 ||
    selection.journalTagIds.length > 0 ||
    selection.cyclePhases.length > 0
  );
}

/**
 * Recorta a entrada analitica. Nao agrega, nao arredonda, nao compara.
 *
 * A saida tem a forma exata que `buildAnalyticsReport` e `comparePeriods` ja
 * consomem - o chamador troca a entrada, nunca o motor.
 */
export function applyReportFilters(
  input: ReportFilterInput,
): FilteredAnalyticsInput {
  const { selection, timeZone } = input;
  const domains = new Set<ReportDomain>(selection.domains);

  const emotionalOn = domains.has("emotional");
  const sleepOn = domains.has("sleep");
  const cycleOn = domains.has("cycle");

  /*
    A fase e derivada dos periodos **reais** da pessoa, e nao dos periodos ja
    recortados por dominio. Derivar fase de um historico mutilado devolveria uma
    fase que a pessoa nunca esteve.
  */
  const dayAllowed = buildDayPredicate(input, cycleOn);

  const checkins = emotionalOn
    ? input.checkins.filter((checkin) =>
        dayAllowed(civilDateInTimeZone(checkin.occurredAt, timeZone)),
      )
    : [];

  const sleep = sleepOn
    ? input.sleep.filter((record) => dayAllowed(record.night))
    : [];

  return {
    checkins,
    sleep,
    periods: cycleOn ? input.periods : [],
    cycleEnabled: input.cycleEnabled && cycleOn,
  };
}

function buildDayPredicate(
  input: ReportFilterInput,
  cycleOn: boolean,
): (day: string) => boolean {
  const { selection, timeZone } = input;

  const predicates: Array<(day: string) => boolean> = [];

  if (selection.factorIds.length > 0) {
    const wanted = new Set(selection.factorIds);
    const days = new Set(
      input.checkins
        .filter((checkin) =>
          checkin.factorIds.some((factorId) => wanted.has(factorId)),
        )
        .map((checkin) => civilDateInTimeZone(checkin.occurredAt, timeZone)),
    );
    predicates.push((day) => days.has(day));
  }

  if (selection.journalTagIds.length > 0) {
    const wanted = new Set(selection.journalTagIds);
    const days = new Set(
      input.journal
        .filter(
          (entry) =>
            entry.status === "saved" &&
            entry.trashedAt === null &&
            entry.tagIds.some((tagId) => wanted.has(tagId)),
        )
        .map((entry) => civilDateInTimeZone(entry.createdAt, timeZone)),
    );
    predicates.push((day) => days.has(day));
  }

  if (selection.cyclePhases.length > 0) {
    const wanted = new Set<CyclePhase>(selection.cyclePhases);
    /*
      Fail-closed. Sem acompanhamento de ciclo ligado, sem o dominio de ciclo
      selecionado ou sem periodo registrado, nao ha base para afirmar que um dia
      pertence a uma fase - entao nenhum dia pertence. Deixar passar por default
      transformaria "nao sei" em "sim".
    */
    const base = cycleOn && input.cycleEnabled ? input.periods : [];
    predicates.push((day) => {
      const fase = derivedPhase(base, day);
      return fase !== null && wanted.has(fase);
    });
  }

  if (predicates.length === 0) return () => true;
  return (day) => predicates.every((predicate) => predicate(day));
}

/** Ordena uma selecao para que duas geracoes do mesmo estado sejam identicas. */
export function normalizeSelection(
  selection: ReportFilterSelection,
): ReportFilterSelection {
  return {
    domains: REPORT_DOMAINS.filter((domain) =>
      selection.domains.includes(domain),
    ),
    factorIds: [...selection.factorIds].sort(),
    journalTagIds: [...selection.journalTagIds].sort(),
    cyclePhases: CYCLE_PHASES.filter((phase) =>
      selection.cyclePhases.includes(phase),
    ),
  };
}
