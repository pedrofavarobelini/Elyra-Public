"use client";

import { Plus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  FLOW_LABEL,
  FLOW_LEVELS,
  SEVERITIES,
  cycleDailyRecordInputSchema,
  type CycleDailyRecord,
  type CycleSymptom,
  type Flow,
  type Severity,
} from "@/lib/contracts/cycle";
import { fromISODate } from "@/lib/cycle";
import { cn } from "@/lib/utils";

const SEVERITY_LABEL: Record<Severity, string> = {
  leve: "Leve",
  moderada: "Moderada",
  intensa: "Intensa",
};

/**
 * Registro de dados do ciclo para uma data.
 *
 * Um registro por usuario/data: salvar sobre uma data ja registrada e edicao,
 * nao um segundo registro. Fluxo aceita "Sem registro" como escolha explicita -
 * ausencia de registro nao e ausencia de fluxo, e nenhuma das duas e zero.
 */
interface RecordDialogProps {
  open: boolean;
  date: string;
  record: CycleDailyRecord | null;
  symptoms: CycleSymptom[];
  onClose: () => void;
  onSave: (input: {
    date: string;
    flow: Flow | null;
    symptoms: Array<{ symptomId: string; severity: Severity }>;
    note: string | null;
  }) => Promise<CycleDailyRecord>;
  onCreateSymptom: (label: string) => Promise<CycleSymptom>;
}

/**
 * O formulario e **remontado** por `key` sempre que a data muda.
 *
 * Sincronizar props com estado dentro de um efeito produziria render em cascata
 * (react-hooks/set-state-in-effect) e um quadro intermediario com os dados do
 * dia anterior. Remontar e a forma recomendada de reiniciar estado local.
 */
export function CycleRecordDialog(props: RecordDialogProps) {
  const { open, date, record, onClose } = props;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        {open ? (
          <RecordForm key={`${date}:${record?.id ?? "novo"}`} {...props} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RecordForm({
  date,
  record,
  symptoms,
  onClose,
  onSave,
  onCreateSymptom,
}: RecordDialogProps) {
  const [flow, setFlow] = useState<Flow | null>(record?.flow ?? null);
  const [selected, setSelected] = useState<Record<string, Severity>>(() =>
    Object.fromEntries(
      (record?.symptoms ?? []).map((s) => [s.symptomId, s.severity]),
    ),
  );
  const [note, setNote] = useState(record?.note ?? "");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggleSymptom = (id: string) =>
    setSelected((prev) => {
      if (prev[id]) {
        const next = { ...prev };
        delete next[id];
        return next;
      }
      return { ...prev, [id]: "moderada" };
    });

  const submit = async () => {
    const payload = {
      date,
      flow,
      symptoms: Object.entries(selected).map(([symptomId, severity]) => ({
        symptomId,
        severity,
      })),
      note: note.trim() === "" ? null : note.trim(),
    };

    const parsed = cycleDailyRecordInputSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Registro inválido.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await onSave(parsed.data);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível salvar o registro.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <DialogHeader>
          <DialogTitle>Registrar dados do ciclo</DialogTitle>
          <DialogDescription>
            {fromISODate(date).toLocaleDateString("pt-BR", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">
              Intensidade do fluxo
            </legend>
            <div className="flex flex-wrap gap-2">
              <Chip
                active={flow === null}
                onClick={() => setFlow(null)}
                label="Sem registro"
              />
              {FLOW_LEVELS.map((level) => (
                <Chip
                  key={level}
                  active={flow === level}
                  onClick={() => setFlow(level)}
                  label={FLOW_LABEL[level]}
                />
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink">
              Sintomas
            </legend>
            <ul className="flex flex-col gap-2">
              {symptoms.map((symptom) => {
                const severity = selected[symptom.id];
                return (
                  <li
                    key={symptom.id}
                    className="flex flex-wrap items-center justify-between gap-2"
                  >
                    <Chip
                      active={Boolean(severity)}
                      onClick={() => toggleSymptom(symptom.id)}
                      label={symptom.label}
                      suffix={symptom.origin === "custom" ? "seu" : undefined}
                    />
                    {severity ? (
                      <div className="flex gap-1">
                        {SEVERITIES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            aria-pressed={severity === s}
                            onClick={() =>
                              setSelected((prev) => ({
                                ...prev,
                                [symptom.id]: s,
                              }))
                            }
                            className={cn(
                              "rounded-control px-2 py-1 text-xs transition-colors",
                              severity === s
                                ? "bg-cycle-soft font-medium text-cycle"
                                : "text-ink-subtle hover:bg-surface-muted",
                            )}
                          >
                            {SEVERITY_LABEL[s]}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            <div className="mt-3 flex items-center gap-2">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Criar sintoma próprio"
                aria-label="Criar sintoma próprio"
                maxLength={40}
                className="max-w-xs"
              />
              <button
                type="button"
                aria-label="Adicionar sintoma"
                disabled={!draft.trim() || busy}
                onClick={() => {
                  setBusy(true);
                  setError(null);
                  void onCreateSymptom(draft.trim())
                    .then((created) => {
                      setSelected((prev) => ({
                        ...prev,
                        [created.id]: "moderada",
                      }));
                      setDraft("");
                    })
                    .catch((caught) => {
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "Não foi possível criar o sintoma.",
                      );
                    })
                    .finally(() => setBusy(false));
                }}
                className="flex size-10 items-center justify-center rounded-control border border-line-strong text-ink-muted transition-colors hover:bg-surface-muted disabled:opacity-40"
              >
                <Plus className="size-4" aria-hidden="true" />
              </button>
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cycle-note">Observação</Label>
            <Textarea
              id="cycle-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Opcional"
              maxLength={500}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

      <DialogFooter>
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? "Salvando..." : "Salvar registro"}
        </Button>
      </DialogFooter>
    </>
  );
}

function Chip({
  active,
  onClick,
  label,
  suffix,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  suffix?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-pill border px-3 py-1.5 text-sm transition-colors",
        active
          ? "border-cycle bg-cycle-soft text-cycle"
          : "border-line-strong bg-surface text-ink-muted hover:bg-surface-muted",
      )}
    >
      {label}
      {suffix ? (
        <span className="ml-1.5 text-2xs text-ink-subtle">{suffix}</span>
      ) : null}
    </button>
  );
}
