import type { CyclePeriod } from "@/lib/contracts/cycle";
import type {
  EmotionalCheckin,
  SleepRecord,
} from "@/lib/contracts/emotional";
import {
  ANALYTICS_VERSION,
  REPORT_SCHEMA_VERSION,
  isIanaTimeZone,
} from "@/lib/contracts/reports";
import {
  CYCLE_HEURISTIC_VERSION,
  isRegisteredPeriodDay,
  registeredPeriodBands,
} from "@/lib/cycle";
import { averageIgnoringNulls } from "@/lib/derive";

/** Minimo de dias presentes em cada janela para publicar delta/tendencia. */
export const MIN_DAYS_FOR_COMPARISON = 3;

/** Minimo de dias presentes em cada grupo de uma associacao temporal. */
export const MIN_DAYS_FOR_ASSOCIATION = 3;

/** Janela pre-menstrual: tres dias civis antes de um inicio registrado. */
export const PRE_PERIOD_WINDOW_DAYS = 3;

export interface AnalyticsWindow {
  from: string;
  to: string;
}

export type Trend = "up" | "down" | "stable" | "insufficient_data";

export interface Comparison {
  current: number | null;
  previous: number | null;
  delta: number | null;
  trend: Trend;
  currentSamples: number;
  previousSamples: number;
}

export interface DailyAnalyticsPoint {
  date: string;
  mood: number | null;
  anxiety: number | null;
  energy: number | null;
  sleepHours: number | null;
  moodHeatmapBucket: number | null;
}

export interface TemporalAssociation {
  status: "available" | "insufficient_data";
  metric: "energy";
  beforePeriodMean: number | null;
  otherDaysMean: number | null;
  delta: number | null;
  beforePeriodSamples: number;
  otherDaysSamples: number;
}

export interface AnalyticsReport {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  analyticsVersion: typeof ANALYTICS_VERSION;
  cycleHeuristicVersion: typeof CYCLE_HEURISTIC_VERSION;
  timeZone: string;
  window: AnalyticsWindow;
  previousWindow: AnalyticsWindow;
  series: DailyAnalyticsPoint[];
  metrics: {
    mood: Comparison;
    anxiety: Comparison;
    energy: Comparison;
    sleepDurationMinutes: Comparison;
  };
  cycle: {
    enabled: boolean;
    registeredMenstruationDays: number | null;
    registeredBands: Array<{ from: string; to: string }>;
  };
  associations: {
    prePeriodEnergy: TemporalAssociation;
  };
  dataQuality: {
    daysInWindow: number;
    daysWithMood: number;
    daysWithAnxiety: number;
    daysWithEnergy: number;
    daysWithSleep: number;
  };
}

export interface AnalyticsInput {
  referenceDate: string;
  days: number;
  timeZone: string;
  checkins: EmotionalCheckin[];
  sleep: SleepRecord[];
  periods: CyclePeriod[];
  cycleEnabled: boolean;
}

interface RawDailyPoint {
  date: string;
  mood: number | null;
  anxiety: number | null;
  energy: number | null;
  sleepDurationMinutes: number | null;
}

/** Janela inclusiva de `days` dias civis terminando em `to`. */
export function windowEndingAt(to: string, days: number): AnalyticsWindow {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError("A janela analitica deve ter ao menos um dia.");
  }
  return { from: addCivilDays(to, -(days - 1)), to };
}

/** Janela contigua, de mesmo tamanho, imediatamente anterior. */
export function previousWindow(window: AnalyticsWindow): AnalyticsWindow {
  const size = windowSize(window);
  return windowEndingAt(addCivilDays(window.from, -1), size);
}

export function windowSize(window: AnalyticsWindow): number {
  const size = civilDaysBetween(window.from, window.to) + 1;
  if (size < 1) throw new RangeError("Janela analitica invertida.");
  return size;
}

/** Converte um TIMESTAMPTZ para DATE no fuso IANA explicitamente informado. */
export function civilDateInTimeZone(
  value: string | Date,
  timeZone: string,
): string {
  if (!isIanaTimeZone(timeZone)) throw new RangeError("Fuso IANA invalido.");
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError("Instante invalido.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: "year" | "month" | "day") =>
    parts.find((item) => item.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) throw new RangeError("Data civil indisponivel.");
  return `${year}-${month}-${day}`;
}

/** Aritmetica de DATE em UTC para nao herdar DST do host. */
export function addCivilDays(value: string, days: number): string {
  const date = parseCivilDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatUtcDate(date);
}

export function civilDaysBetween(from: string, to: string): number {
  return Math.round(
    (parseCivilDate(to).getTime() - parseCivilDate(from).getTime()) / 86_400_000,
  );
}

/** Media aritmetica dos valores presentes. Ausencia nunca vira zero. */
export function mean(values: Array<number | null | undefined>): number | null {
  return averageIgnoringNulls(values);
}

/** Uma casa decimal; empates sao arredondados para longe de zero. */
export function roundMetric(value: number | null): number | null {
  if (value === null) return null;
  const magnitude = Math.round((Math.abs(value) + Number.EPSILON) * 10) / 10;
  return Math.sign(value) * magnitude;
}

/** Bucket fechado para heatmap: 0-2, >2-4, >4-6, >6-8, >8-10. */
export function heatmapBucket(value: number | null): number | null {
  if (value === null) return null;
  if (value <= 2) return 0;
  if (value <= 4) return 1;
  if (value <= 6) return 2;
  if (value <= 8) return 3;
  return 4;
}

/**
 * Relatorio deterministico V1.
 *
 * Check-ins sao agregados em duas etapas: media dos registros do dia e depois
 * media dos dias presentes. Assim, cada data civil tem peso um.
 */
export function buildAnalyticsReport(input: AnalyticsInput): AnalyticsReport {
  if (!isIanaTimeZone(input.timeZone)) throw new RangeError("Fuso IANA invalido.");
  const window = windowEndingAt(input.referenceDate, input.days);
  const previous = previousWindow(window);
  const raw = buildRawDailyPoints(
    { from: previous.from, to: window.to },
    input.checkins,
    input.sleep,
    input.timeZone,
  );
  const currentPoints = raw.filter((point) => inWindow(point.date, window));
  const previousPoints = raw.filter((point) => inWindow(point.date, previous));

  const metric = (
    pick: (point: RawDailyPoint) => number | null,
  ): Comparison => compareDaily(currentPoints.map(pick), previousPoints.map(pick));

  const series = currentPoints.map((point) => {
    const mood = roundMetric(point.mood);
    return {
      date: point.date,
      mood,
      anxiety: roundMetric(point.anxiety),
      energy: roundMetric(point.energy),
      sleepHours: roundMetric(
        point.sleepDurationMinutes === null
          ? null
          : point.sleepDurationMinutes / 60,
      ),
      moodHeatmapBucket: heatmapBucket(mood),
    };
  });

  const bands = input.cycleEnabled
    ? registeredPeriodBands(input.periods, window.from, window.to)
    : [];

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    analyticsVersion: ANALYTICS_VERSION,
    cycleHeuristicVersion: CYCLE_HEURISTIC_VERSION,
    timeZone: input.timeZone,
    window,
    previousWindow: previous,
    series,
    metrics: {
      mood: metric((point) => point.mood),
      anxiety: metric((point) => point.anxiety),
      energy: metric((point) => point.energy),
      sleepDurationMinutes: metric((point) => point.sleepDurationMinutes),
    },
    cycle: {
      enabled: input.cycleEnabled,
      registeredMenstruationDays: input.cycleEnabled
        ? countRegisteredMenstruationDays(input.periods, window)
        : null,
      registeredBands: bands,
    },
    associations: {
      prePeriodEnergy: prePeriodEnergyAssociation(
        currentPoints,
        input.cycleEnabled ? input.periods : [],
        window,
      ),
    },
    dataQuality: {
      daysInWindow: input.days,
      daysWithMood: countPresent(currentPoints.map((point) => point.mood)),
      daysWithAnxiety: countPresent(
        currentPoints.map((point) => point.anxiety),
      ),
      daysWithEnergy: countPresent(currentPoints.map((point) => point.energy)),
      daysWithSleep: countPresent(
        currentPoints.map((point) => point.sleepDurationMinutes),
      ),
    },
  };
}

function compareDaily(
  currentValues: Array<number | null>,
  previousValues: Array<number | null>,
): Comparison {
  const currentPresent = present(currentValues);
  const previousPresent = present(previousValues);
  const currentRaw = mean(currentPresent);
  const previousRaw = mean(previousPresent);
  const sufficient =
    currentPresent.length >= MIN_DAYS_FOR_COMPARISON &&
    previousPresent.length >= MIN_DAYS_FOR_COMPARISON;
  const delta =
    sufficient && currentRaw !== null && previousRaw !== null
      ? roundMetric(currentRaw - previousRaw)
      : null;
  return {
    current: roundMetric(currentRaw),
    previous: roundMetric(previousRaw),
    delta,
    trend:
      delta === null
        ? "insufficient_data"
        : delta === 0
          ? "stable"
          : delta > 0
            ? "up"
            : "down",
    currentSamples: currentPresent.length,
    previousSamples: previousPresent.length,
  };
}

/**
 * Quantos dias civis um intervalo inclusivo cobre.
 *
 * E o que traduz "de 01/06 a 30/06" para o `days` que o motor ja entende - e por
 * isso periodo personalizado **nao** cria caminho de calculo novo. Ele entra
 * pela mesma porta que as janelas fixas.
 */
export function inclusiveDayCount(from: string, to: string): number {
  const inicio = Date.parse(`${from}T00:00:00.000Z`);
  const fim = Date.parse(`${to}T00:00:00.000Z`);
  if (Number.isNaN(inicio) || Number.isNaN(fim)) {
    throw new RangeError("Datas civis invalidas.");
  }
  if (fim < inicio) throw new RangeError("Fim anterior ao inicio.");
  return Math.round((fim - inicio) / 86_400_000) + 1;
}


export function comparePeriods(input: {
  timeZone: string;
  checkins: EmotionalCheckin[];
  sleep: SleepRecord[];
  current: AnalyticsWindow;
  baseline: AnalyticsWindow;
}): {
  mood: Comparison;
  anxiety: Comparison;
  energy: Comparison;
  sleepHours: Comparison;
} {
  if (!isIanaTimeZone(input.timeZone)) throw new RangeError("Fuso IANA invalido.");

  const pontos = (janela: AnalyticsWindow) =>
    buildRawDailyPoints(janela, input.checkins, input.sleep, input.timeZone);

  const atual = pontos(input.current);
  const base = pontos(input.baseline);

  const metrica = (pick: (point: RawDailyPoint) => number | null): Comparison =>
    compareDaily(atual.map(pick), base.map(pick));

  return {
    mood: metrica((point) => point.mood),
    anxiety: metrica((point) => point.anxiety),
    energy: metrica((point) => point.energy),
    sleepHours: metrica((point) =>
      point.sleepDurationMinutes === null ? null : point.sleepDurationMinutes / 60,
    ),
  };
}

function buildRawDailyPoints(
  window: AnalyticsWindow,
  checkins: EmotionalCheckin[],
  sleep: SleepRecord[],
  timeZone: string,
): RawDailyPoint[] {
  const checkinsByDay = new Map<string, EmotionalCheckin[]>();
  for (const checkin of checkins) {
    const date = civilDateInTimeZone(checkin.occurredAt, timeZone);
    if (!inWindow(date, window)) continue;
    const current = checkinsByDay.get(date) ?? [];
    current.push(checkin);
    checkinsByDay.set(date, current);
  }
  const sleepByDay = new Map(sleep.map((record) => [record.night, record]));
  const points: RawDailyPoint[] = [];
  for (let index = 0; index < windowSize(window); index += 1) {
    const date = addCivilDays(window.from, index);
    const dayCheckins = checkinsByDay.get(date) ?? [];
    const night = sleepByDay.get(date);
    points.push({
      date,
      mood: mean(dayCheckins.map((checkin) => checkin.mood)),
      anxiety: mean(
        dayCheckins.map((checkin) => checkin.perceivedAnxiety),
      ),
      energy: mean(dayCheckins.map((checkin) => checkin.energy)),
      sleepDurationMinutes: night?.durationMinutes ?? null,
    });
  }
  return points;
}

function prePeriodEnergyAssociation(
  points: RawDailyPoint[],
  periods: CyclePeriod[],
  window: AnalyticsWindow,
): TemporalAssociation {
  const beforeDays = new Set<string>();
  for (const period of periods) {
    if (period.startDate < window.from || period.startDate > window.to) continue;
    for (let offset = PRE_PERIOD_WINDOW_DAYS; offset >= 1; offset -= 1) {
      const date = addCivilDays(period.startDate, -offset);
      if (inWindow(date, window)) beforeDays.add(date);
    }
  }
  const before = present(
    points
      .filter((point) => beforeDays.has(point.date))
      .map((point) => point.energy),
  );
  const other = present(
    points
      .filter((point) => !beforeDays.has(point.date))
      .map((point) => point.energy),
  );
  const beforeMean = mean(before);
  const otherMean = mean(other);
  const sufficient =
    before.length >= MIN_DAYS_FOR_ASSOCIATION &&
    other.length >= MIN_DAYS_FOR_ASSOCIATION;
  return {
    status: sufficient ? "available" : "insufficient_data",
    metric: "energy",
    beforePeriodMean: roundMetric(beforeMean),
    otherDaysMean: roundMetric(otherMean),
    delta:
      sufficient && beforeMean !== null && otherMean !== null
        ? roundMetric(beforeMean - otherMean)
        : null,
    beforePeriodSamples: before.length,
    otherDaysSamples: other.length,
  };
}

function countRegisteredMenstruationDays(
  periods: CyclePeriod[],
  window: AnalyticsWindow,
): number {
  let count = 0;
  for (let index = 0; index < windowSize(window); index += 1) {
    if (isRegisteredPeriodDay(periods, addCivilDays(window.from, index))) {
      count += 1;
    }
  }
  return count;
}

function present(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

function countPresent(values: Array<number | null>): number {
  return present(values).length;
}

function inWindow(date: string, window: AnalyticsWindow): boolean {
  return date >= window.from && date <= window.to;
}

function parseCivilDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError("Data civil invalida.");
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || formatUtcDate(date) !== value) {
    throw new RangeError("Data civil invalida.");
  }
  return date;
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
