"use client";

import {
  Activity,
  Brain,
  Moon,
  Pencil,
  Smile,
  Trash2,
  Zap,
} from "lucide-react";

import { FlowScale, SeverityScale } from "@/components/cycle/scales";
import { Button } from "@/components/ui/button";
import type { CycleDailyRecord, CycleSymptom } from "@/lib/contracts/cycle";
import type { EmotionalCheckin, SleepRecord } from "@/lib/contracts/emotional";
import { PRIMARY_FEELING_LABEL } from "@/lib/contracts/emotional";
import { fromISODate } from "@/lib/cycle";
import { averageIgnoringNulls } from "@/lib/derive";
import { formatDuration, formatScore } from "@/lib/utils";

/**
 * Painel do dia selecionado no calendario (figura 3).
 *
 * Fronteira de dominio importante: humor, ansiedade percebida, energia e sono
 * aparecem aqui, mas **nao pertencem ao ciclo**. Eles sao lidos de
 * `emotional_checkins` e `sleep_records` e apenas exibidos lado a lado. O ciclo
 * nao duplica essas metricas - se duplicasse, existiriam duas verdades para o
 * mesmo dia.
 */

export interface DayPanelProps {
  date: string;
  record: CycleDailyRecord | null;
  symptoms: CycleSymptom[];
  periodStart: string | null;
  periodEnd: string | null;
  flowDays: number | null;
  checkins: EmotionalCheckin[];
  sleep: SleepRecord | null;
  onEdit: () => void;
  onDelete: () => void;
}

export function DayPanel({
  date,
  record,
  symptoms,
  periodStart,
  periodEnd,
  flowDays,
  checkins,
  sleep,
  onEdit,
  onDelete,
}: DayPanelProps) {
  const symptomLabel = (id: string) =>
    symptoms.find((s) => s.id === id)?.label ?? "Sintoma removido";

  const mood = averageIgnoringNulls(checkins.map((c) => c.mood));
  const anxiety = averageIgnoringNulls(checkins.map((c) => c.perceivedAnxiety));
  const energy = averageIgnoringNulls(checkins.map((c) => c.energy));
  const feeling = checkins.find((c) => c.primaryFeeling !== null)?.primaryFeeling;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold text-ink">
        {fromISODate(date).toLocaleDateString("pt-BR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
      </h2>

      <section aria-labelledby="dp-menstruacao">
        <h3
          id="dp-menstruacao"
          className="mb-3 text-sm font-semibold text-ink"
        >
          Menstruação
        </h3>
        <dl className="flex flex-col gap-2 text-sm">
          <Row label="Início" value={periodStart} />
          <Row label="Fim" value={periodEnd} />
          <Row
            label="Dias de fluxo"
            value={flowDays === null ? null : String(flowDays)}
          />
          <div className="flex items-center justify-between gap-4">
            <dt className="text-ink-muted">Intensidade do fluxo</dt>
            <dd>
              <FlowScale value={record?.flow ?? null} />
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="dp-sintomas" className="border-t border-line pt-5">
        <h3 id="dp-sintomas" className="mb-3 text-sm font-semibold text-ink">
          Sintomas e bem-estar
        </h3>

        {record && record.symptoms.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {record.symptoms.map((s) => (
              <li
                key={s.symptomId}
                className="flex items-center justify-between gap-4"
              >
                <span className="flex items-center gap-2 text-sm text-ink">
                  <Activity
                    className="size-4 text-cycle"
                    aria-hidden="true"
                  />
                  {symptomLabel(s.symptomId)}
                </span>
                <SeverityScale value={s.severity} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-subtle">
            Nenhum sintoma registrado neste dia.
          </p>
        )}
      </section>

      {/* Metricas de outros dominios. Exibidas, nunca duplicadas. */}
      <section
        aria-labelledby="dp-outros"
        className="border-t border-line pt-5"
      >
        <h3 id="dp-outros" className="mb-1 text-sm font-semibold text-ink">
          Do seu dia
        </h3>
        <p className="mb-3 text-xs text-ink-subtle">
          Registros de sono e humor deste dia. Eles pertencem aos seus próprios
          registros, não ao ciclo.
        </p>

        <dl className="flex flex-col gap-3 text-sm">
          <Metric
            icon={<Moon className="size-4 text-metric-sleep" />}
            label="Sono"
            value={formatDuration(sleep?.durationMinutes ?? null)}
            hint={
              sleep?.quality === null || sleep?.quality === undefined
                ? undefined
                : `Qualidade ${formatScore(sleep.quality)}/10`
            }
          />
          <Metric
            icon={<Zap className="size-4 text-metric-energy" />}
            label="Energia"
            value={energy === null ? null : `${formatScore(energy)}/10`}
          />
          <Metric
            icon={<Smile className="size-4 text-attention" />}
            label="Humor"
            value={mood === null ? null : `${formatScore(mood)}/10`}
            hint={feeling ? PRIMARY_FEELING_LABEL[feeling] : undefined}
          />
          <Metric
            icon={<Brain className="size-4 text-metric-anxiety" />}
            label="Ansiedade percebida"
            value={anxiety === null ? null : `${formatScore(anxiety)}/10`}
          />
        </dl>
      </section>

      <section
        aria-labelledby="dp-observacao"
        className="border-t border-line pt-5"
      >
        <h3 id="dp-observacao" className="mb-2 text-sm font-semibold text-ink">
          Observação
        </h3>
        <p className="rounded-control bg-surface-muted p-3 text-sm text-ink-muted">
          {record?.note ?? "Sem observação para este dia."}
        </p>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:bg-destructive-soft hover:text-destructive"
          onClick={onDelete}
          disabled={record === null}
        >
          <Trash2 aria-hidden="true" />
          Excluir registros
        </Button>
        <Button variant="soft" size="sm" onClick={onEdit}>
          <Pencil aria-hidden="true" />
          {record ? "Editar registros" : "Registrar dados"}
        </Button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={value ? "text-ink" : "text-ink-subtle"}>
        {value ?? "—"}
      </dd>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="flex items-center gap-2 text-ink-muted">
        <span aria-hidden="true">{icon}</span>
        {label}
      </dt>
      <dd className="text-right">
        {value === null ? (
          <span className="text-ink-subtle">Sem registro</span>
        ) : (
          <>
            <span className="font-medium text-ink">{value}</span>
            {hint ? (
              <span className="ml-2 text-xs text-ink-subtle">{hint}</span>
            ) : null}
          </>
        )}
      </dd>
    </div>
  );
}
