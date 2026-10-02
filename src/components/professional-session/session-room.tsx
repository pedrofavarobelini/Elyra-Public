"use client";

import {
  CircleCheck,
  CircleDashed,
  DoorOpen,
  FileText,
  Info,
  LogOut,
  Mic,
  ShieldCheck,
  Square,
  Video,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { PageHeader } from "@/components/journey/page-header";
import { schedulingFetch } from "@/components/scheduling/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  PROFESSIONAL_SESSION_STATUS_LABEL,
  SESSION_CONSENTS,
  SESSION_CONSENT_COPY,
  type ProfessionalSessionDetail,
  type ProfessionalSessionStatus,
  type SessionConsent,
} from "@/lib/contracts/professional-sessions";
import { MODALITY_LABEL } from "@/lib/contracts/scheduling";
import type { CaptureResource } from "@/lib/contracts/session";
import { isCallCaptureResource } from "@/lib/realtime/capture-guard";
import { useSessionCall } from "@/lib/realtime/use-session-call";
import { formatDayHeading, formatTime, timezoneLabel } from "@/lib/scheduling/format";

import { CALL_STATE_LABEL, CallStage } from "./call-stage";
import { PreCall, type PreCallChoice } from "./pre-call";

/*
  A captura embutida carrega o motor multimodal inteiro; so baixa quando a
  pessoa liga um registro durante a chamada.
*/
const EmbeddedCapture = dynamic(
  () => import("@/app/(app)/sessoes/nova/capture-view").then((module) => module.Stage11LiveCaptureView),
  { ssr: false },
);

/**
 * Sala da sessao profissional (PRO-7), para os dois papeis.
 *
 * Presenca e registro sao coisas separadas na tela, como no banco: entrar nao
 * liga microfone, camera, transcricao nem IA.
 *
 * PRO-7R: sessao online tem chamada 1:1 (LiveKit, E2EE obrigatorio). A tela
 * separa as duas coisas que a pessoa precisa distinguir:
 *   - "Chamada": o que a outra pessoa ve e ouve; nao fica guardado.
 *   - "Analise Elyra": o que a Elyra registra; so com as permissoes desta
 *     sessao, e so a partir do track LOCAL da propria pessoa.
 * Presenca na sessao (trilha Elyra) e presenca na chamada (midia do provider)
 * aparecem como dois fatos com nomes diferentes, nunca como um so.
 */

const STATUS_TONE: Record<ProfessionalSessionStatus, "brand" | "positive" | "neutral" | "attention"> = {
  scheduled: "neutral",
  ready: "brand",
  active: "positive",
  completed: "neutral",
  cancelled: "neutral",
  expired: "attention",
};

export function SessionStatusBadge({ status }: { status: ProfessionalSessionStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} data-session-status={status}>
      {status === "active" ? <CircleCheck aria-hidden="true" className="size-3.5" /> : <CircleDashed aria-hidden="true" className="size-3.5" />}
      {PROFESSIONAL_SESSION_STATUS_LABEL[status]}
    </Badge>
  );
}

type Feedback = { kind: "ok" | "error"; text: string } | null;

export function SessionRoom({ detail }: { detail: ProfessionalSessionDetail }) {
  const router = useRouter();
  const baseId = useId();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [transcript, setTranscript] = useState<{ content: string | null; wordCount: number | null } | null>(null);
  const [outputDeviceId, setOutputDeviceId] = useState<string>();
  const [embedded, setEmbedded] = useState<{ id: string; resources: CaptureResource[] } | null>(null);
  const call = useSessionCall(detail.id);
  const isClient = detail.role === "client";
  const online = detail.modality === "online";
  const open = detail.status === "ready" || detail.status === "active";
  const counterpart = detail.counterpartName ?? (isClient ? "Profissional" : "Pessoa acompanhada");
  const callVisible =
    online && call.snapshot.state !== "idle" && !(call.snapshot.state === "disconnected" && call.snapshot.failure === null);

  // Presenca da outra parte muda sem aviso: releitura curta so enquanto a
  // janela esta aberta e a aba esta visivel. Nada fica em cache (no-store).
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => {
      // Sem rede, `refresh` vira navegacao dura e o SW leva para /offline -
      // o que derrubaria uma chamada que o provider ainda tenta reconectar.
      if (document.visibilityState === "visible" && navigator.onLine) router.refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [open, router]);

  // A outra parte entrou/saiu da chamada: a presenca na sessao (trilha Elyra)
  // e relida na hora, para as duas verdades nao divergirem ate o proximo ciclo.
  const remotePresent = call.snapshot.remote.present;
  useEffect(() => {
    if (online && navigator.onLine) router.refresh();
  }, [online, remotePresent, router]);

  // Sessao fechou (concluida, cancelada, janela): a chamada cai junto, sem
  // esperar o heartbeat. O servidor ja apagou a sala; isto e so a tela.
  const { live, terminate } = call;
  useEffect(() => {
    if (!open && live) void terminate("A sessão foi encerrada, então a chamada também.");
  }, [live, open, terminate]);

  // Permissao revogada durante o registro: a captura para NA HORA (desmonta,
  // os clones param) e a chamada continua. Nada novo entra depois disso.
  const revoked =
    embedded !== null &&
    ((embedded.resources.includes("microphone") && !detail.consents.allow_audio) ||
      (embedded.resources.includes("camera") && !detail.consents.allow_video));
  useEffect(() => {
    if (!revoked) return;
    const frame = requestAnimationFrame(() => {
      setEmbedded(null);
      setFeedback({ kind: "ok", text: "Permissão desligada: o registro parou. A chamada continua." });
    });
    return () => cancelAnimationFrame(frame);
  }, [revoked]);
  const liveCapture = revoked ? null : embedded;

  async function act(action: "enter" | "leave" | "complete", done: string) {
    setBusy(action);
    setFeedback(null);
    try {
      await schedulingFetch(`/api/professional-sessions/${detail.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      setFeedback({ kind: "ok", text: done });
      setConfirmEnd(false);
      router.refresh();
      return true;
    } catch (caught) {
      setFeedback({ kind: "error", text: caught instanceof Error ? caught.message : "Não foi possível concluir." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  /** Entrar: presenca na sessao (credencial PRO-7) e, depois, a chamada. */
  async function enterAndJoin(choice: PreCallChoice) {
    setOutputDeviceId(choice.outputDeviceId);
    if (!detail.mePresent) {
      const entered = await act("enter", "Você entrou na sessão.");
      if (!entered) return;
    }
    await call.join(choice);
  }

  async function leaveSession() {
    setEmbedded(null);
    await call.leave();
    await act("leave", "Você saiu da sessão.");
  }

  async function completeSession() {
    setEmbedded(null);
    await call.leave();
    await act("complete", "Sessão encerrada.");
  }

  async function setConsent(consent: SessionConsent, value: boolean) {
    setBusy(consent);
    setFeedback(null);
    try {
      await schedulingFetch(`/api/professional-sessions/${detail.id}/consents`, {
        method: "PUT",
        body: JSON.stringify({ consent, value }),
      });
      setFeedback({
        kind: "ok",
        text: `${SESSION_CONSENT_COPY[consent].label}: ${value ? "ligado" : "desligado"}.`,
      });
      router.refresh();
    } catch (caught) {
      setFeedback({ kind: "error", text: caught instanceof Error ? caught.message : "Não foi possível alterar." });
    } finally {
      setBusy(null);
    }
  }

  async function readTranscript() {
    setBusy("transcript");
    setFeedback(null);
    try {
      const data = await schedulingFetch<{ content: string | null; wordCount: number | null; outcome: string }>(
        `/api/professional-sessions/${detail.id}/transcript`,
      );
      if (data.outcome === "not_available") {
        setFeedback({ kind: "error", text: "Ainda não há transcrição disponível desta sessão." });
      } else {
        setTranscript({ content: data.content, wordCount: data.wordCount });
      }
    } catch (caught) {
      setFeedback({ kind: "error", text: caught instanceof Error ? caught.message : "Não foi possível ler." });
    } finally {
      setBusy(null);
    }
  }

  const when = `${formatDayHeading(detail.startsAt, detail.timezone)}, ${formatTime(detail.startsAt, detail.timezone)}–${formatTime(detail.endsAt, detail.timezone)}`;
  const consentsOn = SESSION_CONSENTS.filter((consent) => detail.consents[consent]).length;
  const consentSummary =
    consentsOn === 0
      ? isClient
        ? "Nada ligado. A Elyra não registra nada desta sessão."
        : "A pessoa não ligou nenhum registro."
      : `${consentsOn === 1 ? "1 permissão ligada" : `${consentsOn} permissões ligadas`}.`;

  const transcriptCard = !isClient ? (
    <Card data-testid="session-transcript">
      <CardHeader>
        <CardTitle as="h2">Transcrição</CardTitle>
        <CardDescription>
          Só com a permissão da pessoa para esta sessão. Cada leitura fica registrada para ela.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3 text-sm text-ink-muted">
        {!detail.consents.allow_professional_transcript_access ? (
          <p>A pessoa não liberou a leitura da transcrição desta sessão.</p>
        ) : !detail.transcriptAvailable ? (
          <p>A leitura está liberada, mas ainda não há transcrição disponível.</p>
        ) : transcript ? (
          <div
            className="max-h-80 w-full overflow-y-auto whitespace-pre-line rounded-control border border-line bg-surface-muted/50 p-3 text-ink"
            tabIndex={0}
            aria-label="Texto da transcrição"
            data-testid="transcript-text"
          >
            {transcript.content}
          </div>
        ) : (
          <Button variant="secondary" disabled={busy !== null} onClick={() => void readTranscript()}>
            <FileText aria-hidden="true" />
            Ler transcrição
          </Button>
        )}
      </CardContent>
    </Card>
  ) : null;

  // Na chamada a lista e compacta (rotulo + estado): o detalhe de cada
  // permissao continua no dialogo, e o painel nao empurra a chamada.
  const consentListCompact = (
    <ul className="flex flex-col divide-y divide-line" aria-label="O que a Elyra registra">
      {SESSION_CONSENTS.map((consent) => {
        const on = detail.consents[consent] === true;
        return (
          <li
            key={consent}
            className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
            data-consent={consent}
            data-state={on ? "on" : "off"}
          >
            <span className="min-w-0 text-sm text-ink">{SESSION_CONSENT_COPY[consent].label}</span>
            <Badge tone={on ? "positive" : "neutral"}>{on ? "Ligado" : "Desligado"}</Badge>
          </li>
        );
      })}
    </ul>
  );

  const consentList = (
    <ul className="flex flex-col divide-y divide-line">
      {SESSION_CONSENTS.map((consent) => {
        const on = detail.consents[consent] === true;
        return (
          <li key={consent} className="py-3 first:pt-0 last:pb-0" data-consent={consent} data-state={on ? "on" : "off"}>
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 text-sm font-medium text-ink">{SESSION_CONSENT_COPY[consent].label}</span>
              <Badge tone={on ? "positive" : "neutral"}>{on ? "Ligado" : "Desligado"}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-ink-muted">
              {isClient
                ? on
                  ? SESSION_CONSENT_COPY[consent].on
                  : SESSION_CONSENT_COPY[consent].off
                : on
                  ? SESSION_CONSENT_COPY[consent].proOn
                  : SESSION_CONSENT_COPY[consent].proOff}
            </p>
          </li>
        );
      })}
    </ul>
  );

  const closedNote = (
    <p className="text-sm text-ink-muted" data-testid="session-closed-note">
      {detail.status === "scheduled"
        ? "Ainda não é hora de entrar. A entrada abre 10 minutos antes do horário."
        : detail.status === "completed"
          ? "Sessão concluída. Não é possível entrar de novo."
          : detail.status === "cancelled"
            ? "O horário foi cancelado, então a sessão não acontece."
            : "A janela de entrada fechou sem a sessão acontecer."}
    </p>
  );

  return (
    <>
      <PageHeader
        title={`Sessão com ${counterpart}`}
        description={`${when} · ${timezoneLabel(detail.timezone)} · ${MODALITY_LABEL[detail.modality]}`}
        meta={<SessionStatusBadge status={detail.status} />}
      />

      <div aria-live="polite" className="mb-4 empty:hidden">
        {feedback ? (
          <p
            role={feedback.kind === "error" ? "alert" : "status"}
            className={
              feedback.kind === "error"
                ? "rounded-control bg-destructive-soft px-3 py-2 text-sm text-destructive"
                : "rounded-control bg-positive-soft px-3 py-2 text-sm text-positive"
            }
          >
            {feedback.text}
          </p>
        ) : null}
      </div>

      {online ? (
        <div
          className="grid items-start gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]"
          data-layout="columns"
        >
          <div className="flex min-w-0 flex-col gap-5 lg:gap-6">
            {callVisible && call.adapter ? (
              <CallStage
                adapter={call.adapter}
                snapshot={call.snapshot}
                counterpart={counterpart}
                outputDeviceId={outputDeviceId}
                onLeave={() => {
                  setEmbedded(null);
                  void call.leave();
                }}
                onRetry={() => void call.join()}
                retrying={call.joining}
              />
            ) : open || detail.status === "scheduled" ? (
              <>
                {!open ? <Card><CardContent>{closedNote}</CardContent></Card> : null}
                <PreCall
                detail={detail}
                open={open}
                joining={call.joining || busy === "enter"}
                consentSummary={consentSummary}
                onOpenConsents={isClient ? () => setConsentOpen(true) : null}
                onJoin={(choice) => void enterAndJoin(choice)}
                />
              </>
            ) : (
              <Card data-testid="session-ended">
                <CardContent className="flex flex-col items-start gap-3">
                  {closedNote}
                  <Button asChild variant="secondary">
                    <Link href={isClient ? "/agenda" : "/pro/agenda"}>Voltar à Agenda</Link>
                  </Button>
                </CardContent>
              </Card>
            )}

            {call.notice ? (
              <p
                role={call.notice.kind === "info" ? "status" : "alert"}
                className={
                  call.notice.kind === "info"
                    ? "rounded-control bg-surface-muted px-3 py-2 text-sm text-ink"
                    : "rounded-control bg-destructive-soft px-3 py-2 text-sm text-destructive"
                }
                data-testid="call-notice"
              >
                {call.notice.text}
              </p>
            ) : null}

            {liveCapture && call.adapter ? (
              <section aria-label="Registro Elyra" className="min-w-0 rounded-card border border-identity-100 p-3 sm:p-4" data-testid="embedded-capture">
                <EmbeddedCapture
                  embedded={{
                    sessionId: liveCapture.id,
                    acquireStream: async (resource) => {
                      // Tela nunca entra; so microfone e camera, e so do track LOCAL.
                      if (!isCallCaptureResource(resource)) {
                        throw new DOMException("Not allowed in a call", "NotAllowedError");
                      }
                      return call.adapter!.captureStream(resource);
                    },
                    onExit: (outcome) => {
                      setEmbedded(null);
                      setFeedback({
                        kind: "ok",
                        text: outcome === "finished" ? "Registro concluído. Ele está nas suas Sessões." : "Registro descartado.",
                      });
                      router.refresh();
                    },
                  }}
                />
              </section>
            ) : null}

            {transcriptCard}
          </div>

          <aside className="flex min-w-0 flex-col gap-5" aria-label="Análise Elyra" data-testid="elyra-panel">
            <Card data-testid="session-consents">
              <CardHeader>
                <CardTitle as="h2" className="flex items-center gap-2">
                  <ShieldCheck aria-hidden="true" className="size-4 text-identity-700" />
                  Análise Elyra
                </CardTitle>
                <CardDescription>
                  {isClient
                    ? "Separada da chamada. Na chamada, o que vocês falam e mostram vai direto para a outra pessoa e não fica guardado. Aqui fica só o que a Elyra registra, e só o que você ligar."
                    : "Separada da chamada. O que a pessoa escolheu registrar nesta sessão; só ela muda."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm" data-testid="presence" aria-live="polite">
                  <dt className="font-medium text-ink">Você</dt>
                  <dd className="flex flex-col text-ink-muted">
                    <span data-present={detail.mePresent}>Na sessão: {presenceLabel(detail.mePresent, detail.meEnteredCount)}</span>
                    <span data-testid="my-call-presence">
                      Na chamada: {callVisible ? CALL_STATE_LABEL[call.snapshot.state].toLowerCase() : "fora"}
                    </span>
                  </dd>
                  <dt className="min-w-0 truncate font-medium text-ink">{counterpart}</dt>
                  <dd className="flex flex-col text-ink-muted">
                    <span data-present={detail.otherPresent}>Na sessão: {presenceLabel(detail.otherPresent, detail.otherEnteredCount)}</span>
                    <span data-testid="peer-call-presence">
                      Na chamada: {call.live ? (call.snapshot.remote.present ? "conectado" : "fora") : "aparece quando você entrar"}
                    </span>
                  </dd>
                </dl>
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-ink">{isClient ? "O que a Elyra registra de você" : "O que a pessoa liberou"}</p>
                  {consentListCompact}
                </div>
                {isClient && detail.status !== "cancelled" ? (
                  <Button variant="secondary" onClick={() => setConsentOpen(true)}>
                    Alterar permissões
                  </Button>
                ) : null}
              </CardContent>
            </Card>

            {isClient ? (
              <Card data-testid="session-capture">
                <CardHeader>
                  <CardTitle as="h2">Seu registro</CardTitle>
                  <CardDescription>
                    Só da sua voz e da sua imagem, nunca da outra pessoa. Fica com você e você pode apagar depois.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-start gap-3 text-sm text-ink-muted">
                  {liveCapture ? (
                    <p>Registro em andamento, abaixo da chamada.</p>
                  ) : detail.status !== "active" || !detail.mePresent ? (
                    <p>Registrar fica disponível quando você está dentro da sessão em andamento.</p>
                  ) : !detail.consents.allow_audio && !detail.consents.allow_video ? (
                    <p>
                      Microfone e câmera estão desligados nas permissões. Ligue um deles para registrar; isso vale só
                      para o registro, não para a chamada.
                    </p>
                  ) : (
                    <Button onClick={() => setCaptureOpen(true)} data-testid="start-embedded-capture">
                      {detail.consents.allow_video ? <Video aria-hidden="true" /> : <Mic aria-hidden="true" />}
                      Registrar agora
                    </Button>
                  )}
                  {detail.captureCount > 0 ? (
                    <p>{detail.captureCount === 1 ? "1 registro" : `${detail.captureCount} registros`} desta sessão nas suas Sessões.</p>
                  ) : null}
                </CardContent>
              </Card>
            ) : null}

            {open && (detail.mePresent || (!isClient && detail.status === "active")) ? (
              <div className="flex flex-wrap gap-2">
                {detail.mePresent ? (
                  <Button variant="secondary" disabled={busy !== null} onClick={() => void leaveSession()}>
                    <LogOut aria-hidden="true" />
                    Sair da sessão
                  </Button>
                ) : null}
                {!isClient && detail.status === "active" ? (
                  <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirmEnd(true)}>
                    <Square aria-hidden="true" />
                    Encerrar sessão
                  </Button>
                ) : null}
              </div>
            ) : null}
          </aside>
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" data-layout="columns">
          <div className="flex min-w-0 flex-col gap-5 lg:gap-6">
            <Card data-testid="session-entry">
              <CardHeader>
                <CardTitle as="h2">Entrada</CardTitle>
                <CardDescription>
                  A entrada abre às {formatTime(detail.opensAt, detail.timezone)} e fecha às{" "}
                  {formatTime(detail.closesAt, detail.timezone)}. Entrar registra só a sua presença.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <ul className="flex flex-col divide-y divide-line" aria-label="Presença" aria-live="polite">
                  <li className="flex items-center justify-between gap-3 py-2 first:pt-0">
                    <span className="text-sm font-medium text-ink">Você</span>
                    <PresenceText present={detail.mePresent} entered={detail.meEnteredCount} />
                  </li>
                  <li className="flex items-center justify-between gap-3 py-2 last:pb-0">
                    <span className="min-w-0 truncate text-sm font-medium text-ink">{counterpart}</span>
                    <PresenceText present={detail.otherPresent} entered={detail.otherEnteredCount} />
                  </li>
                </ul>
                <div className="flex flex-wrap gap-2">
                  {open && !detail.mePresent ? (
                    <Button disabled={busy !== null} onClick={() => void act("enter", "Você entrou na sessão.")}>
                      <DoorOpen aria-hidden="true" />
                      {busy === "enter" ? "Entrando…" : detail.meEnteredCount > 0 ? "Entrar de novo" : "Entrar na sessão"}
                    </Button>
                  ) : null}
                  {open && detail.mePresent ? (
                    <Button variant="secondary" disabled={busy !== null} onClick={() => void act("leave", "Você saiu da sessão.")}>
                      <LogOut aria-hidden="true" />
                      Sair da sessão
                    </Button>
                  ) : null}
                  {!isClient && detail.status === "active" ? (
                    <Button variant="secondary" disabled={busy !== null} onClick={() => setConfirmEnd(true)}>
                      <Square aria-hidden="true" />
                      Encerrar sessão
                    </Button>
                  ) : null}
                </div>
                {!open ? closedNote : null}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex gap-3 text-sm leading-6 text-ink-muted">
                <Info aria-hidden="true" className="mt-1 size-4 shrink-0 text-brand-700" />
                <p>
                  Encontro presencial.{" "}
                  {isClient
                    ? "Aqui ficam a presença, as suas permissões e o que você escolher registrar."
                    : "Aqui ficam a presença, as permissões da pessoa e o que ela escolher registrar."}
                </p>
              </CardContent>
            </Card>

            {isClient ? (
              <Card data-testid="session-capture">
                <CardHeader>
                  <CardTitle as="h2">Seu registro</CardTitle>
                  <CardDescription>
                    O que você registrar fica com você, como nas suas sessões pessoais: você pode apagar depois.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col items-start gap-3 text-sm text-ink-muted">
                  {detail.status !== "active" || !detail.mePresent ? (
                    <p>Registrar fica disponível quando você está dentro da sessão em andamento.</p>
                  ) : !detail.consents.allow_audio && !detail.consents.allow_video ? (
                    <p>Microfone e câmera estão desligados nas permissões. Ligue um deles para registrar.</p>
                  ) : (
                    <Button onClick={() => setCaptureOpen(true)}>
                      {detail.consents.allow_video ? <Video aria-hidden="true" /> : <Mic aria-hidden="true" />}
                      Registrar agora
                    </Button>
                  )}
                  {detail.captureCount > 0 ? (
                    <p>{detail.captureCount === 1 ? "1 registro" : `${detail.captureCount} registros`} desta sessão nas suas Sessões.</p>
                  ) : null}
                </CardContent>
              </Card>
            ) : (
              transcriptCard
            )}
          </div>

          <Card data-testid="session-consents">
            <CardHeader>
              <CardTitle as="h2" className="flex items-center gap-2">
                <ShieldCheck aria-hidden="true" className="size-4 text-identity-700" />
                O que está ligado
              </CardTitle>
              <CardDescription>
                {isClient
                  ? "Tudo começa desligado. Só você muda estas permissões, e desligar vale na hora."
                  : "Permissões da pessoa para esta sessão. Só ela pode mudar."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {consentList}
              {isClient && detail.status !== "cancelled" ? (
                <Button variant="secondary" onClick={() => setConsentOpen(true)}>
                  Alterar permissões
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Permissões desta sessão</DialogTitle>
            <DialogDescription>
              {online
                ? "Valem só para o que a Elyra registra. A chamada funciona com tudo desligado."
                : "Cada permissão é independente. Estar na sessão não liga nenhuma delas."}
            </DialogDescription>
          </DialogHeader>
          <ul className="mt-4 flex flex-col gap-3">
            {SESSION_CONSENTS.map((consent) => {
              const copy = SESSION_CONSENT_COPY[consent];
              const on = detail.consents[consent] === true;
              const blocked = !on && copy.requires ? !detail.consents[copy.requires] : false;
              const id = `${baseId}-${consent}`;
              return (
                <li key={consent} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <label htmlFor={id} className="text-sm font-medium text-ink">
                      {copy.label}
                    </label>
                    <p className="text-sm text-ink-muted" id={`${id}-help`}>
                      {blocked
                        ? `Precisa de ${SESSION_CONSENT_COPY[copy.requires!].label.toLowerCase()} ligado antes.`
                        : on
                          ? copy.on
                          : copy.off}
                    </p>
                  </div>
                  <Switch
                    id={id}
                    checked={on}
                    disabled={busy !== null || blocked || (!on && (detail.status === "expired"))}
                    aria-describedby={`${id}-help`}
                    onCheckedChange={(value) => void setConsent(consent, value)}
                  />
                </li>
              );
            })}
          </ul>
          <DialogFooter className="mt-5">
            <Button variant="secondary" onClick={() => setConsentOpen(false)}>
              Concluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CaptureDialog
        detail={detail}
        open={captureOpen}
        onClose={() => setCaptureOpen(false)}
        inCall={online && call.live ? { microphone: call.snapshot.microphone, camera: call.snapshot.camera } : null}
        onStarted={(id, resources) => {
          setCaptureOpen(false);
          setEmbedded({ id, resources });
        }}
      />

      <Dialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encerrar sessão</DialogTitle>
            <DialogDescription>
              Depois de encerrada, ninguém entra de novo nesta sessão{online ? " e a chamada termina para os dois" : ""}. O que a pessoa registrou continua com ela.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-5">
            <Button variant="secondary" onClick={() => setConfirmEnd(false)}>
              Continuar na sessão
            </Button>
            <Button variant="destructive" disabled={busy !== null} onClick={() => void completeSession()}>
              Encerrar sessão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function presenceLabel(present: boolean, entered: number) {
  return present ? "presente" : entered > 0 ? "saiu" : "ainda não entrou";
}

function PresenceText({ present, entered }: { present: boolean; entered: number }) {
  return (
    <span className="text-sm text-ink-muted" data-present={present}>
      {present ? "Presente" : entered > 0 ? "Saiu" : "Ainda não entrou"}
    </span>
  );
}

/**
 * Registrar: cria uma sessao multimodal PESSOAL ligada a esta sessao e segue
 * para a captura existente (mesma permissao do navegador, mesma degradacao
 * honesta quando camera/microfone sao negados). O banco recusa o que as
 * permissoes desta sessao nao cobrem.
 */
function CaptureDialog({
  detail,
  open,
  onClose,
  inCall,
  onStarted,
}: {
  detail: ProfessionalSessionDetail;
  open: boolean;
  onClose: () => void;
  /** PRO-7R: durante a chamada, o registro usa os tracks LOCAIS da chamada. */
  inCall: { microphone: boolean; camera: boolean } | null;
  onStarted: (id: string, resources: CaptureResource[]) => void;
}) {
  const router = useRouter();
  const baseId = useId();
  // `null` = a pessoa ainda nao mexeu: vale a permissao vigente (que pode ter
  // mudado depois de o dialogo montar).
  const [microphoneChoice, setMicrophone] = useState<boolean | null>(null);
  const microphone = microphoneChoice ?? detail.consents.allow_audio;
  const [camera, setCamera] = useState(false);
  const [transcribe, setTranscribe] = useState(false);
  const [keep, setKeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Na chamada, so registra o que esta ligado NA chamada (track local vivo).
  const micAvailable = detail.consents.allow_audio && (inCall ? inCall.microphone : true);
  const camAvailable = detail.consents.allow_video && (inCall ? inCall.camera : true);
  const microphoneOn = microphone && micAvailable;
  const cameraOn = camera && camAvailable;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const session = await schedulingFetch<{ id: string }>("/api/multimodal/sessions", {
        method: "POST",
        body: JSON.stringify({
          kind: "free",
          screen: false,
          camera: cameraOn,
          microphone: microphoneOn,
          transcribe: transcribe && microphoneOn && detail.consents.allow_transcription,
          visualAnalysis: false,
          keepRecording: keep,
          aiAnalysis: false,
          shareResult: false,
          shareTranscript: false,
          shareRecording: false,
          trainingEligible: false,
          professionalSessionId: detail.id,
        }),
      });
      if (inCall) {
        // Na chamada: captura embutida, sem sair da pagina (a chamada segue).
        onStarted(session.id, [
          ...(microphoneOn ? (["microphone"] as const) : []),
          ...(cameraOn ? (["camera"] as const) : []),
        ]);
        setBusy(false);
        return;
      }
      router.push(`/sessoes/nova?id=${session.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `${caught.message} Se o módulo de sessões estiver desligado, ligue-o em Configurações.`
          : "Não foi possível começar.",
      );
      setBusy(false);
    }
  }

  const options: Array<{ key: string; label: string; checked: boolean; set: (v: boolean) => void; enabled: boolean; help: string }> = [
    { key: "mic", label: "Microfone", checked: microphone, set: setMicrophone, enabled: micAvailable, help: !detail.consents.allow_audio ? "Desligado nas permissões." : !micAvailable ? "Ligue o microfone da chamada para registrar a sua voz." : inCall ? "Grava só a sua voz, nunca a da outra pessoa." : "Grava a sua voz." },
    { key: "cam", label: "Câmera", checked: camera, set: setCamera, enabled: camAvailable, help: !detail.consents.allow_video ? "Desligado nas permissões." : !camAvailable ? "Ligue a câmera da chamada para registrar a sua imagem." : inCall ? "Grava só a sua imagem, nunca a da outra pessoa." : "Grava a sua imagem." },
    { key: "asr", label: "Transcrever no aparelho", checked: transcribe, set: setTranscribe, enabled: detail.consents.allow_transcription && microphoneOn, help: detail.consents.allow_transcription ? "O texto da sua fala é gerado no seu aparelho." : "Desligado nas permissões." },
    { key: "keep", label: "Guardar a gravação", checked: keep, set: setKeep, enabled: true, help: "Sem guardar, a mídia não fica salva; só o que você escolher acima." },
  ];

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar nesta sessão</DialogTitle>
          <DialogDescription>
            {inCall
              ? "Usa o microfone e a câmera que já estão na chamada, sem pedir de novo. A chamada continua enquanto você registra."
              : "O navegador vai pedir acesso ao microfone ou à câmera. Se você negar, a sessão continua sem registro."}
          </DialogDescription>
        </DialogHeader>
        <ul className="mt-4 flex flex-col gap-3">
          {options.map((option) => (
            <li key={option.key} className="flex items-start justify-between gap-4">
              <div>
                <label htmlFor={`${baseId}-${option.key}`} className="text-sm font-medium text-ink">
                  {option.label}
                </label>
                <p id={`${baseId}-${option.key}-help`} className="text-sm text-ink-muted">
                  {option.help}
                </p>
              </div>
              <Switch
                id={`${baseId}-${option.key}`}
                checked={option.checked && option.enabled}
                disabled={!option.enabled || busy}
                aria-describedby={`${baseId}-${option.key}-help`}
                onCheckedChange={option.set}
              />
            </li>
          ))}
        </ul>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="mt-5">
          <Button variant="secondary" onClick={onClose}>
            Agora não
          </Button>
          <Button disabled={busy || (!microphoneOn && !cameraOn)} onClick={() => void start()}>
            {busy ? "Preparando…" : "Começar registro"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
