"use client";

import {
  Camera,
  Circle,
  Lightbulb,
  Lock,
  Mic,
  MicOff,
  Monitor,
  Pause,
  Play,
  Square,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconPill } from "@/components/ui/icon-pill";
import { SESSION_KIND_LABEL } from "@/lib/contracts/session";
import { SESSION_PROMPT, SESSION_TIPS } from "@/mocks/session-data";
import { cn } from "@/lib/utils";
import { useMockStore } from "@/mocks/store";



const WAVEFORM = [
  4, 9, 14, 22, 17, 10, 6, 12, 20, 28, 24, 15, 9, 5, 11, 19, 26, 30, 23, 16,
  10, 6, 13, 21, 27, 22, 14, 8, 5, 10, 18, 25, 20, 12, 7, 4,
] as const;

export function LiveSessionView() {
  const { sessionSetup, user } = useMockStore();
  const router = useRouter();

  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);

  const prompt = SESSION_PROMPT[sessionSetup.kind] ?? SESSION_PROMPT.guided;

  const activeResources = [
    sessionSetup.screen
      ? { icon: Monitor, label: "Tela ativa", detail: "Compartilhando" }
      : null,
    sessionSetup.camera
      ? { icon: Camera, label: "Câmera ativa", detail: "Simulada nesta versão" }
      : null,
    sessionSetup.microphone
      ? { icon: Mic, label: "Microfone ativo", detail: "Simulado nesta versão" }
      : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            Nova sessão multimodal
          </h1>
          <Badge tone="brand">BETA</Badge>
          <Badge tone="neutral">{SESSION_KIND_LABEL[sessionSetup.kind]}</Badge>
        </div>
        <p className="mt-1 text-ink-muted">{prompt?.body}</p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {sessionSetup.screen ? (
                  <>
                    <Badge tone="brand">TELA COMPARTILHADA</Badge>
                    <span className="text-sm text-ink-muted">
                      O que você está compartilhando fica visível aqui.
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-ink-muted">
                    Compartilhamento de tela desativado para esta sessão.
                  </span>
                )}
              </div>

              <div className="relative overflow-hidden rounded-card border border-line bg-gradient-to-b from-surface-brand/70 to-surface p-6">
                {sessionSetup.screen ? (
                  <SharedScreenPreview name={user.name} />
                ) : (
                  <p className="py-16 text-center text-sm text-ink-subtle">
                    Nada está sendo compartilhado.
                  </p>
                )}

                {sessionSetup.camera ? (
                  <div
                    className="absolute bottom-4 right-4 flex size-32 items-center justify-center rounded-card border border-line bg-surface-muted shadow-raised sm:size-40"
                    aria-label="Prévia da câmera (simulada)"
                    role="img"
                  >
                    <Camera
                      className="size-8 text-ink-subtle"
                      aria-hidden="true"
                    />
                  </div>
                ) : null}
              </div>

              <ul className="flex flex-wrap gap-3">
                {activeResources.length === 0 ? (
                  <li className="text-sm text-ink-subtle">
                    Nenhum recurso de captura foi autorizado para esta sessão.
                  </li>
                ) : (
                  activeResources.map(({ icon: Icon, label, detail }) => (
                    <li
                      key={label}
                      className="flex items-center gap-3 rounded-control bg-positive-soft px-4 py-2.5"
                    >
                      <IconPill tone="positive" size="sm">
                        <Icon />
                      </IconPill>
                      <span>
                        <span className="block text-sm font-medium text-ink">
                          {label}
                        </span>
                        <span className="block text-xs text-ink-muted">
                          {detail}
                        </span>
                      </span>
                    </li>
                  ))
                )}
              </ul>
            </CardContent>
          </Card>

          <p
            role="note"
            className="flex items-center gap-3 rounded-control bg-surface-brand px-4 py-3 text-sm text-brand-800"
          >
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            Seus dados são protegidos e tratados com confidencialidade. Nesta
            versão nada é capturado nem enviado.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <span
                  className={cn(
                    "flex items-center gap-2 text-sm font-semibold",
                    paused ? "text-ink-muted" : "text-destructive",
                  )}
                  aria-live="polite"
                >
                  {paused ? (
                    <>
                      <Pause className="size-4" aria-hidden="true" />
                      PAUSADA
                    </>
                  ) : (
                    <>
                      <Circle
                        className="size-3 fill-destructive"
                        aria-hidden="true"
                      />
                      REC
                    </>
                  )}
                </span>
                <span
                  data-testid="session-timer"
                  className="text-lg font-semibold tabular-nums text-ink"
                >
                  {formatElapsed(elapsed)}
                </span>
              </div>

              <div className="rounded-control bg-surface-brand p-4">
                <h2 className="text-sm font-semibold text-brand-800">
                  {prompt?.title}
                </h2>
                <p className="mt-1 text-sm text-brand-800">{prompt?.body}</p>
                <p className="mt-2 text-sm text-brand-800">
                  Você pode falar livremente.
                </p>
              </div>

              <div>
                <h2 className="mb-3 text-sm font-semibold text-ink">
                  Dicas para uma boa sessão
                </h2>
                <ul className="flex flex-col gap-3">
                  {SESSION_TIPS.map((tip) => (
                    <li key={tip.title} className="flex items-start gap-3">
                      <IconPill tone="brand" size="sm">
                        <Lightbulb />
                      </IconPill>
                      <div>
                        <p className="text-sm font-medium text-ink">
                          {tip.title}
                        </p>
                        <p className="text-sm text-ink-muted">{tip.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-line pt-4">
                {sessionSetup.microphone ? (
                  <>
                    <div
                      className="flex h-16 items-end justify-center gap-1"
                      role="img"
                      aria-label={
                        paused ? "Captura pausada" : "Captura de voz ativa"
                      }
                    >
                      {WAVEFORM.map((h, i) => (
                        <span
                          key={i}
                          aria-hidden="true"
                          className={cn(
                            "w-1 rounded-pill",
                            paused ? "bg-line-strong" : "bg-brand-500",
                          )}
                          style={{ height: `${h * 2}px` }}
                        />
                      ))}
                    </div>
                    <p className="mt-2 text-center text-sm text-ink-muted">
                      {paused ? "Pausado" : "Falando..."}
                    </p>
                  </>
                ) : (
                  <p className="flex items-center justify-center gap-2 py-4 text-sm text-ink-subtle">
                    <MicOff className="size-4" aria-hidden="true" />
                    Microfone não autorizado para esta sessão
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => setPaused((p) => !p)}
                >
                  {paused ? (
                    <>
                      <Play aria-hidden="true" />
                      Retomar sessão
                    </>
                  ) : (
                    <>
                      <Pause aria-hidden="true" />
                      Pausar sessão
                    </>
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="lg"
                  onClick={() => setConfirming(true)}
                >
                  <Square aria-hidden="true" />
                  Finalizar sessão
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalizar a sessão?</DialogTitle>
            <DialogDescription>
              A sessão será encerrada e você será levada ao resultado. Nesta
              versão nenhuma mídia é gravada nem enviada.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Continuar sessão
            </Button>
            <Button
              variant="destructive"
              onClick={() => router.push("/sessoes/123")}
            >
              Finalizar sessão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, "0")).join(":");
}

/**
 * Previa estatica do que estaria sendo compartilhado.
 *
 * Deliberadamente estatica: e uma ilustracao do enquadramento, nao uma captura.
 */
function SharedScreenPreview({ name }: { name: string }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div>
        <p className="text-lg font-semibold text-brand-700">
          Bem-vindo de volta, {name}
        </p>
        <p className="text-sm text-ink-muted">Continue de onde parou</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          "Seu humor hoje",
          "Meta em andamento",
          "Insights recentes",
        ].map((title) => (
          <div key={title} className="rounded-card bg-surface p-4 shadow-card">
            <p className="text-xs font-medium text-ink">{title}</p>
            <div className="mt-3 h-2 w-2/3 rounded-pill bg-brand-200" />
            <div className="mt-2 h-2 w-1/2 rounded-pill bg-surface-muted" />
          </div>
        ))}
      </div>

      <div className="rounded-card bg-surface p-4 shadow-card">
        <p className="text-xs font-medium text-ink">Evolução semanal</p>
        <div className="mt-3 flex h-16 items-end gap-2">
          {[30, 55, 40, 70, 50, 65, 45].map((h, i) => (
            <span
              key={i}
              className="flex-1 rounded-t-control bg-brand-200"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
