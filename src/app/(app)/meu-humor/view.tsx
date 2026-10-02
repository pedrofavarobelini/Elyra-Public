"use client";

import Link from "next/link";
import { useState } from "react";

import { FactorPicker } from "@/components/journey/factor-picker";
import { FeelingPicker } from "@/components/journey/feeling-picker";
import { PageHeader } from "@/components/journey/page-header";
import { ScoreSlider } from "@/components/journey/score-slider";
import { useWasQueued } from "@/components/offline/pending-sync-badge";
import { SuccessState } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  emotionalCheckinInputSchema,
  sleepRecordInputSchema,
  type PrimaryFeeling,
} from "@/lib/contracts/emotional";
import { toDay } from "@/lib/contracts/goals";
import { useMockStore } from "@/mocks/store";

export function CheckinView() {
  const { factors, addCheckin, addCustomFactor, addSleep } = useMockStore();
  const wasQueued = useWasQueued();

  const [feeling, setFeeling] = useState<PrimaryFeeling | null>("tranquilo");
  const [mood, setMood] = useState<number | null>(7);
  const [anxiety, setAnxiety] = useState<number | null>(4);
  const [energy, setEnergy] = useState<number | null>(6);
  const [selectedFactors, setSelectedFactors] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const [sleepHours, setSleepHours] = useState("7");
  const [sleepMinutes, setSleepMinutes] = useState("12");
  const [sleepQuality, setSleepQuality] = useState<number | null>(7);

  const [saved, setSaved] = useState(false);
  const [savedLocally, setSavedLocally] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savingCheckin, setSavingCheckin] = useState(false);
  const [savingSleep, setSavingSleep] = useState(false);

  const toggleFactor = (id: string) =>
    setSelectedFactors((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id],
    );

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const parsed = emotionalCheckinInputSchema.safeParse({
      mood,
      perceivedAnxiety: anxiety,
      energy,
      primaryFeeling: feeling,
      factorIds: selectedFactors,
      note: note.trim() === "" ? null : note.trim(),
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Registro inválido.");
      return;
    }

    setSavingCheckin(true);
    try {
      const created = await addCheckin(parsed.data);
      setSavedLocally(wasQueued(created.id));
      setSaved(true);
      setSelectedFactors([]);
      setNote("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível salvar.",
      );
    } finally {
      setSavingCheckin(false);
    }
  };

  const submitSleep = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    const h = Number(sleepHours || 0);
    const m = Number(sleepMinutes || 0);
    const duration = sleepHours === "" && sleepMinutes === "" ? null : h * 60 + m;

    const parsed = sleepRecordInputSchema.safeParse({
      night: toDay(new Date()),
      durationMinutes: duration,
      quality: sleepQuality,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Registro de sono inválido.");
      return;
    }

    setSavingSleep(true);
    try {
      await addSleep(parsed.data);
      setSavedLocally(wasQueued(`sleep:${parsed.data.night}`));
      setSaved(true);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível salvar.",
      );
    } finally {
      setSavingSleep(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Meu Humor"
        description="Registre como você se sente agora. Você pode fazer mais de um check-in por dia."
        action={
          <Button asChild variant="secondary">
            <Link href="/historico">Ver histórico</Link>
          </Button>
        }
      />

      {saved ? (
        <SuccessState
          className="mb-6"
          title={savedLocally ? "Guardado neste aparelho" : "Registro salvo"}
          description={
            savedLocally
              ? "Já aparece no histórico e sincroniza com sua conta quando a conexão voltar."
              : "Seu check-in entrou no histórico."
          }
        />
      ) : null}

      {error ? (
        <p
          role="alert"
          className="mb-6 rounded-control bg-destructive-soft p-4 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(20rem,1fr)] 2xl:grid-cols-[minmax(0,1.8fr)_minmax(24rem,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="lg:text-lg">Check-in emocional</CardTitle>
            <CardDescription>
              Campos deixados sem registro não viram zero.
            </CardDescription>
            <p className="mt-2 rounded-control bg-surface-brand px-3 py-2 text-xs text-brand-800">
              Tudo aqui é autorrelato: descreve como você percebe o momento, e
              não uma medição feita pelo sistema.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-6">
              <div>
                <p className="mb-3 text-sm font-medium text-ink">
                  Sentimento predominante
                </p>
                <FeelingPicker value={feeling} onChange={setFeeling} />
              </div>

              <div className="grid gap-5 rounded-card border border-line p-4 sm:p-5">
              <ScoreSlider id="mood" label="Humor" value={mood} onChange={setMood} />
              <ScoreSlider
                id="anxiety"
                label="Ansiedade percebida"
                tone="anxiety"
                hint="Como você percebe sua ansiedade, não uma medição."
                value={anxiety}
                onChange={setAnxiety}
              />
              <ScoreSlider
                id="energy"
                label="Energia"
                tone="energy"
                value={energy}
                onChange={setEnergy}
              />
              </div>

              <div>
                <p className="mb-3 text-sm font-medium text-ink">
                  O que influenciou seu dia?
                </p>
                <FactorPicker
                  factors={factors}
                  selected={selectedFactors}
                  onToggle={toggleFactor}
                  onCreate={async (label) => {
                    setError(null);
                    try {
                      const created = await addCustomFactor(label);
                      setSelectedFactors((prev) => [...prev, created.id]);
                    } catch (caught) {
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "Não foi possível criar o fator.",
                      );
                      throw caught;
                    }
                  }}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="note">Observação</Label>
                <Textarea
                  id="note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Opcional"
                  maxLength={500}
                />
              </div>

              <Button type="submit" className="w-full sm:w-auto sm:self-start" disabled={savingCheckin}>
                {savingCheckin ? "Salvando..." : "Salvar check-in"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:sticky lg:top-4 lg:self-start">
          <CardHeader>
            <CardTitle className="lg:text-lg">Sono</CardTitle>
            <CardDescription>
              Registro separado do check-in emocional.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitSleep} className="flex flex-col gap-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sleep-hours">Horas</Label>
                  <Input
                    id="sleep-hours"
                    type="number"
                    min={0}
                    max={24}
                    value={sleepHours}
                    onChange={(e) => setSleepHours(e.target.value)}
                    />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="sleep-minutes">Minutos</Label>
                  <Input
                    id="sleep-minutes"
                    type="number"
                    min={0}
                    max={59}
                    value={sleepMinutes}
                    onChange={(e) => setSleepMinutes(e.target.value)}
                  />
                </div>
              </div>

              <ScoreSlider
                id="sleep-quality"
                label="Qualidade do sono"
                tone="sleep"
                value={sleepQuality}
                onChange={setSleepQuality}
              />

              <Button
                type="submit"
                variant="secondary"
                className="w-full sm:w-auto sm:self-start"
                disabled={savingSleep}
              >
                {savingSleep ? "Salvando..." : "Salvar sono"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
