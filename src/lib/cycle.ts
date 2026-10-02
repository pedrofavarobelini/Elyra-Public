import type { CyclePeriod, CyclePhase } from "@/lib/contracts/cycle";



/** Duracao usada quando ainda nao ha historico suficiente para uma media. */
export const DEFAULT_CYCLE_LENGTH_DAYS = 28;

/** Minimo de inicios registrados para calcular uma media (2 inicios = 1 ciclo). */
export const MIN_STARTS_FOR_AVERAGE = 2;


export const LUTEAL_PHASE_DAYS = 14;


export const CYCLE_HEURISTIC_VERSION = "elyra-cycle/v1" as const;

/** Data civil local no formato YYYY-MM-DD. */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Constroi uma data local a partir de `YYYY-MM-DD`, sem deslocamento de fuso. */
export function fromISODate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y as number, (m as number) - 1, d as number);
}

/** Diferenca em dias civis entre duas datas (`to - from`). */
export function daysBetween(from: string, to: string): number {
  const ms = fromISODate(to).getTime() - fromISODate(from).getTime();
  return Math.round(ms / 86_400_000);
}

/** Soma dias a uma data civil. */
export function addDays(date: string, days: number): string {
  const d = fromISODate(date);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Periodos ordenados do mais antigo para o mais recente. */
export function sortedPeriods(periods: CyclePeriod[]): CyclePeriod[] {
  return [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

/** Inicio do periodo mais recente. `null` se nao houver nenhum. */
export function lastPeriodStart(periods: CyclePeriod[]): string | null {
  const ordered = sortedPeriods(periods);
  return ordered.at(-1)?.startDate ?? null;
}

/**
 * Duracao media do ciclo: media das diferencas entre inicios consecutivos.
 *
 * `null` quando ha menos de dois inicios - com um unico registro nao existe
 * intervalo para medir, e devolver 28 nesse caso seria apresentar um palpite
 * como se fosse historico do usuario.
 */
export function averageCycleLength(periods: CyclePeriod[]): number | null {
  const starts = sortedPeriods(periods).map((p) => p.startDate);
  if (starts.length < MIN_STARTS_FOR_AVERAGE) return null;

  let total = 0;
  for (let i = 1; i < starts.length; i += 1) {
    total += daysBetween(starts[i - 1] as string, starts[i] as string);
  }
  return Math.round(total / (starts.length - 1));
}

/** Quantos ciclos completos sustentam a media. `0` quando nao ha media. */
export function cyclesConsidered(periods: CyclePeriod[]): number {
  return Math.max(0, sortedPeriods(periods).length - 1);
}

/**
 * Duracao efetiva usada nas estimativas: a media do usuario quando existir,
 * senao o padrao declarado.
 */
export function effectiveCycleLength(periods: CyclePeriod[]): number {
  return averageCycleLength(periods) ?? DEFAULT_CYCLE_LENGTH_DAYS;
}

/** Duracao media dos periodos ja encerrados. `null` se nenhum terminou. */
export function averagePeriodLength(periods: CyclePeriod[]): number | null {
  const closed = periods.filter((p) => p.endDate !== null);
  if (closed.length === 0) return null;
  const total = closed.reduce(
    (sum, p) => sum + daysBetween(p.startDate, p.endDate as string) + 1,
    0,
  );
  return Math.round(total / closed.length);
}

/**
 * Dia do ciclo em `date`, 1-based a partir do ultimo inicio **anterior ou igual**
 * a data. `null` quando nao ha periodo registrado antes dela.
 */
export function cycleDay(periods: CyclePeriod[], date: string): number | null {
  const starts = sortedPeriods(periods)
    .map((p) => p.startDate)
    .filter((s) => s <= date);
  const start = starts.at(-1);
  if (!start) return null;
  return daysBetween(start, date) + 1;
}

/**
 * Proxima menstruacao **estimada**: ultimo inicio + duracao efetiva.
 *
 * Nunca apresentada como certeza. `null` sem nenhum periodo registrado.
 */
export function estimatedNextPeriodStart(
  periods: CyclePeriod[],
): string | null {
  const last = lastPeriodStart(periods);
  if (!last) return null;
  return addDays(last, effectiveCycleLength(periods));
}

/**
 * Ovulacao **estimada**: proximo inicio estimado - `LUTEAL_PHASE_DAYS`.
 *
 * Heuristica V1 versionada (ver `LUTEAL_PHASE_DAYS`). Nunca apresentada como
 * certeza, nunca persistida como fato e nunca oferecida como indicador de
 * fertilidade ou metodo contraceptivo. Quem renderiza precisa rotular como
 * estimativa.
 */
export function estimatedOvulation(periods: CyclePeriod[]): string | null {
  const next = estimatedNextPeriodStart(periods);
  if (!next) return null;
  return addDays(next, -LUTEAL_PHASE_DAYS);
}

/** Dias ate a proxima menstruacao estimada. Negativo se a estimativa passou. */
export function daysUntilNextPeriod(
  periods: CyclePeriod[],
  reference: string,
): number | null {
  const next = estimatedNextPeriodStart(periods);
  if (!next) return null;
  return daysBetween(reference, next);
}

/** `true` se a data cai dentro de um periodo **registrado** (nao estimado). */
export function isRegisteredPeriodDay(
  periods: CyclePeriod[],
  date: string,
): boolean {
  return periods.some((p) => {
    if (date < p.startDate) return false;
    if (p.endDate === null) return date === p.startDate;
    return date <= p.endDate;
  });
}

/**
 * Fase **derivada** do ciclo em `date`.
 *
 * Derivada da posicao no ciclo, jamais persistida e jamais apresentada como
 * verdade biologica. A janela de ovulacao usa a heuristica versionada descrita
 * em `LUTEAL_PHASE_DAYS`, entao a fase resultante e **estimativa** e precisa ser
 * rotulada como tal em qualquer superficie. `null` quando nao ha base para
 * derivar.
 *
 * Aproximacao usada, toda declarada:
 *  - `menstrual`  - dentro de um periodo registrado, ou nos primeiros
 *                   `averagePeriodLength` dias do ciclo quando nao ha registro;
 *  - `ovulatory`  - janela de +/- 1 dia em torno da ovulacao estimada;
 *  - `follicular` - entre o fim da menstruacao e a janela de ovulacao;
 *  - `luteal`     - depois da janela de ovulacao.
 */
export function derivedPhase(
  periods: CyclePeriod[],
  date: string,
): CyclePhase | null {
  const day = cycleDay(periods, date);
  if (day === null) return null;

  if (isRegisteredPeriodDay(periods, date)) return "menstrual";

  const periodLength = averagePeriodLength(periods) ?? 5;
  if (day <= periodLength) return "menstrual";

  const length = effectiveCycleLength(periods);
  const ovulationDay = length - LUTEAL_PHASE_DAYS;

  if (Math.abs(day - ovulationDay) <= 1) return "ovulatory";
  return day < ovulationDay ? "follicular" : "luteal";
}

/**
 * Faixas de periodo registrado que caem dentro de uma janela, no formato que o
 * grafico usa para desenhar o fundo rosa.
 *
 * Somente periodos **registrados** entram: uma faixa desenhada a partir de
 * estimativa daria a um palpite a mesma aparencia de um dado informado.
 */
export function registeredPeriodBands(
  periods: CyclePeriod[],
  from: string,
  to: string,
): Array<{ from: string; to: string }> {
  return periods
    .filter((p) => p.startDate <= to && (p.endDate ?? p.startDate) >= from)
    .map((p) => ({
      from: p.startDate < from ? from : p.startDate,
      to: (p.endDate ?? p.startDate) > to ? to : (p.endDate ?? p.startDate),
    }));
}
