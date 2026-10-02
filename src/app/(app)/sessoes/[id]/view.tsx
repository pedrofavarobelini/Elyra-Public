"use client";

import {
  ArrowLeft,
  BarChart3,
  Download,
  FileText,
  Gauge,
  Hand,
  Lightbulb,
  Mic,
  Move,
  Pause,
  PersonStanding,
  ScanFace,
  Timer,
  Trash2,
  Activity,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/journey/page-header";
import { AsrDiagnosticPanel } from "@/components/asr-diagnostic-panel";
import {
  FeedbackControls,
  TranscriptCorrection,
} from "@/components/feedback-controls";
import type {
  FeedbackView,
  TranscriptCorrectionView,
} from "@/lib/contracts/feedback";
import { asrProvenanceLabel } from "@/lib/contracts/asr-provenance";
import { INTERPRETATION_REASON_LABEL } from "@/lib/contracts/session-analysis";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { NonClinicalNotice } from "@/components/ui/non-clinical-notice";
import {
  SIGNAL_LABEL,
  type ObservableSignalContract,
  type ObservableSignalName,
} from "@/lib/contracts/multimodal-signals";
import {
  CAPTURE_LABEL,
  MEDIA_KIND_LABEL,
  type MultimodalSessionDetail,
} from "@/lib/contracts/session";
import {
  TRANSCRIPT_REASON_LABEL,
  type AnalysisPartState,
  type SessionAnalysisResult,
} from "@/lib/contracts/session-analysis";
import { InlineSpinner } from "@/components/states";

/**
 * Resultado da sessao (figura 7), agora ligado ao dado real.
 *
 * Regras que definem a tela inteira:
 *
 *  - **nenhum numero de emocao detectada.** Todo sinal e descrito como
 *    observavel e comparado a media pessoal de quem fez a sessao, nunca a uma
 *    norma populacional e nunca entre pessoas;
 *  - **ausencia e um estado, nao um zero.** Sinal nao capturado aparece como
 *    "sem registro"; transcricao nao autorizada diz que nao foi autorizada;
 *  - **nada e preenchido para a tela nao ficar vazia.** Se o processamento nao
 *    aconteceu, a tela diz que nao aconteceu.
 *
 * Ver docs/01-Product/Non-Clinical-Language.md e ADR-0005.
 */

const SIGNAL_ICON: Record<ObservableSignalName, typeof BarChart3> = {
  speech_rate: Gauge,
  pause_count: Pause,
  pause_total_duration: Timer,
  pause_mean_duration: Timer,
  vocal_variation: Mic,
  movement_frequency: Activity,
  head_movement_frequency: ScanFace,
  head_motion_amplitude: Move,
  body_movement_frequency: PersonStanding,
  body_motion_amplitude: Move,
  hand_movement_frequency: Hand,
};

export function SessionResultView({
  session,
  analysis,
  feedback = [],
  correction = null,
}: {
  session: MultimodalSessionDetail;
  analysis: SessionAnalysisResult;
  feedback?: FeedbackView[];
  correction?: TranscriptCorrectionView | null;
}) {
  const router = useRouter();
  const [busyAsset, setBusyAsset] = useState<string | null>(null);
  /*
    Estado proprio, e nao o mesmo de abrir.

    Abrir e apagar sao acoes com desfechos opostos sobre a mesma linha, e um
    unico marcador faria o spinner de exclusao aparecer no botao de abrir — a
    tela sugerindo que esta apagando quando esta so gerando uma URL.
  */
  const [deletingAsset, setDeletingAsset] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resources = (["screen", "camera", "microphone"] as const).filter(
    (resource) => session.setup[resource],
  );

  async function openAsset(assetId: string) {
    setBusyAsset(assetId);
    setError(null);
    try {
      const response = await fetch(
        `/api/multimodal/assets/${assetId}/signed-url`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        data?: { url: string; expiresIn: number };
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Mídia indisponível.");
      }
      window.open(payload.data.url, "_blank", "noopener,noreferrer");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mídia indisponível.");
    } finally {
      setBusyAsset(null);
    }
  }


  async function deleteAsset(assetId: string) {
    setDeletingAsset(assetId);
    setError(null);
    try {
      const response = await fetch(`/api/multimodal/assets/${assetId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Não foi possível apagar a gravação.");
      }
      // A lista de midia vem do servidor: recarregar e o que faz a tela dizer a
      // verdade, em vez de remover a linha no cliente e torcer.
      router.refresh();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Não foi possível apagar a gravação.",
      );
    } finally {
      setDeletingAsset(null);
    }
  }

  async function deleteSession() {
    setDeleting(true);
    setError(null);
    try {
      const response = await fetch(`/api/multimodal/sessions/${session.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Exclusão não confirmada.");
      }
      router.push("/sessoes");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Exclusão não confirmada.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <BackLink />
      <PageHeader
        title="Análise da sessão"
        description="Sinais observáveis registrados durante esta sessão, comparados apenas com a sua própria média."
        action={<Badge tone="brand">BETA</Badge>}
      />
      <AsrDiagnosticPanel sessionId={session.id} persistedSegments={analysis.transcriptSegments.length} />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardContent>
            <h2 className="text-base font-semibold text-ink">
              Recursos autorizados
            </h2>
            <ul className="mt-4 flex flex-col gap-3">
              {resources.map((resource) => (
                <li
                  key={resource}
                  className="flex items-center justify-between rounded-control bg-surface-muted px-4 py-3 text-sm"
                >
                  <span>{CAPTURE_LABEL[resource]}</span>
                  <Badge tone="neutral">encerrado</Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="text-base font-semibold text-ink">
              Sinais observáveis
            </h2>
            <p className="mb-4 mt-0.5 text-sm text-ink-muted">
              Medidas do registro da sessão. Isoladamente, elas não determinam um
              estado emocional.
            </p>
            <SignalsSection
              state={analysis.signalsState}
              signals={analysis.signals}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="text-base font-semibold text-ink">Transcrição</h2>
            <p className="mb-4 mt-0.5 text-sm text-ink-muted">
              Texto reconhecido no seu próprio aparelho durante a sessão.
            </p>
            <TranscriptSection
              transcript={analysis.transcript}
              sessionId={session.id}
              feedback={
                feedback.find((entry) => entry.targetType === "transcription") ??
                null
              }
              correction={correction}
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <div className="flex items-start gap-3">
              <IconPill tone="brand" size="lg">
                <Lightbulb />
              </IconPill>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-ink">
                  Interpretação dos sinais
                </h2>
                <InterpretationSection
                  interpretation={analysis.interpretation}
                  sessionId={session.id}
                  feedback={
                    feedback.find(
                      (entry) => entry.targetType === "interpretation",
                    ) ?? null
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <h2 className="text-base font-semibold text-ink">Mídia privada</h2>
            {session.assets.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">
                Nenhum asset foi enviado ao Storage. A gravação em memória foi
                descartada.
              </p>
            ) : (
              <ul className="mt-4 flex flex-col gap-3">
                {session.assets.map((asset) => (
                  <li
                    key={asset.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-line px-4 py-3"
                  >
                    <span className="text-sm text-ink">
                      {MEDIA_KIND_LABEL[asset.mediaKind]} ·{" "}
                      {(asset.sizeBytes / 1024).toFixed(1)} KiB
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busyAsset === asset.id}
                        onClick={() => void openAsset(asset.id)}
                      >
                        {busyAsset === asset.id ? (
                          <InlineSpinner />
                        ) : (
                          <Download aria-hidden="true" />
                        )}
                        Abrir por 60 segundos
                      </Button>
                      {/*
                        O nome acessivel carrega o tipo de midia: com uma
                        gravacao por modalidade, "Apagar gravação" sozinho
                        criaria varios controles indistinguiveis na mesma tela —
                        para leitor de tela e para teste.
                      */}
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={deletingAsset === asset.id}
                        onClick={() => void deleteAsset(asset.id)}
                      >
                        {deletingAsset === asset.id ? (
                          <InlineSpinner />
                        ) : (
                          <Trash2 aria-hidden="true" />
                        )}
                        {`Apagar gravação de ${MEDIA_KIND_LABEL[asset.mediaKind]}`}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {error ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <Button
              className="mt-5"
              variant="destructive"
              disabled={deleting}
              onClick={() => void deleteSession()}
            >
              {deleting ? (
                <InlineSpinner />
              ) : (
                <Trash2 aria-hidden="true" />
              )}
              Excluir sessão e mídia
            </Button>
          </CardContent>
        </Card>
      </div>

      <NonClinicalNotice context="session" className="mt-6" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sinais
// ---------------------------------------------------------------------------

function SignalsSection({
  state,
  signals,
}: {
  state: AnalysisPartState;
  signals: ObservableSignalContract[];
}) {
  if (state !== "available" || signals.length === 0) {
    return (
      <StateNote
        testId="signals-state"
        state={state}
        notAuthorized="A análise por IA não foi autorizada para esta sessão, então nenhum sinal foi derivado."
        pending="Os sinais desta sessão ainda não foram processados. Nenhum valor foi estimado."
        unavailable="Não foi possível derivar sinais desta sessão."
        failed="A derivação de sinais falhou. Nenhum valor foi estimado no lugar."
      />
    );
  }

  return (
    <ul data-testid="signals-state" className="grid gap-4 sm:grid-cols-2">
      {signals.map((signal) => {
        const Icon = SIGNAL_ICON[signal.name] ?? BarChart3;
        return (
          <li
            key={signal.name}
            className="flex flex-col items-start gap-2 rounded-control border border-line p-4"
          >
            <IconPill tone="neutral" size="sm">
              <Icon />
            </IconPill>
            <p className="text-sm text-ink-muted">{SIGNAL_LABEL[signal.name]}</p>
            {signal.value === null ? (
              <p className="text-sm text-ink-subtle">Sem registro</p>
            ) : (
              <p className="flex items-baseline gap-1">
                <span className="text-xl font-semibold text-ink">
                  {formatSignalValue(signal)}
                </span>
                {signalUnitLabel(signal) ? (
                  <span className="text-xs text-ink-muted">
                    {signalUnitLabel(signal)}
                  </span>
                ) : null}
              </p>
            )}
            <p className="text-xs text-ink-subtle">{comparisonText(signal)}</p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Comparacao com a media **pessoal**, e so com ela.
 *
 * Sem baseline nao existe comparacao, e o texto diz exatamente isso em vez de
 * chamar o valor de normal ou alterado. Ausencia de historico nao e "dentro da
 * media" — e ausencia de historico.
 */
function comparisonText(signal: ObservableSignalContract): string {
  if (signal.status === "not_captured") {
    return "Este sinal não foi capturado nesta sessão.";
  }
  if (
    signal.status === "insufficient_baseline" ||
    signal.personalBaselineMean === null ||
    signal.deltaVsPersonalBaseline === null
  ) {
    return "Ainda não há sessões suficientes suas para comparar.";
  }
  if (signal.personalBaselineMean <= 0) {
    return `Comparado com ${signal.personalBaselineSamples} registro(s) seus anteriores.`;
  }
  const relative =
    signal.deltaVsPersonalBaseline / signal.personalBaselineMean;
  const direction =
    Math.abs(relative) < 0.1
      ? "Dentro da sua média pessoal"
      : relative > 0
        ? "Acima da sua média pessoal"
        : "Abaixo da sua média pessoal";
  return `${direction}, sobre ${signal.personalBaselineSamples} registro(s) seus.`;
}

function formatSignalValue(signal: ObservableSignalContract): string {
  const value = signal.value ?? 0;
  if (signal.unit === "index") return value.toFixed(2);
  if (signal.unit === "milliseconds") return formatDuration(value);
  if (signal.unit === "count") return String(Math.round(value));
  return String(Math.round(value));
}

function signalUnitLabel(signal: ObservableSignalContract): string {
  if (signal.unit === "words_per_minute") return "palavras/min";
  if (signal.unit === "count") return "pausas";
  return "";
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

// ---------------------------------------------------------------------------
// Transcricao
// ---------------------------------------------------------------------------

function TranscriptSection({
  transcript,
  sessionId,
  feedback,
  correction,
}: {
  transcript: SessionAnalysisResult["transcript"];
  sessionId: string;
  feedback: FeedbackView | null;
  correction: TranscriptCorrectionView | null;
}) {
  if (transcript.state === "available" && transcript.text !== null) {
    return (
      <>
        <blockquote
          data-testid="transcript-state"
          className="rounded-control bg-surface-muted p-4 text-sm leading-relaxed text-ink"
        >
          {transcript.text}
        </blockquote>
        <p className="mt-2 text-xs text-ink-subtle">
          {transcript.wordCount} palavra(s) reconhecida(s)
          {transcript.truncated ? " · texto truncado no limite do contrato" : ""}
          {" · "}
          {/*
            Proveniencia diz COMO o texto foi produzido, e nunca quao bem.
            Nenhuma taxa de erro de QA aparece aqui: WER medido em laboratorio
            nao e uma afirmacao sobre a fala de ninguem, e exibi-lo ao lado da
            transcricao o transformaria em "confianca clinica".
          */}
          <span data-testid="transcript-provenance">
            {asrProvenanceLabel(transcript.provenance)}
          </span>
          {correction && correction.revokedAt === null
            ? " · revisada por você"
            : ""}
          .
        </p>

        <TranscriptCorrection
          sessionId={sessionId}
          originalText={transcript.text}
          correction={
            correction && correction.revokedAt === null ? correction : null
          }
        />

        <FeedbackControls
          sessionId={sessionId}
          targetType="transcription"
          current={feedback}
        />
      </>
    );
  }

  const reason = transcript.reason
    ? TRANSCRIPT_REASON_LABEL[transcript.reason]
    : null;

  return (
    <StateNote
      testId="transcript-state"
      state={transcript.state}
      icon={<FileText />}
      notAuthorized={reason ?? "A transcrição não foi autorizada para esta sessão."}
      pending="A transcrição desta sessão ainda não foi processada."
      unavailable={reason ?? "Não houve transcrição para esta sessão."}
      failed={reason ?? "O reconhecimento de fala foi interrompido."}
    />
  );
}

// ---------------------------------------------------------------------------
// Interpretacao
// ---------------------------------------------------------------------------

function InterpretationSection({
  interpretation,
  sessionId,
  feedback,
}: {
  interpretation: SessionAnalysisResult["interpretation"];
  sessionId: string;
  feedback: FeedbackView | null;
}) {
  const output = interpretation.output;
  if (interpretation.state !== "available" || output === null) {
    /*
      A mensagem vem da causa nomeada, quando existe.

      Antes, tudo o que nao desse certo virava a mesma frase — inclusive "o
      contrato foi recusado", que descreve uma conversa entre dois sistemas e
      nao diz nada a quem esta lendo. E uma credencial que NOS faltamos
      configurar aparecia como instabilidade do servico, convidando a pessoa a
      tentar de novo mais tarde para sempre.

      A tela agrupa o que nao lhe diz respeito; ela nao aponta a causa para o
      lugar errado.
    */
    const reason = interpretation.reason
      ? INTERPRETATION_REASON_LABEL[interpretation.reason]
      : null;
    return (
      <div className="mt-2">
        <StateNote
          testId="interpretation-state"
          state={interpretation.state}
          notAuthorized={
            reason ?? "A análise por IA não foi autorizada para esta sessão."
          }
          pending="Esta sessão ainda não foi interpretada."
          unavailable={
            reason ??
            "A interpretação está indisponível no momento. Os sinais e a transcrição continuam salvos."
          }
          failed={
            reason ??
            "A interpretação não pôde ser concluída. Os sinais e a transcrição continuam salvos."
          }
        />
        {/*
          Avaliar uma interpretacao que nao existe nao faz sentido; o polegar
          so aparece quando ha o que avaliar.
        */}
      </div>
    );
  }

  return (
    <div data-testid="interpretation-state" className="mt-2">
      <p className="text-sm text-ink-muted">{output.summary}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {output.observations.map((observation) => (
          <li key={observation.text} className="text-sm text-ink-muted">
            {observation.text}
          </li>
        ))}
      </ul>
      <h3 className="mt-4 text-sm font-semibold text-ink">Limitações</h3>
      <ul className="mt-2 flex flex-col gap-1">
        {output.limitations.map((limitation) => (
          <li key={limitation} className="text-xs text-ink-subtle">
            {limitation}
          </li>
        ))}
      </ul>
      <NonClinicalNotice context="session" className="mt-4">
        {output.disclaimer}
      </NonClinicalNotice>

      {/*
        O polegar da interpretacao vive AQUI, e nao junto do da transcricao:
        eles avaliam sistemas diferentes, com modos de errar diferentes.
      */}
      <FeedbackControls
        sessionId={sessionId}
        targetType="interpretation"
        current={feedback}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

/**
 * Renderiza a ausencia como informacao.
 *
 * Existe para que "nao autorizado", "ainda nao processado", "indisponivel" e
 * "falhou" nunca colapsem no mesmo texto vago — e para que nenhum deles seja
 * preenchido com um valor de exemplo.
 */
function StateNote({
  state,
  testId,
  icon,
  notAuthorized,
  pending,
  unavailable,
  failed,
}: {
  state: AnalysisPartState;
  testId: string;
  icon?: React.ReactNode;
  notAuthorized: string;
  pending: string;
  unavailable: string;
  failed: string;
}) {
  const message =
    state === "not_authorized"
      ? notAuthorized
      : state === "pending"
        ? pending
        : state === "failed"
          ? failed
          : unavailable;

  return (
    <p
      data-testid={testId}
      data-state={state}
      className="flex items-start gap-3 rounded-control bg-surface-muted p-4 text-sm text-ink-muted"
    >
      {icon ? (
        <span className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      {message}
    </p>
  );
}

function BackLink() {
  return (
    <Link
      href="/sessoes"
      className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-brand-700 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Voltar para sessões
    </Link>
  );
}
