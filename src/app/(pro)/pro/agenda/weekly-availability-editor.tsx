"use client";

import { useId, useState } from "react";
import { schedulingFetch } from "@/components/scheduling/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RequiresConnection } from "@/components/offline/requires-connection";
import { availabilityWeekInputSchema, MODALITY_LABEL, SLOT_MINUTES, type AvailabilityWeek, type WeekBlock, type WeekInterval } from "@/lib/contracts/scheduling";
import { addCivilDays, civilDateLabel } from "@/lib/scheduling/calendar";
import { clockToMinutes, minutesToClock, localDayKey, timezoneLabel } from "@/lib/scheduling/format";

const FIELD = "min-h-11 w-full min-w-0 rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-60";
type DraftInterval = WeekInterval & { key: string };
type DraftBlock = WeekBlock & { key: string };
const clock = (value: number) => value === 1440 ? "00:00" : value < 0 ? "" : minutesToClock(value);

export function WeeklyAvailabilityEditor({ initial, now, verified, externalBusy, onBusy, onDirty, onSaved }: {
  initial: AvailabilityWeek; now: string; verified: boolean; externalBusy: boolean;
  onBusy: (busy: boolean) => void;
  onDirty: (dirty: boolean) => void; onSaved: (week: AvailabilityWeek) => void;
}) {
  const id = useId();
  const [intervals, setIntervals] = useState<DraftInterval[]>(initial.intervals.map((item, i) => ({ ...item, key: `${id}-i${i}` })));
  const [blocks, setBlocks] = useState<DraftBlock[]>(initial.blocks.map((item, i) => ({ ...item, key: `${id}-b${i}` })));
  const [sequence, setSequence] = useState(0);
  const [timezone, setTimezone] = useState(initial.timezone);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = localDayKey(now, timezone);
  const lastDay = addCivilDays(today, 60);
  const zones = [...new Set([initial.timezone, "America/Sao_Paulo", "America/Manaus", "America/New_York", "Europe/Lisbon"])];
  const changed = () => { setDirty(true); onDirty(true); setError(null); };
  function addInterval(date: string) {
    const previous = intervals.filter((item) => item.date === date).at(-1);
    const startMinute = previous ? Math.min(previous.endMinute + 60, 1380) : 540;
    setIntervals([...intervals, { key: `${id}-new${sequence}`, date, startMinute, endMinute: Math.min(startMinute + 180, 1440), slotMinutes: 30, modality: "online" }]);
    setSequence(sequence + 1); changed();
  }
  function update(key: string, patch: Partial<WeekInterval>) {
    setIntervals(intervals.map((item) => item.key === key ? { ...item, ...patch } : item)); changed();
  }
  async function save() {
    const result = availabilityWeekInputSchema.safeParse({
      weekStart: initial.weekStart, timezone, revision: initial.revision,
      intervals: intervals.map((item) => ({ date: item.date, startMinute: item.startMinute, endMinute: item.endMinute, slotMinutes: item.slotMinutes, modality: item.modality })),
      blocks: blocks.map((item) => ({ date: item.date, startMinute: item.startMinute, endMinute: item.endMinute })),
    });
    if (!result.success) { setError(result.error.issues[0]?.message ?? "Revise os horários."); return; }
    setBusy(true); onBusy(true); setError(null);
    try {
      const week = await schedulingFetch<AvailabilityWeek>("/api/scheduling/availability/week", { method: "PUT", body: JSON.stringify(result.data) });
      setDirty(false); onDirty(false); onSaved(week);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível salvar a semana."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <Card data-testid="weekly-availability">
    <CardHeader>
      <CardTitle as="h2">Disponibilidade da semana</CardTitle>
      <CardDescription>Publique datas e horários desta semana. Remover ou bloquear disponibilidade não cancela atendimentos.</CardDescription>
      <p role="status" className="text-sm font-medium text-ink" data-testid="week-publication-status">{dirty ? "Alterada · não salva" : initial.published ? "Publicada" : "Não publicada"}</p>
    </CardHeader>
    <CardContent className="flex min-w-0 flex-col gap-4">
      <RequiresConnection>
      <div className="mb-4 max-w-sm">
        <Label htmlFor={`${id}-tz`}>Fuso da agenda</Label>
        <select id={`${id}-tz`} className={`${FIELD} mt-1`} value={timezone} disabled={busy || externalBusy || !verified} onChange={(e) => { setTimezone(e.target.value); changed(); }}>
          {zones.map((zone) => <option key={zone} value={zone}>{timezoneLabel(zone)}</option>)}
        </select>
        <p className="mt-1 text-xs text-ink-muted">As datas abaixo pertencem a este fuso. Fim 00:00 significa o fim do dia.</p>
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 7 }, (_, i) => addCivilDays(initial.weekStart, i)).map((date) => {
          const dayIntervals = intervals.filter((item) => item.date === date);
          const dayBlocks = blocks.filter((item) => item.date === date);
          const wholeDay = dayBlocks.some((item) => item.startMinute === null);
          const readonly = date < today || date > lastDay;
          return <fieldset key={date} disabled={busy || externalBusy || !verified || readonly} data-testid={`week-day-${date}`} className="min-w-0 rounded-control border border-line p-3 disabled:opacity-70">
            <legend className="px-1 text-sm font-semibold capitalize text-ink">{civilDateLabel(date)}</legend>
            {readonly ? <p className="mb-2 text-xs text-ink-muted">{date < today ? "Dia passado · somente leitura" : "Além do limite de 60 dias"}</p> : null}
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={dayIntervals.length > 0} onChange={(e) => { if (e.target.checked) addInterval(date); else { setIntervals(intervals.filter((item) => item.date !== date)); changed(); } }} />Disponível</label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={wholeDay} onChange={(e) => { setBlocks(e.target.checked ? [...blocks, { key: `${id}-block${sequence}`, date, startMinute: null, endMinute: null }] : blocks.filter((item) => item.date !== date || item.startMinute !== null)); setSequence(sequence + 1); changed(); }} />Bloquear dia</label>
              <span className="text-xs text-ink-muted">{wholeDay ? "Bloqueado" : dayIntervals.length ? "Intervalos publicados ao salvar" : "Sem horários"}</span>
            </div>
            <div className="flex flex-col gap-3">
              {dayIntervals.map((item, index) => <div key={item.key} data-testid="week-interval" className="rounded-control bg-surface-muted/40 p-3">
                <p className="mb-2 text-xs font-medium text-ink-muted">Horário {index + 1}</p>
                <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4">
                  <div><Label htmlFor={`${item.key}-start`}>Início</Label><input id={`${item.key}-start`} className={FIELD} type="time" value={clock(item.startMinute)} onChange={(e) => update(item.key, { startMinute: clockToMinutes(e.target.value) ?? -1 })} /></div>
                  <div><Label htmlFor={`${item.key}-end`}>Fim</Label><input id={`${item.key}-end`} className={FIELD} type="time" value={clock(item.endMinute)} onChange={(e) => update(item.key, { endMinute: clockToMinutes(e.target.value, { isEnd: true }) ?? -1 })} /></div>
                  <div><Label htmlFor={`${item.key}-duration`}>Duração</Label><select id={`${item.key}-duration`} className={FIELD} value={item.slotMinutes} onChange={(e) => update(item.key, { slotMinutes: Number(e.target.value) as WeekInterval["slotMinutes"] })}>{SLOT_MINUTES.map((value) => <option key={value} value={value}>{value} min</option>)}</select></div>
                  <div><Label htmlFor={`${item.key}-modality`}>Modalidade</Label><select id={`${item.key}-modality`} className={FIELD} value={item.modality} onChange={(e) => update(item.key, { modality: e.target.value as WeekInterval["modality"] })}>{Object.entries(MODALITY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                </div>
                <Button className="mt-2" size="sm" variant="ghost" onClick={() => { setIntervals(intervals.filter((other) => other.key !== item.key)); changed(); }}>Remover intervalo</Button>
              </div>)}
              {dayBlocks.filter((item) => item.startMinute !== null).map((item) => <div key={item.key} data-testid="week-block" className="rounded-control border border-line p-3">
                <p className="mb-2 text-sm font-medium">Faixa bloqueada</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label htmlFor={`${item.key}-start`}>Bloqueio início</Label><input id={`${item.key}-start`} className={FIELD} type="time" value={clock(item.startMinute!)} onChange={(e) => { setBlocks(blocks.map((b) => b.key === item.key ? { ...b, startMinute: clockToMinutes(e.target.value) ?? -1 } : b)); changed(); }} /></div>
                  <div><Label htmlFor={`${item.key}-end`}>Bloqueio fim</Label><input id={`${item.key}-end`} className={FIELD} type="time" value={clock(item.endMinute!)} onChange={(e) => { setBlocks(blocks.map((b) => b.key === item.key ? { ...b, endMinute: clockToMinutes(e.target.value, { isEnd: true }) ?? -1 } : b)); changed(); }} /></div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setBlocks(blocks.filter((b) => b.key !== item.key)); changed(); }}>Remover bloqueio</Button>
              </div>)}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={intervals.length >= 28} onClick={() => addInterval(date)}>Adicionar horário</Button>
                <Button size="sm" variant="ghost" disabled={wholeDay || blocks.length >= 28} onClick={() => { setBlocks([...blocks, { key: `${id}-block${sequence}`, date, startMinute: 720, endMinute: 780 }]); setSequence(sequence + 1); changed(); }}>Bloquear faixa</Button>
              </div>
            </div>
          </fieldset>;
        })}
      </div>
      {error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}
      <Button className="mt-4 w-full sm:w-auto" disabled={busy || externalBusy || !verified || addCivilDays(initial.weekStart, 6) < today || (!dirty && initial.published)} onClick={() => void save()}>{busy ? "Salvando…" : "Salvar disponibilidade da semana"}</Button>
      </RequiresConnection>
    </CardContent>
  </Card>;
}
