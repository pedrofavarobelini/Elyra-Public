/** Civil dates: arithmetic never depends on the browser's timezone or DST. */
export function isCivilDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function addCivilDays(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function civilWeekStart(value: string): string {
  const weekday = new Date(`${value}T12:00:00Z`).getUTCDay();
  return addCivilDays(value, -((weekday + 6) % 7));
}

export function civilDateLabel(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short", day: "2-digit", month: "short", timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

export function civilWeekLabel(value: string): string {
  const format = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  return `${format.format(new Date(`${value}T12:00:00Z`))} – ${format.format(new Date(`${addCivilDays(value, 6)}T12:00:00Z`))}`;
}
