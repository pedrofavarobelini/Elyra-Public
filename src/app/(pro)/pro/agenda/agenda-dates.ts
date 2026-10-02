import {
  MODALITY_LABEL,
  WEEKDAY_LABEL,
  type AvailabilityException,
  type AvailabilityRule,
} from "@/lib/contracts/scheduling";
import { minutesToClock } from "@/lib/scheduling/format";

/**
 * Datas locais (AAAA-MM-DD) da agenda profissional. Aritmetica em UTC ao meio
 * dia: somar dias a uma data de calendario nao pode tropecar em horario de verao.
 */
export function addDaysToKey(key: string, days: number): string {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** "sáb., 04/10" */
export function formatDateKey(key: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "UTC",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${key}T12:00:00Z`));
}

function range(start: number | null, end: number | null): string {
  return start === null || end === null ? "dia inteiro" : `${minutesToClock(start)}–${minutesToClock(end)}`;
}

/** "sáb., 04/10 · 14:00–16:00 · 60 min · Online" / "12/10 a 19/10 · dia inteiro". */
export function describeException(item: AvailabilityException): string {
  const days =
    item.startsOn === item.endsOn
      ? formatDateKey(item.startsOn)
      : `${formatDateKey(item.startsOn)} a ${formatDateKey(item.endsOn)}`;
  const parts = [days, range(item.startMinute, item.endMinute)];
  if (item.kind === "open" && item.slotMinutes && item.modality) {
    parts.push(`${item.slotMinutes} min`, MODALITY_LABEL[item.modality]);
  }
  return parts.join(" · ");
}

/** A excecao vale neste dia? */
export function exceptionCoversDay(item: AvailabilityException, key: string): boolean {
  return item.startsOn <= key && key <= item.endsOn;
}

export function blockLabel(item: AvailabilityException): string {
  return item.startMinute === null ? "Bloqueado o dia todo" : `Bloqueado ${range(item.startMinute, item.endMinute)}`;
}

/** "Seg · 09:00–12:00 · 60 min · Online" */
export function describeWeeklyRule(rule: AvailabilityRule): string {
  return `${WEEKDAY_LABEL[rule.weekday]} · ${minutesToClock(rule.startMinute)}–${minutesToClock(rule.endMinute)} · ${rule.slotMinutes} min · ${MODALITY_LABEL[rule.modality]}`;
}
