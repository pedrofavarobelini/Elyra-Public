"use client";

import {
  BookOpen,
  CheckCircle2,
  Flame,
  Footprints,
  Gauge,
  Leaf,
  Moon,
  Pencil,
  Plus,
  Repeat,
  Target,
} from "lucide-react";
import { useRef, useState, type CSSProperties } from "react";

import { PageHeader } from "@/components/journey/page-header";
import { HISTORY_DOMAINS, OlderHistoryNotice } from "@/components/journey/older-history";
import { EmptyState } from "@/components/states";
import { PendingSyncBadge } from "@/components/offline/pending-sync-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  canEditGoal,
  currentStreak,
  goalEditSchema,
  goalInputSchema,
  GOAL_STATUS_LABEL,
  progressInPeriod,
  type Goal,
  type GoalKind,
  type Recurrence,
} from "@/lib/contracts/goals";
import { cn } from "@/lib/utils";
import { GoalEditConflictError, useMockStore } from "@/mocks/store";

const STATUS_TONE: Record<
  Goal["status"],
  "positive" | "brand" | "neutral" | "destructive"
> = {
  active: "brand",
  completed: "positive",
  paused: "neutral",
  cancelled: "destructive",
};

export function GoalsView() {
  const { goals, goalProgress, addGoal, addGoalProgress, setGoalStatus, editGoal } =
    useMockStore();
  const titleRef = useRef<HTMLInputElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const startCustom = () => {
    setTitle("");
    setKind("frequency");
    setRecurrence("weekly");
    setTarget("3");
    setUnit("");
    setError(null);
    titleRef.current?.focus();
    titleRef.current?.scrollIntoView({ block: "center" });
  };

  // "Outra configuracao" na edicao: preenche o formulario de NOVA meta; a atual fica intacta.
  const startFrom = (goal: Goal) => {
    setTitle(goal.title);
    setKind(goal.kind);
    setRecurrence(goal.recurrence);
    setTarget(String(goal.target));
    setUnit(goal.unit ?? "");
    setError(null);
    setEditingId(null);
    titleRef.current?.focus();
    titleRef.current?.scrollIntoView({ block: "center" });
  };

  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<GoalKind>("frequency");
  const [recurrence, setRecurrence] = useState<Recurrence>("weekly");
  const [target, setTarget] = useState("5");
  const [unit, setUnit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyGoalId, setBusyGoalId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const parsed = goalInputSchema.safeParse({
      title: title.trim(),
      kind,
      recurrence,
      target: Number(target),
      unit: kind === "quantitative" && unit.trim() !== "" ? unit.trim() : null,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Meta inválida.");
      return;
    }

    setCreating(true);
    try {
      await addGoal(parsed.data);
      setTitle("");
      setUnit("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível criar a meta.",
      );
    } finally {
      setCreating(false);
    }
  };

  const runGoalAction = async (goalId: string, action: () => Promise<unknown>) => {
    setBusyGoalId(goalId);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível atualizar a meta.",
      );
    } finally {
      setBusyGoalId(null);
    }
  };

  const counts = {
    active: goals.filter((goal) => goal.status === "active").length,
    completed: goals.filter((goal) => goal.status === "completed").length,
    paused: goals.filter((goal) => goal.status === "paused").length,
  };
  const bestStreak = goals.reduce(
    (best, goal) => Math.max(best, currentStreak(goalProgress, goal.id)),
    0,
  );
  const visible =
    statusFilter === "all"
      ? goals
      : goals.filter((goal) => goal.status === statusFilter);

  return (
    <>
      <PageHeader
        title="Metas"
        description="Progresso e streak são calculados a partir dos seus registros, nunca de um contador."
      />

      <OlderHistoryNotice domains={HISTORY_DOMAINS.goals} />

      {/* Resumo: tres leituras derivadas das mesmas funcoes dos cards. */}
      <section
        aria-label="Resumo das metas"
        className="mb-5 grid grid-cols-3 gap-3"
      >
        {[
          { label: "Ativas", value: counts.active, icon: Target, tone: "brand" as const },
          { label: "Concluídas", value: counts.completed, icon: CheckCircle2, tone: "positive" as const },
          { label: "Maior sequência", value: bestStreak, icon: Flame, tone: "attention" as const, suffix: bestStreak === 1 ? "dia" : "dias" },
        ].map(({ label, value, icon: Icon, tone, suffix }) => (
          <div
            key={label}
            className="flex flex-col gap-2 rounded-card border border-line bg-surface p-3.5 shadow-card sm:flex-row sm:items-center sm:gap-3 sm:p-4"
          >
            <IconPill tone={tone}>
              <Icon />
            </IconPill>
            <div className="min-w-0">
              <p className="text-xs text-ink-muted sm:text-sm">{label}</p>
              <p className="text-xl font-semibold tabular-nums text-ink sm:text-2xl">
                {value}
                {suffix ? (
                  <span className="ml-1 text-sm font-normal text-ink-muted">{suffix}</span>
                ) : null}
              </p>
            </div>
          </div>
        ))}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(20rem,1fr)] 2xl:grid-cols-[minmax(0,1.9fr)_minmax(24rem,1fr)]">
        <section aria-labelledby="lista-metas" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 id="lista-metas" className="text-base font-semibold text-ink lg:text-lg">
              Suas metas
            </h2>
            {/*
              R2 (homologacao fisica): a faixa com `overflow-x-auto` mostrava
              barra de rolagem no Android. Os quatro status cabem em quatro
              colunas iguais a partir de 360px; nada rola e nada corta.
            */}
            <div
              role="group"
              aria-label="Filtrar metas por status"
              className="grid w-full grid-cols-4 gap-1 rounded-control bg-surface-muted p-1 sm:inline-flex sm:w-auto"
            >
              {STATUS_FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={statusFilter === value}
                  onClick={() => setStatusFilter(value)}
                  className={cn(
                    "motion-press min-h-11 min-w-0 whitespace-nowrap rounded-[0.625rem] px-1 text-[0.8125rem] font-medium transition-colors duration-150 sm:px-3 sm:text-sm lg:min-h-10",
                    statusFilter === value
                      ? "bg-surface text-brand-700 shadow-card"
                      : "text-ink-muted hover:text-ink",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {goals.length === 0 ? (
            <Card>
              <EmptyState
                title="Nenhuma meta criada"
                description="Comece por um modelo ao lado ou crie a sua. O progresso vem dos registros que você fizer."
                icon={<Target />}
              />
            </Card>
          ) : visible.length === 0 ? (
            <Card>
              <EmptyState
                title="Nenhuma meta neste status"
                description="Troque o filtro para ver as demais."
                icon={<Target />}
              />
            </Card>
          ) : (
            <ul className="grid gap-3 xl:grid-cols-2">
              {visible.map((goal) => {
                const done = progressInPeriod(goalProgress, goal);
                const streak = currentStreak(goalProgress, goal.id);
                const pct = Math.min(100, Math.round((done / goal.target) * 100));
                const KindIcon = goal.kind === "frequency" ? Repeat : Gauge;

                return (
                  <li key={goal.id}>
                    <Card className="flex h-full flex-col p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <IconPill tone={goal.status === "completed" ? "positive" : "brand"}>
                            <KindIcon />
                          </IconPill>
                          <div className="min-w-0">
                            <h3 className="font-semibold text-ink">{goal.title}</h3>
                            <PendingSyncBadge entityId={goal.id} />
                            <p className="mt-0.5 text-sm text-ink-muted">
                              {goal.kind === "frequency"
                                ? "Frequência"
                                : "Quantitativa"}
                              {" · "}
                              {goal.recurrence === "daily" ? "Diária" : "Semanal"}
                            </p>
                          </div>
                        </div>
                        <GoalStatusBadge status={goal.status} />
                      </div>

                      <div className="mt-4">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-ink-muted">Progresso</span>
                          <span
                            className="font-medium tabular-nums text-ink"
                            data-testid={`progress-${goal.id}`}
                          >
                            {done} de {goal.target}
                            {goal.unit ? ` ${goal.unit}` : ""}
                          </span>
                        </div>
                        <div
                          className="mt-2 h-2.5 overflow-hidden rounded-pill bg-surface-sunken"
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label={`Progresso de ${goal.title}`}
                        >
                          <div
                            className={cn(
                              "motion-progress h-full w-full rounded-pill",
                              pct >= 100 ? "bg-positive" : "bg-brand-500",
                            )}
                            style={{ "--progress": pct / 100 } as CSSProperties}
                          />
                        </div>
                      </div>

                      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-4">
                        <span
                          className={cn(
                            "flex items-center gap-1.5 text-sm",
                            streak > 0 ? "text-attention" : "text-ink-subtle",
                          )}
                          data-testid={`streak-${goal.id}`}
                        >
                          <Flame className="size-4" aria-hidden="true" />
                          {streak === 0
                            ? "Sem sequência"
                            : `${streak} ${streak === 1 ? "dia" : "dias"} seguidos`}
                        </span>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="soft"
                            disabled={goal.status !== "active" || busyGoalId === goal.id}
                            onClick={() =>
                              void runGoalAction(goal.id, () =>
                                addGoalProgress(
                                  goal.id,
                                  goal.kind === "frequency" ? 1 : goal.target,
                                ),
                              )
                            }
                          >
                            Registrar
                          </Button>
                          {goal.status === "active" || goal.status === "paused" ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyGoalId === goal.id}
                              onClick={() =>
                                void runGoalAction(goal.id, () =>
                                  setGoalStatus(
                                    goal.id,
                                    goal.status === "paused" ? "active" : "paused",
                                  ),
                                )
                              }
                            >
                              {goal.status === "paused" ? "Retomar" : "Pausar"}
                            </Button>
                          ) : null}
                          {canEditGoal(goal.status) ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-expanded={editingId === goal.id}
                              aria-label={`Editar ${goal.title}`}
                              disabled={busyGoalId === goal.id}
                              onClick={() => setEditingId(editingId === goal.id ? null : goal.id)}
                            >
                              <Pencil aria-hidden="true" />
                              Editar
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {editingId === goal.id ? (
                        <GoalEditPanel
                          goal={goal}
                          busy={busyGoalId === goal.id}
                          onCancel={() => setEditingId(null)}
                          onSave={async (fields) => {
                            // Sem runGoalAction: o conflito (409) e tratado dentro do painel.
                            setBusyGoalId(goal.id);
                            try {
                              await editGoal({ id: goal.id, ...fields });
                              setEditingId(null);
                            } finally {
                              setBusyGoalId(null);
                            }
                          }}
                          onComplete={() =>
                            runGoalAction(goal.id, async () => {
                              await setGoalStatus(goal.id, "completed");
                              setEditingId(null);
                            })
                          }
                          onStartFrom={() => startFrom(goal)}
                        />
                      ) : null}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardContent>
            <h2 className="font-semibold text-ink lg:text-lg">Nova meta</h2>
            <p className="mt-0.5 text-sm text-ink-muted">
              Em cinco passos curtos. Use um modelo e ajuste, ou crie uma meta personalizada.
            </p>
            <StepLabel step={1} title="Modelo" className="mt-4" />

            {/*
              Modelos sao so atalhos de preenchimento: nao criam nada, nao vao ao
              servidor e nao sao lista (a jornada de metas localiza cards pelo
              item de lista).
            */}
            <div
              role="group"
              aria-label="Modelos de meta"
              className="mt-2 grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"
            >
              {GOAL_TEMPLATES.map((template) => (
                <button
                  key={template.title}
                  type="button"
                  onClick={() => {
                    setTitle(template.title);
                    setKind(template.kind);
                    setRecurrence(template.recurrence);
                    setTarget(String(template.target));
                    setUnit(template.unit ?? "");
                    setError(null);
                  }}
                  className="flex min-h-11 items-center gap-2.5 rounded-control border border-line bg-surface px-3 py-2 text-left text-sm transition-colors duration-150 hover:border-brand-200 hover:bg-surface-brand"
                >
                  <template.icon className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{template.title}</span>
                    <span className="block text-xs text-ink-subtle">{template.hint}</span>
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={startCustom}
                className="flex min-h-11 items-center gap-2.5 rounded-control border border-dashed border-brand-300 bg-surface px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-surface-brand min-[400px]:col-span-2 lg:col-span-1 xl:col-span-2"
              >
                <Plus className="size-4 shrink-0 text-brand-600" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block font-medium text-ink">Criar meta personalizada</span>
                  <span className="block text-xs text-ink-subtle">Você escolhe título, tipo, recorrência e alvo</span>
                </span>
              </button>
            </div>

            <form onSubmit={create} className="mt-5 flex flex-col gap-4 border-t border-line pt-5">
              <StepLabel step={2} title="Objetivo" />
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="g-title">Título</Label>
                <Input
                  id="g-title"
                  ref={titleRef}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Caminhar 30 minutos"
                  maxLength={80}
                />
              </div>

              <StepLabel step={3} title="Recorrência" />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="g-kind">Tipo</Label>
                  <select
                    id="g-kind"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as GoalKind)}
                    className="h-11 rounded-control border border-line-input bg-surface px-3 text-base text-ink lg:text-sm"
                  >
                    <option value="frequency">Frequência</option>
                    <option value="quantitative">Quantitativa</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="g-recurrence">Recorrência</Label>
                  <select
                    id="g-recurrence"
                    value={recurrence}
                    onChange={(e) => setRecurrence(e.target.value as Recurrence)}
                    className="h-11 rounded-control border border-line-input bg-surface px-3 text-base text-ink lg:text-sm"
                  >
                    <option value="daily">Diária</option>
                    <option value="weekly">Semanal</option>
                  </select>
                </div>
              </div>

              <StepLabel step={4} title="Alvo" />
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="g-target">Alvo</Label>
                  <Input
                    id="g-target"
                    type="number"
                    min={1}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                  />
                </div>
                {kind === "quantitative" ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="g-unit">Unidade</Label>
                    <Input
                      id="g-unit"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      placeholder="min"
                      maxLength={12}
                    />
                  </div>
                ) : null}
              </div>

              <StepLabel step={5} title="Confirmação" />
              {/*
                Resumo derivado do proprio formulario: a pessoa confirma lendo a
                meta em uma frase antes de criar. Nada e salvo antes do botao.
              */}
              <p
                aria-live="polite"
                className="rounded-control bg-surface-brand px-3 py-2.5 text-sm text-brand-800"
              >
                {title.trim() === ""
                  ? "Dê um título para ver o resumo da meta."
                  : `${title.trim()}: ${Number(target) > 0 ? target : "?"} ${
                      kind === "quantitative" ? unit.trim() || "unidades" : Number(target) === 1 ? "vez" : "vezes"
                    } por ${recurrence === "daily" ? "dia" : "semana"}.`}
              </p>
              {error ? (
                <p role="alert" className="rounded-control bg-destructive-soft px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <Button type="submit" className="w-full sm:w-auto sm:self-start" disabled={creating}>
                <Plus aria-hidden="true" />
                {creating ? "Criando..." : "Criar meta"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function StepLabel({
  step,
  title,
  className,
}: {
  step: number;
  title: string;
  className?: string;
}) {
  return (
    <p className={cn("flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle", className)}>
      <span
        aria-hidden="true"
        className="inline-flex size-5 items-center justify-center rounded-pill bg-brand-100 text-[0.75rem] font-semibold text-brand-700"
      >
        {step}
      </span>
      {title}
    </p>
  );
}

type StatusFilter = "all" | Goal["status"];

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "active", label: "Ativas" },
  { value: "paused", label: "Pausadas" },
  { value: "completed", label: "Concluídas" },
];


const GOAL_TEMPLATES: Array<{
  title: string;
  hint: string;
  icon: typeof Target;
  kind: GoalKind;
  recurrence: Recurrence;
  target: number;
  unit?: string;
}> = [
  { title: "Caminhar", hint: "150 min por semana", icon: Footprints, kind: "quantitative", recurrence: "weekly", target: 150, unit: "min" },
  { title: "Momento de pausa", hint: "10 min por dia", icon: Leaf, kind: "quantitative", recurrence: "daily", target: 10, unit: "min" },
  { title: "Ler", hint: "3 vezes por semana", icon: BookOpen, kind: "frequency", recurrence: "weekly", target: 3 },
  { title: "Dormir mais cedo", hint: "5 noites por semana", icon: Moon, kind: "frequency", recurrence: "weekly", target: 5 },
];


function GoalEditPanel({
  goal,
  busy,
  onCancel,
  onSave,
  onComplete,
  onStartFrom,
}: {
  goal: Goal;
  busy: boolean;
  onCancel: () => void;
  onSave: (fields: { title: string; target: number; unit: string | null }) => Promise<void>;
  onComplete: () => Promise<void>;
  onStartFrom: () => void;
}) {
  const [title, setTitle] = useState(goal.title);
  const [target, setTarget] = useState(String(goal.target));
  const [unit, setUnit] = useState(goal.unit ?? "");
  const [error, setError] = useState<string | null>(null);
  // OFF-2: o que a pessoa tinha digitado quando a meta mudou em outro aparelho.
  const [conflict, setConflict] = useState<{ title: string; target: number; unit: string | null } | null>(null);
  const [gone, setGone] = useState(false);
  const editable = !gone && canEditGoal(goal.status);
  const base = `edit-${goal.id}`;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = goalEditSchema.safeParse({
      id: goal.id,
      title: title.trim(),
      target: Number(target),
      unit: goal.kind === "quantitative" && unit.trim() !== "" ? unit.trim() : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Meta inválida.");
      return;
    }
    setError(null);
    const fields = { title: parsed.data.title, target: parsed.data.target, unit: parsed.data.unit };
    try {
      await onSave(fields);
      setConflict(null);
    } catch (caught) {
      if (caught instanceof GoalEditConflictError) {
        // Carrega a versao mais recente nos campos; nada e sobrescrito sem revisao.
        if (!caught.latest) {
          setGone(true);
          setConflict(fields);
          return;
        }
        setConflict(fields);
        setTitle(caught.latest.title);
        setTarget(String(caught.latest.target));
        setUnit(caught.latest.unit ?? "");
        return;
      }
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar a meta.");
    }
  };

  return (
    <form
      onSubmit={save}
      aria-label={`Editar meta ${goal.title}`}
      data-testid={`goal-edit-${goal.id}`}
      className="mt-4 flex flex-col gap-3 border-t border-line pt-4"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${base}-title`}>Título</Label>
        <Input id={`${base}-title`} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${base}-target`}>Alvo por {goal.recurrence === "daily" ? "dia" : "semana"}</Label>
          <Input id={`${base}-target`} type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        {goal.kind === "quantitative" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${base}-unit`}>Unidade</Label>
            <Input id={`${base}-unit`} value={unit} maxLength={12} onChange={(e) => setUnit(e.target.value)} />
          </div>
        ) : null}
      </div>
      <p className="text-xs text-ink-muted" data-testid="goal-edit-history-note">
        O que você já registrou continua como está. Um alvo novo vale a partir do período atual.
        Tipo ({goal.kind === "frequency" ? "frequência" : "quantitativa"}) e recorrência ({goal.recurrence === "daily" ? "diária" : "semanal"}) não mudam aqui, porque mudariam o sentido dos registros antigos.
      </p>
      {conflict ? (
        <div role="alert" data-testid="goal-edit-conflict" className="rounded-control bg-attention-soft px-3 py-2 text-sm text-ink">
          <p className="font-medium">
            {gone
              ? "Esta meta foi removida em outro dispositivo."
              : !canEditGoal(goal.status)
                ? "Esta meta foi concluída ou cancelada em outro dispositivo e não pode mais ser editada."
                : "Esta meta foi alterada em outro dispositivo."}
          </p>
          {editable ? <p>Carregamos a versão mais recente acima. Revise e salve de novo, se ainda quiser mudar.</p> : null}
          <p className="mt-1 text-xs text-ink-muted">
            Sua alteração não foi salva: “{conflict.title}”, alvo {conflict.target}
            {conflict.unit ? ` ${conflict.unit}` : ""}.
          </p>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-control bg-destructive-soft px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={busy || !editable}>
          Salvar alterações
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button type="button" size="sm" variant="soft" onClick={onStartFrom} disabled={busy}>
          Nova meta com outro tipo ou recorrência
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => void onComplete()} disabled={busy}>
          <CheckCircle2 aria-hidden="true" />
          Marcar como concluída
        </Button>
      </div>
    </form>
  );
}

/**
 * Selo de status com um unico retorno curto quando o status MUDA (pausar,
 * retomar, concluir) — MOTION-2. Na carga da pagina nada anima. Estado derivado
 * do render anterior (padrao do React), sem ref nem efeito.
 */
function GoalStatusBadge({ status }: { status: Goal["status"] }) {
  const [previous, setPrevious] = useState(status);
  const [changed, setChanged] = useState(false);
  if (status !== previous) {
    setPrevious(status);
    setChanged(true);
  }
  return (
    <Badge key={status} tone={STATUS_TONE[status]} className={changed ? "motion-pop" : undefined} data-status={status}>
      {GOAL_STATUS_LABEL[status]}
    </Badge>
  );
}
