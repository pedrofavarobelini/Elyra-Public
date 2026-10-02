"use client";

import {
  ArrowRight,
  CalendarDays,
  Heart,
  ShieldCheck,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { NonClinicalNotice } from "@/components/ui/non-clinical-notice";
import { useMockStore } from "@/mocks/store";

/**
 * Opt-in do acompanhamento do ciclo (figura 2).
 *
 * O consentimento e a **tela inteira**, nao um checkbox escondido em
 * configuracoes. O modulo so passa a existir depois de uma escolha explicita, e
 * "Agora nao" e uma saida de primeira classe - nao um link secundario.
 *
 * O modulo nunca e ativado por sexo, genero ou qualquer inferencia.
 */

const BENEFITS = [
  {
    icon: CalendarDays,
    tone: "brand" as const,
    title: "Calendário do ciclo",
    body: "Visualize as fases do seu ciclo e acompanhe as estimativas.",
  },
  {
    icon: Heart,
    tone: "cycle" as const,
    title: "Sintomas e bem-estar",
    body: "Registre sintomas físicos e emocionais de forma simples.",
  },
  {
    icon: TrendingUp,
    tone: "brand" as const,
    title: "Relação com seu humor",
    body: "Veja como seu ciclo aparece junto de humor, sono e energia.",
  },
  {
    icon: ShieldCheck,
    tone: "positive" as const,
    title: "Privacidade em primeiro lugar",
    body: "Você controla com quem compartilha suas informações.",
  },
];

export function CycleOnboarding() {
  const { enableCycle } = useMockStore();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await enableCycle();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível ativar o acompanhamento.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="mb-6 overflow-hidden bg-gradient-to-br from-surface-brand via-surface to-surface p-6 sm:p-8">
        <div className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <Badge tone="brand" className="mb-5">
              <Sparkles className="size-3" aria-hidden="true" />
              NOVO NO ELYRA
            </Badge>

            <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
              Acompanhe seu ciclo
              <span aria-hidden="true">{"\u{1F338}"}</span>
            </h1>

            <p className="mt-4 max-w-lg text-ink-muted">
              Registre informações do seu ciclo e observe como ele se relaciona
              com mudanças no seu humor, sono, energia e bem-estar ao longo do
              tempo.
            </p>

            <NonClinicalNotice context="cycle" className="mt-6 max-w-lg" />

            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                size="lg"
                onClick={() => void enable()}
                disabled={busy}
              >
                {busy ? "Ativando..." : "Ativar acompanhamento"}
                <ArrowRight aria-hidden="true" />
              </Button>
              <Button
                size="lg"
                variant="secondary"
                onClick={() => router.push("/dashboard")}
              >
                Agora não
              </Button>
            </div>
            {error ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <CycleIllustration />
        </div>
      </Card>

      <Card>
        <CardContent>
          <h2 className="mb-6 text-center text-lg font-semibold text-ink">
            O que você vai descobrir com o acompanhamento
          </h2>

          <ul className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
            {BENEFITS.map(({ icon: Icon, tone, title, body }) => (
              <li key={title} className="flex flex-col items-start gap-3">
                <IconPill tone={tone} size="lg">
                  <Icon />
                </IconPill>
                <div>
                  <h3 className="font-medium text-ink">{title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{body}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="mt-8 text-center text-sm font-medium text-brand-700">
            Você está no controle, sempre.
          </p>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Você pode ativar ou desativar este acompanhamento a qualquer momento em
        Configurações. Desativar <strong className="font-medium text-ink">não</strong>{" "}
        apaga seus registros.
      </p>
    </>
  );
}

/** Ilustracao decorativa: calendario + fases. Puramente visual. */
function CycleIllustration() {
  const phases = [
    { label: "Menstruação", className: "bg-cycle" },
    { label: "Fase folicular", className: "bg-metric-sleep" },
    { label: "Ovulação", className: "bg-brand-400" },
    { label: "Fase lútea", className: "bg-metric-energy" },
  ];

  return (
    <div
      aria-hidden="true"
      className="relative hidden rounded-card bg-surface-brand/60 p-6 lg:block"
    >
      <div className="rounded-card bg-surface p-4 shadow-card">
        <div className="mb-3 h-2 w-full rounded-pill bg-brand-200" />
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 28 }, (_, i) => {
            const isPeriod = i < 4;
            const isOvulation = i === 13;
            return (
              <span
                key={i}
                className={[
                  "aspect-square rounded-pill",
                  isPeriod
                    ? "bg-cycle-soft"
                    : isOvulation
                      ? "border-2 border-brand-400"
                      : "bg-surface-muted",
                ].join(" ")}
              />
            );
          })}
        </div>
      </div>

      <ul className="mt-4 flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card">
        {phases.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-sm text-ink">
            <span className={`size-2.5 rounded-pill ${p.className}`} />
            {p.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
