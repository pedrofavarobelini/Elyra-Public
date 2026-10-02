import { IANA_REGION_PATTERN } from "@/lib/contracts/scheduling";

/**
 * Formatacao de horario da agenda (PRO-6), usada no servidor e no navegador.
 *
 * Todo horario e mostrado **no fuso em que foi oferecido** (o da regra do
 * profissional, copiado para o agendamento) e com o fuso escrito por extenso.
 * Quando o fuso de quem ve e outro, a tela acrescenta a hora local — nunca
 * troca uma pela outra em silencio.
 */

export function formatTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

/** "Sexta-feira, 25 de setembro" (so a primeira letra maiuscula, como em pt-BR). */
export function formatDayHeading(iso: string, timezone: string): string {
  const text = new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(iso));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Das 08:00 às 12:00 · 4 horários de 60 min" — leitura humana de um intervalo. */
export function describeRule(startMinute: number, endMinute: number, slotMinutes: number): string {
  const count = Math.max(0, Math.floor((endMinute - startMinute) / slotMinutes));
  return `Das ${minutesToClock(startMinute)} às ${minutesToClock(endMinute)} · ${count} ${
    count === 1 ? "horário" : "horários"
  } de ${slotMinutes} min`;
}

/** Chave de dia local (AAAA-MM-DD) no fuso informado. */
export function localDayKey(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** Grafia pt-BR das cidades-fuso brasileiras (o nome IANA vem sem acento). */
const PT_BR_CITY: Record<string, string> = {
  Sao_Paulo: "São Paulo",
  Belem: "Belém",
  Maceio: "Maceió",
  Cuiaba: "Cuiabá",
  Araguaina: "Araguaína",
  Santarem: "Santarém",
  Noronha: "Fernando de Noronha",
};

/** "America/Sao_Paulo" -> "horário de São Paulo". */
export function timezoneLabel(timezone: string): string {
  const last = timezone.split("/").pop() ?? timezone;
  const city = PT_BR_CITY[last] ?? last.replace(/_/g, " ");
  return `horário de ${city}`;
}

/** Fuso do navegador, se for um nome IANA de regiao; senao `null`. */
export function browserTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && IANA_REGION_PATTERN.test(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** Mesmo instante, relogios diferentes? (compara a hora de parede, nao o nome). */
export function differsFromViewer(iso: string, timezone: string, viewer: string | null): boolean {
  if (!viewer || viewer === timezone) return false;
  return formatTime(iso, timezone) !== formatTime(iso, viewer) ||
    localDayKey(iso, timezone) !== localDayKey(iso, viewer);
}

export function groupByLocalDay<T extends { startsAt: string; timezone: string }>(
  items: T[],
): { key: string; heading: string; items: T[] }[] {
  const groups = new Map<string, { heading: string; items: T[] }>();
  for (const item of items) {
    const key = `${localDayKey(item.startsAt, item.timezone)}|${item.timezone}`;
    const group = groups.get(key) ?? {
      heading: formatDayHeading(item.startsAt, item.timezone),
      items: [],
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, ...group }));
}

/** 540 -> "09:00"; 1440 -> "24:00". */
export function minutesToClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "09:30" -> 570. Fim "00:00" vale meia-noite do fim do dia (1440). */
export function clockToMinutes(value: string, { isEnd = false } = {}): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (minutes >= 1440) return null;
  return isEnd && minutes === 0 ? 1440 : minutes;
}

let cachedZones: string[] | null = null;

/** Lista estavel (mesma referencia) para `useSyncExternalStore`. */
export function runtimeTimezones(): string[] {
  cachedZones ??= selectableTimezones(null);
  return cachedZones;
}

/** Fusos oferecidos no seletor: os do runtime, filtrados para regioes IANA. */
export function selectableTimezones(current: string | null): string[] {
  let zones: string[] = [];
  try {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    zones = intl.supportedValuesOf?.("timeZone") ?? [];
  } catch {
    zones = [];
  }
  const base = zones.filter((zone) => IANA_REGION_PATTERN.test(zone));
  const preferred = ["America/Sao_Paulo", current, browserTimezone()].filter(
    (zone): zone is string => Boolean(zone),
  );
  return [...new Set([...preferred, ...base])];
}
