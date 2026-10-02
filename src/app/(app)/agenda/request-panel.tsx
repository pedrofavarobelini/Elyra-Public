"use client";

import { CalendarSearch, ChevronLeft, ChevronRight, Clock3, UserRoundSearch } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";

import { schedulingFetch } from "@/components/scheduling/api";
import { useViewerTimezone } from "@/components/scheduling/appointment-list";
import { EmptyState, InlineLoading } from "@/components/states";
import { RequiresConnection } from "@/components/offline/requires-connection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  MODALITY_LABEL,
  SCHEDULING_LEAD_COPY,
  type Modality,
  type SchedulingProfessional,
  type Slot,
  type WeekSlots,
} from "@/lib/contracts/scheduling";
import {
  differsFromViewer,
  formatDayHeading,
  formatTime,
  groupByLocalDay,
  timezoneLabel,
} from "@/lib/scheduling/format";
import { cn } from "@/lib/utils";
import { addCivilDays, civilWeekLabel, civilWeekStart } from "@/lib/scheduling/calendar";
import { localDayKey } from "@/lib/scheduling/format";

const MAX_WINDOWS = 10; // Civil weeks; the database still clips offers at 60 days.
const SELECT =
  "mt-1.5 flex min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 lg:min-h-10";

function newKey() {
  return crypto.randomUUID();
}

/**
 * Pedir horario. A tela lista o que o banco ofereceu e envia o instante
 * escolhido; fim, fuso e disponibilidade sao conferidos de novo no servidor.
 *
 * Idempotencia: uma chave por **escolha**. Repetir o envio da mesma escolha
 * (duplo clique, falha de rede, outra aba com a mesma tela) reusa a chave e
 * o banco devolve o mesmo pedido; escolher outro horario gera chave nova.
 */
export function RequestPanel({
  now,
  professionals,
  preselectedConnectionId,
  onRequested,
}: {
  /** Instante da leitura no servidor: âncora das semanas civis. */
  now: string;
  professionals: SchedulingProfessional[];
  preselectedConnectionId: string | null;
  onRequested: (message: string) => void;
}) {
  const baseId = useId();
  const viewer = useViewerTimezone();
  const initial =
    professionals.find((item) => item.connectionId === preselectedConnectionId) ??
    professionals.find((item) => item.hasAvailability) ??
    professionals[0] ??
    null;
  const [connectionId, setConnectionId] = useState(initial?.connectionId ?? "");
  const professional = professionals.find((item) => item.connectionId === connectionId) ?? null;
  const [windowIndex, setWindowIndex] = useState(0);
  const [modality, setModality] = useState<Modality | "all">("all");
  const [selected, setSelected] = useState<Slot | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [result, setResult] = useState<{ key: string; slots: Slot[]; timezone: string; error: string | null } | null>(null);

  const calendarZone = result?.key.startsWith(professional?.professionalUserId ?? "none") ? result.timezone : "America/Sao_Paulo";
  const baseWeek = civilWeekStart(localDayKey(now, calendarZone));
  const weekStart = addCivilDays(baseWeek, windowIndex * 7);
  const requestKey = professional?.hasAvailability
    ? `${professional.professionalUserId}|${weekStart}|${reloads}`
    : null;

  // Busca so reage a chave; o estado so muda na resposta (sem setState sincrono).
  useEffect(() => {
    if (!requestKey || !professional) return;
    let cancelled = false;
    const params = new URLSearchParams({
      professional: professional.professionalUserId,
      week: weekStart,
    });
    schedulingFetch<WeekSlots>(`/api/scheduling/slots?${params.toString()}`).then(
      (data) => !cancelled && setResult({ key: requestKey, ...data, error: null }),
      (caught: unknown) =>
        !cancelled &&
        setResult({
          key: requestKey,
          slots: [],
          timezone: calendarZone,
          error: caught instanceof Error ? caught.message : "Não foi possível carregar os horários.",
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [requestKey, professional, weekStart, calendarZone]);

  const current = result && result.key === requestKey ? result : null;
  const slots = useMemo(
    () => (requestKey ? (current?.slots ?? null) : []),
    [requestKey, current],
  );
  const loadError = current?.error ?? null;
  const load = () => setReloads((value) => value + 1);

  const modalities = useMemo(
    () => [...new Set((slots ?? []).map((slot) => slot.modality))],
    [slots],
  );
  const visible = (slots ?? []).filter((slot) => modality === "all" || slot.modality === modality);
  const groups = groupByLocalDay(visible);

  function choose(slot: Slot) {
    const same = selected?.startsAt === slot.startsAt && selected.modality === slot.modality;
    setSelected(same ? null : slot);
    setIdempotencyKey(same ? null : newKey());
    setError(null);
  }

  async function submit() {
    if (!selected || !professional || !idempotencyKey) return;
    setBusy(true);
    setError(null);
    try {
      await schedulingFetch("/api/scheduling/appointments", {
        method: "POST",
        body: JSON.stringify({
          connectionId: professional.connectionId,
          startsAt: selected.startsAt,
          modality: selected.modality,
          idempotencyKey,
        }),
      });
      setSelected(null);
      setIdempotencyKey(null);
      onRequested("Pedido enviado. O horário fica reservado para você até a resposta do profissional.");
      load();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Não foi possível pedir o horário.";
      setError(message);
      // Horario tomado ou fora da grade: a lista local esta velha.
      if (/indisponível|agenda do profissional/.test(message)) {
        setSelected(null);
        setIdempotencyKey(null);
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  if (professionals.length === 0) {
    return (
      <Card data-testid="agenda-request">
        <CardHeader>
          <CardTitle as="h2">Pedir horário</CardTitle>
        </CardHeader>
        <CardContent>
          <EmptyState
            size="compact"
            icon={<UserRoundSearch />}
            title="Nenhum acompanhamento ativo com profissional verificado"
            description="A agenda funciona com quem já acompanha você. O vínculo começa por convite."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/profissionais">Encontrar profissional</Link>
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-testid="agenda-request">
      <CardHeader>
        <CardTitle as="h2">Escolha um horário</CardTitle>
        <CardDescription>
          Os horários livres vêm da agenda do profissional. O pedido fica reservado para você até a
          confirmação ou a recusa.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <RequiresConnection note="Sem conexão: pedir horário precisa de internet. Nenhum pedido foi enviado.">
        {professionals.length > 1 ? (
          <div>
            <Label htmlFor={`${baseId}-pro`}>Profissional</Label>
            <select
              id={`${baseId}-pro`}
              className={SELECT}
              value={connectionId}
              onChange={(event) => {
                setConnectionId(event.target.value);
                setWindowIndex(0);
                setSelected(null);
                setIdempotencyKey(null);
                setModality("all");
              }}
            >
              {professionals.map((item) => (
                <option key={item.connectionId} value={item.connectionId}>
                  {item.professionalName ?? "Profissional"}
                  {item.hasAvailability ? "" : " (sem horários abertos)"}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <p className="text-sm text-ink">
            Com <span className="font-medium">{professional?.professionalName ?? "seu profissional"}</span>
          </p>
        )}

        {!professional?.hasAvailability ? (
          <EmptyState
            size="compact"
            icon={<CalendarSearch />}
            title="Este profissional ainda não abriu horários"
            description="Quando houver intervalos na agenda dele, os horários livres aparecem aqui."
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-muted" aria-live="polite">
                Semana {civilWeekLabel(weekStart)} · {timezoneLabel(calendarZone)}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Semana anterior"
                  disabled={windowIndex === 0 || slots === null}
                  onClick={() => { setWindowIndex((value) => value - 1); setSelected(null); setIdempotencyKey(null); }}
                >
                  <ChevronLeft aria-hidden="true" />
                  Anteriores
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="Próxima semana"
                  disabled={windowIndex >= MAX_WINDOWS - 1 || addCivilDays(weekStart, 7) > addCivilDays(localDayKey(now, calendarZone), 60) || slots === null}
                  onClick={() => { setWindowIndex((value) => value + 1); setSelected(null); setIdempotencyKey(null); }}
                >
                  Próximas
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </div>

            <p className="flex gap-2 text-xs leading-5 text-ink-muted" data-testid="agenda-lead">
              <Clock3 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {SCHEDULING_LEAD_COPY}
            </p>

            {modalities.length > 1 ? (
              <fieldset className="flex flex-wrap gap-2">
                <legend className="sr-only">Modalidade</legend>
                {(["all", ...modalities] as const).map((option) => (
                  <label
                    key={option}
                    className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-pill border border-line px-3 text-sm text-ink has-[:checked]:border-brand-400 has-[:checked]:bg-surface-brand has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-400 lg:min-h-9"
                  >
                    <input
                      type="radio"
                      name={`${baseId}-mode`}
                      className="sr-only"
                      checked={modality === option}
                      onChange={() => {
                        setModality(option);
                        setSelected(null);
                        setIdempotencyKey(null);
                      }}
                    />
                    {option === "all" ? "Todas" : MODALITY_LABEL[option]}
                  </label>
                ))}
              </fieldset>
            ) : null}

            {slots === null ? (
              <InlineLoading>Carregando horários livres…</InlineLoading>
            ) : loadError ? (
              <div className="flex flex-wrap items-center gap-3">
                <p role="alert" className="text-sm text-destructive">
                  {loadError}
                </p>
                <Button size="sm" variant="secondary" onClick={load}>
                  Tentar de novo
                </Button>
              </div>
            ) : groups.length === 0 ? (
              <EmptyState
                size="compact"
                icon={<CalendarSearch />}
                title="Nenhum horário livre neste período"
                description={
                  windowIndex < MAX_WINDOWS - 1
                    ? "Veja as próximas semanas ou volte mais tarde."
                    : "A agenda aceita pedidos até 60 dias à frente."
                }
              />
            ) : (

              <div
                className="grid max-h-[32rem] gap-3 overflow-y-auto pr-1 sm:grid-cols-2 xl:grid-cols-3"
                data-testid="agenda-slots"
              >
                {groups.map((group) => (
                  <section
                    key={group.key}
                    aria-label={group.heading}
                    className="rounded-control border border-line bg-surface-muted/40 p-3"
                  >
                    <h3 className="mb-2 text-sm font-semibold text-ink">{group.heading}</h3>
                    <ul className="flex flex-wrap gap-2">
                      {group.items.map((slot) => {
                        const isSelected =
                          selected?.startsAt === slot.startsAt && selected.modality === slot.modality;
                        return (
                          <li key={`${slot.startsAt}-${slot.modality}`}>
                            <button
                              type="button"
                              aria-pressed={isSelected}
                              aria-label={`${group.heading}, ${formatTime(slot.startsAt, slot.timezone)}, ${MODALITY_LABEL[slot.modality]}, ${timezoneLabel(slot.timezone)}`}
                              onClick={() => choose(slot)}
                              className={cn(
                                "inline-flex min-h-11 flex-col items-start justify-center rounded-control border px-3 text-left text-sm tabular-nums transition-colors lg:min-h-10",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
                                isSelected
                                  ? "border-brand-600 bg-brand-600 text-white"
                                  : "border-line bg-surface text-ink hover:border-brand-300 hover:bg-surface-brand",
                              )}
                            >
                              <span className="font-semibold">{formatTime(slot.startsAt, slot.timezone)}</span>
                              {modalities.length > 1 && modality === "all" ? (
                                <span className={cn("text-xs", isSelected ? "text-white/85" : "text-ink-muted")}>
                                  {MODALITY_LABEL[slot.modality]}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
              </div>
            )}

            <div className="rounded-control border border-line bg-surface-muted/60 p-3" aria-live="polite">
              {selected ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="mr-auto min-w-0 text-sm">
                    <p className="font-medium text-ink">
                      <span>{formatDayHeading(selected.startsAt, selected.timezone)}</span>, às{" "}
                      {formatTime(selected.startsAt, selected.timezone)} ({MODALITY_LABEL[selected.modality]})
                    </p>
                    <p className="text-ink-muted">
                      {timezoneLabel(selected.timezone)}
                      {differsFromViewer(selected.startsAt, selected.timezone, viewer) && viewer
                        ? ` · no seu fuso: ${formatTime(selected.startsAt, viewer)}`
                        : ""}
                    </p>
                  </div>
                  <Button onClick={() => void submit()} disabled={busy}>
                    {busy ? "Enviando…" : "Pedir este horário"}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-ink-muted">Escolha um horário da lista para pedir.</p>
              )}
              {error ? (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
          </>
        )}
        </RequiresConnection>
      </CardContent>
    </Card>
  );
}
