"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";

import { ScoreSlider } from "@/components/journey/score-slider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { EmotionalCheckin } from "@/lib/contracts/emotional";
import { useMockStore } from "@/mocks/store";

/**
 * Corrige um check-in que ja aconteceu.
 *
 * A vida nao acontece na hora do formulario: quem registrou errado, ou registrou
 * pela metade, precisa poder consertar sem criar um segundo registro que
 * contradiz o primeiro.
 *
 * **A data nao e enviada.** Corrigir o humor de ontem nao pode mover o registro
 * para hoje - `occurredAt` fica de fora do payload, e a RPC preserva a data
 * original. Mover a data seria outra acao, e a pessoa teria de pedir.
 *
 * **Limpar continua sendo `null`.** O `ScoreSlider` devolve `null` quando a
 * pessoa escolhe deixar sem registro, e e `null` que vai ao banco - nunca `0`,
 * que afirmaria o pior valor possivel. A regra e a mesma de `VR-006`.
 */
export function EditCheckinDialog({ checkin }: { checkin: EmotionalCheckin }) {
  const [open, setOpen] = useState(false);
  const quando = new Date(checkin.occurredAt).toLocaleDateString("pt-BR");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Corrigir o check-in de ${quando}`}
        >
          <Pencil className="size-4" aria-hidden="true" />
          Corrigir
        </Button>
      </DialogTrigger>

      <DialogContent>
        {/*
          O formulario e um componente proprio, montado apenas com o dialogo
          aberto. O Radix desmonta o conteudo ao fechar, entao os inicializadores
          de estado rodam de novo a cada abertura - reabrir mostra o que esta
          gravado, sem precisar de efeito para ressincronizar.
        */}
        <EditCheckinForm
          checkin={checkin}
          quando={quando}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function EditCheckinForm({
  checkin,
  quando,
  onDone,
}: {
  checkin: EmotionalCheckin;
  quando: string;
  onDone: () => void;
}) {
  const { editCheckin } = useMockStore();
  const [mood, setMood] = useState(checkin.mood);
  const [anxiety, setAnxiety] = useState(checkin.perceivedAnxiety);
  const [energy, setEnergy] = useState(checkin.energy);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vazio =
    mood === null &&
    anxiety === null &&
    energy === null &&
    checkin.primaryFeeling === null;

  async function salvar() {
    setSaving(true);
    setError(null);
    try {
      await editCheckin({
        id: checkin.id,
        mood,
        perceivedAnxiety: anxiety,
        energy,
        primaryFeeling: checkin.primaryFeeling,
        factorIds: checkin.factorIds,
        note: checkin.note,
      });
      onDone();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível salvar a correção.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Corrigir o check-in de {quando}</DialogTitle>
        <DialogDescription>
          A data do registro não muda. Deixar um campo sem registro é diferente
          de marcar zero.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-5 py-2">
        <ScoreSlider
          id={`mood-${checkin.id}`}
          label="Humor"
          value={mood}
          onChange={setMood}
          tone="brand"
        />
        <ScoreSlider
          id={`anxiety-${checkin.id}`}
          label="Ansiedade percebida"
          value={anxiety}
          onChange={setAnxiety}
          tone="anxiety"
          hint="Valor autorrelatado por você, não medido pelo sistema."
        />
        <ScoreSlider
          id={`energy-${checkin.id}`}
          label="Energia"
          value={energy}
          onChange={setEnergy}
          tone="energy"
        />
      </div>

      {vazio ? (
        <p role="alert" className="text-sm text-ink-muted">
          Um check-in precisa de pelo menos um dado. Informe um valor ou mantenha
          o registro como estava.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-negative">
          {error}
        </p>
      ) : null}

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button onClick={salvar} disabled={saving || vazio}>
          {saving ? "Salvando…" : "Salvar correção"}
        </Button>
      </DialogFooter>
    </>
  );
}
