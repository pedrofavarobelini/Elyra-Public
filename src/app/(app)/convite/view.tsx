"use client";

import { Check, ShieldCheck } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { PageHeader } from "@/components/journey/page-header";
import { RequiresConnection } from "@/components/offline/requires-connection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  INVITE_CODE_INPUT_ERROR,
  inviteAcceptedMessage,
  normalizeInviteCode,
  tokenFromHash,
  type InviteAcceptOutcome,
} from "@/lib/contracts/professional-invites";
import { withReturnTo, type ReturnTarget } from "@/lib/navigation/return-to";
import { cn } from "@/lib/utils";

interface Preview {
  professional: {
    displayName: string;
    council: string;
    councilRegion: string;
    registrationNumber: string;
    specialty: string;
  };
  expiresAt: string;
}

interface Accepted {
  relationshipId: string;
  outcome: InviteAcceptOutcome;
  status: string;
  professional: { displayName: string; slug: string | null };
}

type Phase =
  | { kind: "entry" }
  | { kind: "preview"; token: string; preview: Preview }
  | { kind: "accepted"; accepted: Accepted }
  | { kind: "declined" };

async function redeem(token: string, action: "preview" | "accept" | "decline") {
  const response = await fetch("/api/professional/invites/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, action }),
    cache: "no-store",
  });
  const payload = (await response.json()) as { data?: unknown; error?: string };
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error ?? "Convite indisponível.");
  }
  return payload.data;
}

/**
 * Resgate de convite pela pessoa.
 *
 * O codigo (`ELY-XXXXX-XXXXX`) chega pelo fragmento (`/convite#...`) ou
 * digitado. Ele e removido da barra de endereco assim que lido, para nao ficar
 * no historico, vive so no estado desta pagina (nunca em storage) e viaja so no
 * corpo do `POST`. Aceitar cria o vinculo e **nao** compartilha nada: os dados
 * continuam desligados ate a pessoa decidir em Privacidade.
 */
export function InviteRedeemView({ back }: { back: ReturnTarget | null }) {
  const [phase, setPhase] = useState<Phase>({ kind: "entry" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(token: string) {
    setBusy(true);
    setError(null);
    try {
      const preview = (await redeem(token, "preview")) as Preview;
      setPhase({ kind: "preview", token, preview });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Convite indisponível.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const token = tokenFromHash(window.location.hash);
    if (window.location.hash) {
      // Tira o token do historico, mas preserva `?returnTo` (L-398).
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
    if (!token) return;
    const timer = window.setTimeout(() => void open(token), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function decide(action: "accept" | "decline") {
    if (phase.kind !== "preview") return;
    setBusy(true);
    setError(null);
    try {
      const result = await redeem(phase.token, action);
      setPhase(action === "accept" ? { kind: "accepted", accepted: result as Accepted } : { kind: "declined" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Convite indisponível.");
      setPhase({ kind: "entry" });
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const token = normalizeInviteCode(code);
    if (!token) {
      setError(INVITE_CODE_INPUT_ERROR);
      return;
    }
    setCode("");
    void open(token);
  }

  const step = phase.kind === "entry" ? 1 : phase.kind === "preview" ? 2 : 3;
  const privacyHref = (back ? withReturnTo("/configuracoes/privacidade#cfg-profissional", back.href) : "/configuracoes/privacidade#cfg-profissional") as Route;

  return (
    <>
      <PageHeader
        eyebrow={
          back ? (
            <Link
              href={back.href as Route}
              data-testid="invite-back"
              className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline lg:min-h-0"
            >
              ← {back.label}
            </Link>
          ) : undefined
        }
        title="Conectar com um profissional"
        description="Recebeu um código de convite? Digite abaixo para conferir quem enviou."
      />

      <ol aria-label="Etapas do convite" className="mb-5 grid max-w-3xl grid-cols-3 gap-2" data-testid="invite-steps">
        {["Código", "Conferir profissional", "Confirmar vínculo"].map((label, index) => {
          const n = index + 1;
          const done = n < step || phase.kind === "accepted";
          const current = n === step && phase.kind !== "accepted" && phase.kind !== "declined";
          return (
            <li
              key={label}
              aria-current={current ? "step" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-control border px-3 py-2 text-xs font-medium sm:text-sm",
                current ? "border-brand-300 bg-surface-brand text-brand-800" : done ? "border-line bg-surface text-ink" : "border-line bg-surface text-ink-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded-pill text-xs",
                  done ? "bg-positive text-surface" : current ? "bg-brand-600 text-surface" : "bg-surface-muted text-ink-muted",
                )}
              >
                {done ? <Check className="size-3.5" /> : n}
              </span>
              <span className="min-w-0">
                {label}
                {done ? <span className="sr-only"> (concluída)</span> : null}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)] lg:items-start">
        <Card>
          <RequiresConnection>
          {phase.kind === "preview" ? (
            <>
              <CardHeader>
                <CardTitle>{phase.preview.professional.displayName}</CardTitle>
                <CardDescription>
                  {phase.preview.professional.council}-{phase.preview.professional.councilRegion}{" "}
                  {phase.preview.professional.registrationNumber} · {phase.preview.professional.specialty}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="flex items-start gap-2 text-sm text-ink-muted">
                  <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-positive" />
                  Registro conferido na fonte oficial do conselho. Isso não é selo de qualidade profissional.
                </p>
                <p className="rounded-control bg-surface-brand px-3 py-2.5 text-sm text-brand-800" data-testid="invite-no-sharing">
                  <strong>Aceitar o convite cria o vínculo. Nenhum dado é compartilhado automaticamente.</strong> Você
                  escolhe depois o que mostrar, e pode encerrar quando quiser.
                </p>
                <p className="text-xs text-ink-subtle">
                  Convite válido até {new Date(phase.preview.expiresAt).toLocaleString("pt-BR")}.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button disabled={busy} onClick={() => void decide("accept")}>
                    Aceitar convite
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void decide("decline")}>
                    Recusar
                  </Button>
                </div>
              </CardContent>
            </>
          ) : phase.kind === "accepted" ? (
            <CardContent className="flex flex-col gap-3 pt-5" data-testid="invite-accepted">
              <p role="status" className="motion-rise-in font-medium text-ink">
                {inviteAcceptedMessage(
                  phase.accepted.outcome,
                  phase.accepted.status,
                  phase.accepted.professional.displayName,
                )}
              </p>
              <p className="text-sm text-ink-muted">
                Compartilhar é opcional e pode esperar. Você decide o que o profissional vê, e pode mudar quando quiser.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button asChild className="self-start">
                  <Link href={privacyHref}>Gerenciar compartilhamento</Link>
                </Button>
                {phase.accepted.professional.slug ? (
                  <Button asChild variant="secondary">
                    <Link href={`/profissionais/${phase.accepted.professional.slug}` as Route}>Ver perfil</Link>
                  </Button>
                ) : null}
                {phase.accepted.status === "active" ? (
                  <Button asChild variant="secondary">
                    <Link href={`/agenda?vinculo=${phase.accepted.relationshipId}` as Route}>Pedir horário</Link>
                  </Button>
                ) : null}
                <Button asChild variant="ghost">
                  <Link href={(back?.href ?? "/dashboard") as Route}>Agora não</Link>
                </Button>
              </div>
            </CardContent>
          ) : phase.kind === "declined" ? (
            <CardContent className="flex flex-col gap-3 pt-5">
              <p role="status" className="text-ink">
                Convite recusado. O código não pode mais ser usado.
              </p>
              {back ? (
                <Button asChild variant="secondary" className="self-start">
                  <Link href={back.href as Route}>{back.label}</Link>
                </Button>
              ) : null}
            </CardContent>
          ) : (
            <>
              <CardHeader>
                <CardTitle>Código de convite</CardTitle>
                <CardDescription>
                  Digite o código que o profissional entregou a você, no formato ELY-XXXXX-XXXXX. Maiúsculas,
                  minúsculas e hífens não importam. Ele vale por 72 horas e só pode ser usado uma vez.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="flex flex-wrap items-end gap-3" onSubmit={submit} noValidate>
                  <div className="min-w-56 flex-1">
                    <Label htmlFor="invite-code">Código de convite</Label>
                    <Input
                      id="invite-code"
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      placeholder="ELY-XXXXX-XXXXX"
                      autoComplete="off"
                      autoCapitalize="characters"
                      autoCorrect="off"
                      spellCheck={false}
                      inputMode="text"
                      maxLength={64}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? "invite-error" : undefined}
                      className="font-mono tracking-wider"
                      required
                    />
                  </div>
                  <Button disabled={busy} type="submit">
                    Ver convite
                  </Button>
                </form>
              </CardContent>
            </>
          )}
          {error ? (
            <CardContent className="pt-0">
              <p role="alert" id="invite-error" className="text-sm text-destructive">
                {error}
              </p>
            </CardContent>
          ) : null}
          </RequiresConnection>
        </Card>

        <Card variant="muted" data-testid="invite-how">
          <CardContent className="flex flex-col gap-3 pt-5 text-sm text-ink-muted">
            <p className="font-medium text-ink">Como funciona</p>
            <ul className="flex list-disc flex-col gap-2 pl-5">
              <li>O código mostra quem enviou antes de você decidir.</li>
              <li>Aceitar cria o vínculo; nenhum dado sai por isso.</li>
              <li>Você liga, desliga e encerra o que o profissional vê, quando quiser.</li>
              <li>Uma sessão particular também pergunta o que compartilhar naquela sessão.</li>
            </ul>
            <p>
              Não tem código?{" "}
              <Link href="/profissionais" className="font-medium text-brand-700 hover:underline">
                Encontrar profissionais
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
