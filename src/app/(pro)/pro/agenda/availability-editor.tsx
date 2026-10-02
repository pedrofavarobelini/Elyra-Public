"use client";

import { CalendarPlus, Trash2 } from "lucide-react";
import { useId, useMemo, useState, useSyncExternalStore } from "react";

import { schedulingFetch } from "@/components/scheduling/api";
import { useViewerTimezone } from "@/components/scheduling/appointment-list";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  MAX_AVAILABILITY_RULES,
  MODALITIES,
  MODALITY_LABEL,
  SLOT_MINUTES,
  WEEKDAY_LABEL,
  availabilityInputSchema,
  findOverlappingRule,
  type Availability,
  type AvailabilityRule,
} from "@/lib/contracts/scheduling";
import {
  clockToMinutes,
  describeRule,
  minutesToClock,
  runtimeTimezones,
  timezoneLabel,
} from "@/lib/scheduling/format";

const noSubscription = () => () => {};
const SERVER_ZONES: string[] = [];

const FIELD =
  "flex min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-60 lg:min-h-10";

/** Linha editavel: relogio em texto para o `<input type="time">`. */
type Draft = { key: string; weekday: number; start: string; end: string; slotMinutes: number; modality: string };

// Chave estavel entre servidor e navegador: posicao na carga, ou contador local
// para linhas criadas depois da hidratacao.
function toDraft(rule: AvailabilityRule, key: string): Draft {
  return {
    key,
    weekday: rule.weekday,
    start: minutesToClock(rule.startMinute),
    end: rule.endMinute === 1440 ? "00:00" : minutesToClock(rule.endMinute),
    slotMinutes: rule.slotMinutes,
    modality: rule.modality,
  };
}

export function AvailabilityEditor({
  initial,
  verified,
  onSaved,
}: {
  initial: Availability;
  verified: boolean;
  /** Depois de salvar: a previa de horarios e recalculada pelo servidor. */
  onSaved?: () => void;
}) {
  const baseId = useId();
  const viewerTz = useViewerTimezone();
  // `null` = a pessoa ainda nao escolheu: vale o fuso salvo, senao o do navegador.
  const [chosenTz, setTimezone] = useState<string | null>(null);
  const timezone = chosenTz ?? initial.timezone ?? viewerTz ?? "America/Sao_Paulo";
  const runtimeZones = useSyncExternalStore(noSubscription, runtimeTimezones, () => SERVER_ZONES);
  const zones = useMemo(
    () => [...new Set([timezone, ...(initial.timezone ? [initial.timezone] : []), ...runtimeZones])],
    [timezone, initial.timezone, runtimeZones],
  );
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initial.rules.map((rule, index) => toDraft(rule, `${baseId}-r${index}`)),
  );
  const [seq, setSeq] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const parsed = useMemo(() => {
    const rules = drafts.map((draft) => ({
      weekday: draft.weekday,
      startMinute: clockToMinutes(draft.start) ?? -1,
      endMinute: clockToMinutes(draft.end, { isEnd: true }) ?? -1,
      slotMinutes: draft.slotMinutes,
      modality: draft.modality,
    }));
    return availabilityInputSchema.safeParse({ timezone, rules });
  }, [drafts, timezone]);

  const overlapIndex = parsed.success ? findOverlappingRule(parsed.data.rules) : null;

  function update(key: string, patch: Partial<Draft>) {
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
    setMessage(null);
  }

  function add() {
    setSeq((value) => value + 1);
    setDrafts((current) => [
      ...current,
      toDraft(
        { weekday: 1, startMinute: 540, endMinute: 720, slotMinutes: 60, modality: "online" },
        `${baseId}-n${seq}`,
      ),
    ]);
    setMessage(null);
  }

  async function save() {
    if (!parsed.success) {
      setMessage({ kind: "error", text: parsed.error.issues[0]?.message ?? "Revise os intervalos." });
      return;
    }
    if (overlapIndex !== null) {
      setMessage({ kind: "error", text: "Dois intervalos se sobrepõem no mesmo dia." });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const saved = await schedulingFetch<Availability>("/api/scheduling/availability", {
        method: "PUT",
        body: JSON.stringify(parsed.data),
      });
      setSeq((value) => value + 1);
      setDrafts(saved.rules.map((rule, index) => toDraft(rule, `${baseId}-s${seq}-${index}`)));
      setMessage({
        kind: "ok",
        text:
          saved.rules.length === 0
            ? "Disponibilidade salva: nenhum horário aberto."
            : `Disponibilidade salva: ${saved.rules.length} intervalo(s) no ${timezoneLabel(timezone)}.`,
      });
      onSaved?.();
    } catch (caught) {
      setMessage({ kind: "error", text: caught instanceof Error ? caught.message : "Não foi possível salvar." });
    } finally {
      setBusy(false);
    }
  }

  // Sem reordenar durante a edicao: a linha nao pode fugir do foco de quem digita.
  // A ordem por dia vem do servidor depois de salvar.
  const sorted = drafts;
  const disabled = !verified || busy;

  return (
    <Card id="disponibilidade" className="scroll-mt-20" data-testid="availability-editor">
      <CardHeader>
        <CardTitle as="h2">Semana recorrente</CardTitle>
        <CardDescription>
          Intervalos que se repetem toda semana. As pessoas que você acompanha pedem horário dentro
          deles; o pedido só vira confirmado depois da sua resposta.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!verified ? (
          <p className="rounded-control bg-attention-soft px-3 py-2 text-sm text-attention">
            Abrir horários exige verificação vigente do seu registro.
          </p>
        ) : null}
        <div className="max-w-md">
          <Label htmlFor={`${baseId}-tz`}>Fuso horário da agenda</Label>
          <select
            id={`${baseId}-tz`}
            value={timezone}
            disabled={disabled}
            onChange={(event) => {
              setTimezone(event.target.value);
              setMessage(null);
            }}
            className={`mt-1.5 ${FIELD}`}
            aria-describedby={`${baseId}-tz-help`}
          >
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <p id={`${baseId}-tz-help`} className="mt-1 text-xs text-ink-muted">
            Os horários são oferecidos e mostrados neste fuso, com horário de verão quando houver.
            Fim 00:00 significa meia-noite, o fim do dia.
          </p>
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            size="compact"
            icon={<CalendarPlus />}
            title="Nenhum intervalo aberto"
            description="Sem intervalo, ninguém consegue pedir horário com você."
          />
        ) : (
          <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3" aria-label="Intervalos da semana">
            {sorted.map((draft) => {
              const index = drafts.findIndex((item) => item.key === draft.key);
              const overlaps = overlapIndex === index;
              return (
                <li
                  key={draft.key}
                  className="grid grid-cols-2 gap-2 rounded-control border border-line p-3 [&_input]:min-w-0 [&_select]:min-w-0"
                  data-invalid={overlaps || undefined}
                >
                  <div>
                    <Label htmlFor={`${draft.key}-day`}>Dia</Label>
                    <select
                      id={`${draft.key}-day`}
                      value={draft.weekday}
                      disabled={disabled}
                      onChange={(event) => update(draft.key, { weekday: Number(event.target.value) })}
                      className={`mt-1 ${FIELD}`}
                    >
                      {WEEKDAY_LABEL.map((label, weekday) => (
                        <option key={label} value={weekday}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={disabled}
                      onClick={() => setDrafts((current) => current.filter((item) => item.key !== draft.key))}
                      aria-label={`Remover intervalo de ${WEEKDAY_LABEL[draft.weekday]}, ${draft.start} a ${draft.end}`}
                    >
                      <Trash2 aria-hidden="true" />
                      Remover
                    </Button>
                  </div>
                  <div>
                    <Label htmlFor={`${draft.key}-start`}>Início</Label>
                    <input
                      id={`${draft.key}-start`}
                      type="time"
                      step={300}
                      value={draft.start}
                      disabled={disabled}
                      onChange={(event) => update(draft.key, { start: event.target.value })}
                      className={`mt-1 ${FIELD}`}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${draft.key}-end`}>Fim</Label>
                    <input
                      id={`${draft.key}-end`}
                      type="time"
                      step={300}
                      value={draft.end}
                      disabled={disabled}
                      onChange={(event) => update(draft.key, { end: event.target.value })}
                      className={`mt-1 ${FIELD}`}
                    />
                  </div>
                  <div>
                    <Label htmlFor={`${draft.key}-slot`}>Duração</Label>
                    <select
                      id={`${draft.key}-slot`}
                      value={draft.slotMinutes}
                      disabled={disabled}
                      onChange={(event) => update(draft.key, { slotMinutes: Number(event.target.value) })}
                      className={`mt-1 ${FIELD}`}
                    >
                      {SLOT_MINUTES.map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes} min
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`${draft.key}-mode`}>Modalidade</Label>
                    <select
                      id={`${draft.key}-mode`}
                      value={draft.modality}
                      disabled={disabled}
                      onChange={(event) => update(draft.key, { modality: event.target.value })}
                      className={`mt-1 ${FIELD}`}
                    >
                      {MODALITIES.map((modality) => (
                        <option key={modality} value={modality}>
                          {MODALITY_LABEL[modality]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <p className="col-span-2 text-xs text-ink-muted" data-rule-summary>
                    {(() => {
                      const start = clockToMinutes(draft.start);
                      const end = clockToMinutes(draft.end, { isEnd: true });
                      return start !== null && end !== null && end > start
                        ? describeRule(start, end, draft.slotMinutes)
                        : "Início e fim precisam formar um intervalo.";
                    })()}
                  </p>
                  {overlaps ? (
                    <p className="col-span-full text-sm text-destructive">
                      Este intervalo se sobrepõe a outro no mesmo dia.
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={add}
            disabled={disabled || drafts.length >= MAX_AVAILABILITY_RULES}
          >
            <CalendarPlus aria-hidden="true" />
            Adicionar intervalo
          </Button>
          <Button onClick={() => void save()} disabled={disabled}>
            {busy ? "Salvando…" : "Salvar disponibilidade"}
          </Button>
        </div>
        <div aria-live="polite">
          {message ? (
            <p
              role={message.kind === "error" ? "alert" : "status"}
              className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-positive"}
            >
              {message.text}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
