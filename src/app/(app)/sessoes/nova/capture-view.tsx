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
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type CSSProperties } from "react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  captureCoverageSchema,
  notRequestedCoverage,
  type CaptureAbsenceReason,
  type CaptureCoverage,
  type CapturePartialReason,
} from "@/lib/contracts/capture-coverage";
import {
  CAPTURE_RESOURCES,
  SESSION_KIND_LABEL,
  type CaptureResource,
  type CaptureStateMap,
  type MultimodalSessionDetail,
  MAX_SESSION_MS,
} from "@/lib/contracts/session";
import type {
  SessionAnalysisSubmission,
  TranscriptUnavailableReason,
} from "@/lib/contracts/session-analysis";
import {
  captureErrorState,
  createCaptureRecorder,
  detectCaptureCapabilities,
  initialCaptureStates,
  pauseCaptureRecorder,
  requestCaptureStream,
  resumeCaptureRecorder,
  stopCaptureRecorder,
  stopCaptureTracks,
  type CaptureRecorder,
} from "@/lib/multimodal-capture";
import { buildSignalWindows } from "@/lib/multimodal-timeline";
import {
  ENVELOPE_FRAME_MS,
  FRAME_INTERVAL_MS,
  TRANSCRIPT_MAX_CHARS,
  buildTranscriptSubmission,
  probeLocalSpeechAvailability,
  startAudioEnvelopeCollection,
  startFrameDifferenceCollection,
  startSessionTranscription,
  type AudioEnvelopeCollector,
  type FrameDifferenceCollector,
  type LocalSpeechAvailability,
  type SessionTranscriber,
  type TranscriptCapture,
} from "@/lib/multimodal-derivation";
import {
  computeVoicedDurationMs,
  extractSessionSignals,
} from "@/lib/multimodal-signals";
import { InlineSpinner } from "@/components/states";
import { loadLandmarkEngine } from "@/lib/visual-engine";
import {
  startVisualObservation,
  VISUAL_ANALYSIS_STATE_LABEL,
  VISUAL_LIVE_STATUS_LABEL,
  VISUAL_PAUSED_NOTICE,
  type VisualAnalysisState,
  type VisualLiveStatus,
  type VisualObservationCollector,
} from "@/lib/visual-landmarks";
import { buildVisualCoverage } from "@/lib/visual-signals";
import {
  startBrowserPcmCollection,
  toTranscriptCapture,
} from "@/lib/speech/browser-audio";
import { TranscriptionPreflight, useSpeechPreparation } from "@/components/transcription-preflight";
import { LOCAL_WHISPER_PROVENANCE } from "@/lib/speech/browser-runtime";
import { NATIVE_ASR_PROVENANCE, type AsrProvenance } from "@/lib/contracts/asr-provenance";
import { asrDiagnosticEnabled, newAsrDiagnostic, saveAsrDiagnostic,
  type AsrPhysicalDiagnostic } from "@/lib/speech/physical-diagnostic";
import {
  speechPreparation, speechFailureCapture, transcriptionCanStart,
  SPEECH_FAILURE_LABEL, type SpeechFailure,
} from "@/lib/speech/preparation";
import {
  SPEECH_ENGINE_STATE_LABEL,
  type LocalSpeechEngine,
  type SpeechEngineState,
} from "@/lib/speech/types";
import {
  FINALIZATION_STEP_LABEL,
  advanceFinalization,
  completeFinalization,
  createFinalization,
  finalizationCurrentStep,
  finalizationElapsedSeconds,
  finalizationLabel,
  finalizationPercent,
  finalizationStalled,
  type FinalizationProgress,
  type FinalizationStep,
} from "@/lib/session-finalization";
import { cn } from "@/lib/utils";
import { captureCapability } from "@/lib/capabilities";
import { SESSION_PROMPT, SESSION_TIPS } from "@/mocks/session-data";

/** Teto do contrato de sessao. Uma sessao mais longa e truncada, nunca recusada. */
/*
  Vinculado ao contrato por atribuicao, e nao redigitado.

  O valor precisa ser um `const` de modulo: o compilador do React trata binding
  importado como opaco e, por causa disso, passa a analisar `beginCapture` e
  `collectAnalysis` como codigo de render - reportando `Date.now()` dentro de
  funcoes assincronas que nunca rodam no render. Ligar o import a um `const`
  local devolve a analise correta **sem** recriar a duplicata que faria os dois
  numeros divergirem.
*/
const SESSION_LIMIT_MS: number = MAX_SESSION_MS;

/**
 * Unica leitura de relogio da tela de captura.
 *
 * Um seam so, em escopo de modulo, por duas razoes. A primeira e de analise: o
 * compilador do React nao consegue provar que `Date.now()` chamado no corpo do
 * componente nao roda durante o render, e passa a reprovar leituras que so
 * acontecem em handler assincrono. A segunda e de teste: com uma porta unica,
 * medir tempo passa a ser substituivel sem espalhar injecao por cinco funcoes.
 */
function now(): number {
  return Date.now();
}

/** Relogio monotonico da analise visual (L-396): MediaPipe exige tempo que nunca regride. */
function monotonicNow(): number {
  return performance.now();
}

const WAVEFORM = [
  4, 9, 14, 22, 17, 10, 6, 12, 20, 28, 24, 15, 9, 5, 11, 19, 26, 30,
  23, 16, 10, 6, 13, 21, 27, 22, 14, 8, 5, 10, 18, 25, 20, 12, 7, 4,
] as const;

const RESOURCE_UI = {
  screen: { icon: Monitor, label: "Tela" },
  camera: { icon: Camera, label: "Câmera" },
  microphone: { icon: Mic, label: "Microfone" },
} as const;

const CAPTURE_STATE_LABEL: Record<CaptureStateMap[CaptureResource], string> = {
  supported: "Suportado — aguardando início",
  unsupported: "Não suportado neste navegador",
  permission_pending: "Permissão pendente",
  granted: "Captura ativa",
  denied: "Permissão negada",
  cancelled: "Seleção cancelada",
  ended: "Captura encerrada pelo navegador",
  error: "Falha de captura",
};

function captureStateText(
  resource: CaptureResource,
  state: CaptureStateMap[CaptureResource],
): string {
  if (["unsupported", "denied", "cancelled", "ended", "error"].includes(state)) {
    const assessment = captureCapability(resource, state);
    return assessment.alternative
      ? `${assessment.reason} ${assessment.alternative}`
      : assessment.reason;
  }
  return CAPTURE_STATE_LABEL[state];
}

/**
 * Falha de transporte (rede caiu), e nao recusa do servidor (OFF-3, L-407).
 * `fetch` que rejeita e TypeError; sem rede no aparelho, `onLine` e false.
 */
function isNetworkFailure(reason: unknown): boolean {
  return reason instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json()) as { data?: T; error?: string };
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error ?? "Operação multimodal indisponível.");
  }
  return payload.data;
}

/** Etapa em que a sincronizacao da finalizacao falhou. */
class FinalizationSyncError extends Error {
  constructor(readonly stage: "status" | "analysis", readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : "A sessão não pôde ser sincronizada.");
  }
}

/**
 * Reenvio da finalizacao (OFF-3). Idempotente: `completed -> completed` e
 * permitido pelo banco e a analise e upsert por chave natural — repetir nunca
 * cria duas finalizacoes.
 */
async function sendFinalization(sessionId: string, submission: SessionAnalysisSubmission | null) {
  let updated: MultimodalSessionDetail;
  try {
    updated = await requestJson<MultimodalSessionDetail>(`/api/multimodal/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
  } catch (reason) {
    throw new FinalizationSyncError("status", reason);
  }
  if (submission) {
    try {
      await requestJson(`/api/multimodal/sessions/${sessionId}/analysis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(submission),
      });
    } catch (reason) {
      throw new FinalizationSyncError("analysis", reason);
    }
  }
  return updated;
}

/**
 * Estado de cobertura de uma modalidade durante a captura.
 *
 * Vive no escopo do modulo, e nao dentro do componente, porque mexe com relogio:
 * uma funcao sincrona e impura no corpo do componente e analisada como codigo de
 * render, e o compilador do React recusa - com razao, porque render precisa ser
 * reproduzivel.
 */
interface CoverageEntry {
  startedAt: number;
  endedAt: number | null;
  reason: CapturePartialReason | CaptureAbsenceReason | null;
}

/**
 * Marca o instante em que uma modalidade parou de cobrir a sessao.
 *
 * Idempotente: o primeiro motivo vence. Uma track encerrada logo depois de a
 * gravacao bater no teto nao deve reescrever `recording_capped` para
 * `interrupted` - o que aconteceu primeiro e o que explica a cobertura.
 */
function markCoverageEnd(
  entries: Map<CaptureResource, CoverageEntry>,
  resource: CaptureResource,
  reason: CapturePartialReason,
  now: number,
) {
  const entry = entries.get(resource);
  if (!entry || entry.endedAt !== null) return;
  entries.set(resource, { ...entry, endedAt: now, reason });
}

/**
 * Fecha a cobertura das tres modalidades contra a duracao real da sessao.
 *
 * Toda modalidade aparece, inclusive a que a pessoa nem autorizou: ausencia de
 * entrada nao distingue "nao foi pedida" de "foi pedida e falhou", e essa
 * distincao e o que impede o profissional de supor ausencia de registro onde ha
 * ausencia de permissao.
 *
 * O desfecho vem do **evento**, e nunca de um limiar sobre a razao: quem parou
 * antes e parcial, quem nao comecou e ausente, o resto e completo.
 */
function buildCoverage(
  entries: Map<CaptureResource, CoverageEntry>,
  sessionStartedAt: number,
  durationMs: number,
): CaptureCoverage[] {
  const endOfSession = sessionStartedAt + durationMs;
  return CAPTURE_RESOURCES.map((resource) => {
    const entry = entries.get(resource);
    if (!entry) return notRequestedCoverage(resource, durationMs);
    if (entry.startedAt === 0 && entry.endedAt === 0) {
      return captureCoverageSchema.parse({
        modality: resource,
        outcome: "absent",
        reason: entry.reason ?? "error",
        coverageMs: 0,
        sessionDurationMs: durationMs,
      });
    }
    const stoppedAt = entry.endedAt ?? endOfSession;
    const coveredMs = Math.min(
      Math.max(0, Math.round(stoppedAt - entry.startedAt)),
      durationMs,
    );
    const partial = entry.endedAt !== null && entry.reason !== null;
    return captureCoverageSchema.parse({
      modality: resource,
      outcome: partial ? "partial" : "full",
      reason: partial ? entry.reason : null,
      coverageMs: partial ? coveredMs : durationMs,
      sessionDurationMs: durationMs,
    });
  });
}

/**
 * PRO-7R: captura DENTRO de uma chamada profissional.
 *
 * A chamada ja tem os tracks locais abertos; a captura recebe CLONES deles por
 * `acquireStream` e nunca chama `getUserMedia` de novo (nem pede permissao de
 * novo). So o track LOCAL chega aqui - quem monta o stream e o `CallAdapter`,
 * que recusa participante remoto. Sessao pessoal (sem `embedded`) nao muda.
 */
export type EmbeddedCaptureOptions = {
  sessionId: string;
  acquireStream: (resource: CaptureResource) => Promise<MediaStream>;
  onExit: (outcome: "finished" | "cancelled") => void;
};

export function Stage11LiveCaptureView({ embedded }: { embedded?: EmbeddedCaptureOptions } = {}) {
  const router = useRouter();
  const urlSessionId = useSearchParams().get("id");
  const sessionId = embedded ? embedded.sessionId : urlSessionId;
  // Sair da captura: na chamada, volta para a chamada; fora dela, navega.
  const exitTo = (href: string, outcome: "finished" | "cancelled") => {
    if (embedded) embedded.onExit(outcome);
    else router.push(href as Parameters<typeof router.push>[0]);
  };
  const [session, setSession] = useState<MultimodalSessionDetail | null>(null);
  const [captureStates, setCaptureStates] = useState<CaptureStateMap>({
    screen: "unsupported",
    camera: "unsupported",
    microphone: "unsupported",
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorders = useRef(new Map<CaptureResource, CaptureRecorder>());
  const screenVideo = useRef<HTMLVideoElement>(null);
  const cameraVideo = useRef<HTMLVideoElement>(null);

  // Derivacao on-device (ADR-0005). Vive em refs porque e maquinaria de captura,
  // nao estado de render: um re-render nao pode reiniciar a coleta.
  const transcriber = useRef<SessionTranscriber | null>(null);
  const transcriptFallback = useRef<TranscriptUnavailableReason | null>(null);
  const envelope = useRef<AudioEnvelopeCollector | null>(null);
  const frames = useRef<FrameDifferenceCollector | null>(null);
  const startedAt = useRef(0);
  const pendingAnalysis = useRef<SessionAnalysisSubmission | null>(null);
  const [analysisRetry, setAnalysisRetry] = useState(false);
  /*
    OFF-3: sessao finalizada NESTE aparelho, aguardando rede para sincronizar
    (status `completed` + analise). A medida fica so em memoria
    (`pendingAnalysis`): nada de midia, frame ou landmark vai para disco.
  */
  const [awaitingSync, setAwaitingSync] = useState(false);
  const syncInFlight = useRef(false);

  const syncFinalization = async () => {
    if (!session || syncInFlight.current) return;
    syncInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const updated = await sendFinalization(session.id, pendingAnalysis.current);
      setSession(updated);
      pendingAnalysis.current = null;
      setAwaitingSync(false);
      exitTo(`/sessoes/${session.id}`, "finished");
    } catch (caught) {
      const reason = caught instanceof FinalizationSyncError ? caught.reason : caught;
      if (isNetworkFailure(reason)) return;
      if (caught instanceof FinalizationSyncError && caught.stage === "analysis") {
        // O servidor recusou o processamento: o caminho honesto ja existente.
        setAwaitingSync(false);
        setAnalysisRetry(true);
      }
      setError(reason instanceof Error ? reason.message : "A sessão não pôde ser sincronizada.");
    } finally {
      syncInFlight.current = false;
      setBusy(false);
    }
  };

  // OFF-3: com a aba aberta, a rede voltando dispara o reenvio; fechar a aba
  // antes disso perde a sincronizacao (a medida so existe em memoria) — avisa.
  useEffect(() => {
    if (!awaitingSync) return;
    const onOnline = () => void syncFinalization();
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- o reenvio le o estado atual da sessao
  }, [awaitingSync]);

  const [uploadWarning, setUploadWarning] = useState<string | null>(null);

  /**
   * Progresso do encerramento (L-158). `null` fora do encerramento.
   *
   * A ref e a fonte da verdade e o estado e o espelho de render: o caminho de
   * erro precisa saber em qual etapa parou sem depender de um render ter
   * acontecido. `finalizeInFlight` impede um segundo encerramento quando dois
   * cliques chegam antes de o botao sumir.
   */
  const [finalization, setFinalization] = useState<FinalizationProgress | null>(null);
  const finalizationRef = useRef<FinalizationProgress | null>(null);
  const finalizeInFlight = useRef(false);
  /** Relogio de exibicao: move o tempo decorrido e o aviso de demora, nunca o percentual. */
  const [finalizationClock, setFinalizationClock] = useState(0);

  /**
   * Autorrelato da sessao (`ADR-0008`).
   *
   * Nasce vazio e **continua opcional**: a sessao nao pode ficar presa atras de
   * formulario. Campo em branco vira `null`, e nunca `0` - "nao quis dizer" e
   * uma afirmacao diferente de "estava no minimo".
   */
  const [selfMood, setSelfMood] = useState<string>("");
  const [selfAnxiety, setSelfAnxiety] = useState<string>("");
  const [selfEnergy, setSelfEnergy] = useState<string>("");

  /*
    Cobertura por modalidade. Vive em ref pelo mesmo motivo dos coletores: e
    maquinaria de captura, e um re-render nao pode reiniciar a contagem.

    `startedAt` marca quando a modalidade comecou; `endedAt` quando ela parou
    antes do fim, com o motivo. `null` em `endedAt` significa que ela acompanhou
    a sessao ate o encerramento.
  */
  /** `true` a partir do encerramento deliberado da sessao. Ver `markCoverageEnd`. */
  const finishing = useRef(false);

  const coverage = useRef(new Map<CaptureResource, CoverageEntry>());

  /*
    Analise visual, isolada da captura de proposito.

    `VISUAL ANALYSIS FAILURE != CAMERA FAILURE != SESSION FAILURE`. O coletor
    tem ciclo de vida proprio, estado proprio e caminho de erro proprio: se o
    modelo nao carregar ou quebrar no meio, a camera continua, a gravacao
    continua, o microfone continua e a sessao continua. O que muda e uma palavra
    na tela.
  */
  const visualCollector = useRef<VisualObservationCollector | null>(null);
  const [visualState, setVisualState] = useState<VisualAnalysisState>("unavailable");
  // Status ao vivo do coletor (L-396): preparando, ativa, reduzida, pausada...
  const [visualLive, setVisualLive] = useState<VisualLiveStatus | null>(null);
  /*
    Geracao da analise visual. Encerrar, sair da tela ou parar a camera
    incrementa; um motor que termine de carregar depois disso ve a geracao
    trocada e e descartado sem processar nada.
  */
  const visualGeneration = useRef(0);
  // Relogio monotonico da analise visual, alinhado ao inicio da sessao.
  const visualClockOrigin = useRef(0);
  /**
   * Disponibilidade do reconhecimento local, para a tela poder dizer a verdade.
   *
   * `null` enquanto a sonda nao respondeu. A pessoa precisa saber que a
   * transcricao nao vai acontecer **durante** a sessao, e nao so no relatorio.
   */
  const [localSpeech, setLocalSpeech] = useState<LocalSpeechAvailability | null>(
    null,
  );

  /*
    Fallback local de reconhecimento.

    Ele so entra em cena quando o nativo **nao** pode ser provado local. A ordem
    e obrigatoria e nunca inverte: nativo com processamento local provado, senao
    modelo local, e nunca nada remoto.
  */
  const pcm = useRef<ReturnType<typeof startBrowserPcmCollection> | null>(null);
  const localEngine = useRef<LocalSpeechEngine | null>(null);
  const releaseLocal = useRef<(() => void) | null>(null);
  const localFailure = useRef<SpeechFailure | null>(null);
  const asrDiagnostic = useRef<AsrPhysicalDiagnostic | null>(null);
  const [asrFailure, setAsrFailure] = useState<SpeechFailure | null>(null);
  const preparation = useSpeechPreparation();
  const [asrState, setAsrState] = useState<SpeechEngineState>("unavailable");

  const paused = session?.status === "paused";
  const recording = session?.status === "capturing" || paused;

  useEffect(() => {
    if (!session?.setup.transcribe || recording) return;
    let active = true;
    void probeLocalSpeechAvailability().then((value) => { if (active) setLocalSpeech(value); });
    return () => { active = false; };
  }, [session?.setup.transcribe, recording]);

  function failLocal(reason: SpeechFailure) {
    localFailure.current = reason;
    setAsrFailure(reason);
    setAsrState("failed");
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setCaptureStates(initialCaptureStates(detectCaptureCapabilities()));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  /*
    A ausencia de `sessionId` e conhecida **durante o render**: ela vem da URL, e
    nao de I/O. Descobri-la num efeito obrigava um `setState` sincrono que faz o
    componente renderizar duas vezes para dizer algo que a primeira ja sabia - e
    e por isso que o compilador reclama. A condicao passou a ser derivada, e o
    efeito so cuida do que depende de rede.
  */
  const missingSession = !sessionId;

  useEffect(() => {
    if (!sessionId) return;
    let active = true;
    void requestJson<MultimodalSessionDetail>(
      `/api/multimodal/sessions/${sessionId}`,
    )
      .then((data) => {
        if (active) setSession(data);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Sessão indisponível.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!recording || paused) return;
    const id = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(id);
  }, [paused, recording]);

  const finalizing = finalization !== null;
  useEffect(() => {
    if (!finalizing) return;
    const id = setInterval(() => setFinalizationClock(now()), 1000);
    return () => clearInterval(id);
  }, [finalizing]);

  useEffect(() => {
    const active = {
      transcriber,
      envelope,
      frames,
      recorders,
      visualCollector,
      visualGeneration,
      pcm,
      releaseLocal,
    };
    return () => {
      for (const handle of active.recorders.current.values()) {
        stopCaptureTracks(handle.stream);
      }
      // Sair da tela encerra a derivacao junto com a captura: nenhum coletor
      // sobrevive ao componente amostrando microfone ou camera.
      active.envelope.current?.stop();
      active.frames.current?.stop();
      // O coletor visual segura o motor de landmarks, que segura WASM e GPU.
      // Deixa-lo vivo depois do componente manteria inferencia rodando sobre um
      // `<video>` orfao - custo de bateria por nada, e amostragem sem sessao.
      active.visualGeneration.current += 1;
      active.visualCollector.current?.stop();
      active.visualCollector.current = null;
      // Coleta de PCM e download de modelo tambem morrem com a tela.
      active.pcm.current?.stop();
      active.pcm.current = null;
      active.releaseLocal.current?.();
      void active.transcriber.current?.stop().catch(() => undefined);
    };
  }, []);

  /*
    A guarda de sessao ausente vem **antes** da de carregamento: sem `id` na URL
    nao ha o que carregar, e mostrar "Preparando sessao segura..." para sempre
    seria mentir sobre um estado que ja se conhece.
  */
  if (missingSession) {
    return (
      <Card>
        <CardContent>
          <h1 className="text-xl font-semibold text-ink">Sessão indisponível</h1>
          <p role="alert" className="mt-2 text-sm text-ink-muted">
            Sessão ausente. Volte e prepare uma nova sessão.
          </p>
          <Button className="mt-4" onClick={() => exitTo("/sessoes", "cancelled")}>
            Voltar para sessões
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 text-ink-muted">
          <InlineSpinner size="lg" />
          Preparando sessão segura...
        </CardContent>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card>
        <CardContent>
          <h1 className="text-xl font-semibold text-ink">Sessão indisponível</h1>
          <p role="alert" className="mt-2 text-sm text-ink-muted">{error}</p>
          <Button className="mt-4" onClick={() => exitTo("/sessoes", "cancelled")}>
            Voltar para sessões
          </Button>
        </CardContent>
      </Card>
    );
  }

  const prompt = SESSION_PROMPT[session.kind] ?? SESSION_PROMPT.guided;
  const selectedResources = CAPTURE_RESOURCES.filter(
    (resource) => session.setup[resource],
  );

  async function patchStatus(
    status: "capturing" | "paused" | "completed" | "cancelled" | "error",
  ) {
    if (!session) return;
    const updated = await requestJson<MultimodalSessionDetail>(
      `/api/multimodal/sessions/${session.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    setSession(updated);
  }

  async function beginCapture() {
    if (!session) return;
    setBusy(true);
    setError(null);
    // Revalida antes de getUserMedia: reload/URL direta nao contornam o preflight.
    const availability = session.setup.transcribe ? await probeLocalSpeechAvailability() : null;
    setLocalSpeech(availability);
    if (!transcriptionCanStart(session.setup.transcribe, availability, speechPreparation.getSnapshot())) {
      setError("A transcrição ainda não está pronta. Prepare antes de solicitar o microfone.");
      setBusy(false);
      return;
    }
    startedAt.current = now();
    visualClockOrigin.current = monotonicNow();
    const attempts = selectedResources.map(async (resource) => {
      if (captureStates[resource] === "unsupported") return false;
      setCaptureStates((current) => ({
        ...current,
        [resource]: "permission_pending",
      }));
      try {
        const stream = embedded
          ? await embedded.acquireStream(resource)
          : await requestCaptureStream(resource);
        const handle = createCaptureRecorder(
          resource,
          stream,
          undefined,
          // Gravacao no teto de tamanho: cobertura **parcial por limite
          // declarado**, e nao por perda. A sessao e a analise seguem inteiras.
          (capped) => {
            if (finishing.current) return;
            markCoverageEnd(coverage.current, capped, "recording_capped", now());
          },
        );
        recorders.current.set(resource, handle);
        coverage.current.set(resource, {
          startedAt: Date.now(),
          endedAt: null,
          reason: null,
        });
        for (const track of stream.getTracks()) {
          track.addEventListener("ended", () => {
            setCaptureStates((current) => ({ ...current, [resource]: "ended" }));
            // Track encerrada antes do fim: cobertura parcial por **perda**.
            if (!finishing.current) {
              markCoverageEnd(coverage.current, resource, "interrupted", now());
            }
          }, { once: true });
        }
        if (resource === "screen" && screenVideo.current) {
          screenVideo.current.srcObject = stream;
          await screenVideo.current.play().catch(() => undefined);
        }
        if (resource === "camera" && cameraVideo.current) {
          cameraVideo.current.srcObject = stream;
          await cameraVideo.current.play().catch(() => undefined);
          frames.current = startFrameDifferenceCollection(cameraVideo.current);
          /*
            A analise visual sobe **depois** da camera e por um caminho proprio,
            sem `await` que possa atrasar o inicio da sessao: carregar 21 MB de
            WASM e modelo leva segundos, e prender a sessao atras disso faria a
            pessoa esperar por um recurso acessorio.

            Nada aqui pode lancar para fora: `loadLandmarkEngine` devolve motivo
            em vez de excecao, e o `catch` final existe so para o caso de o
            proprio `import()` falhar.
          */
          if (session?.setup.visualAnalysis) {
            void startVisualAnalysis(cameraVideo.current);
          }
        }
        if (resource === "microphone") {
          envelope.current = startAudioEnvelopeCollection(stream);
          if (session?.setup.transcribe) {

            const started = availability === "available" ? startSessionTranscription({
              elapsedMs: () => Math.max(0, now() - startedAt.current),
              localAvailability: availability,
            }) : null;
            transcriber.current = started;
            setLocalSpeech(availability);

            /*
              Sem reconhecimento nativo local, o PCM comeca a ser coletado **em
              memoria** para o modelo local poder transcrever no fim da sessao.

              Coletar nao e transcrever, e nao e reter: nada disso e persistido, e
              `keepRecording` continua sendo uma decisao separada. Se o modelo nao
              estiver disponivel, o PCM simplesmente e descartado no fim.
            */
            if (availability !== "available") {
              asrDiagnostic.current = asrDiagnosticEnabled() ? newAsrDiagnostic() : null;
              pcm.current = startBrowserPcmCollection(stream);
              try {
                const attached = speechPreparation.attach(pcm.current, failLocal, asrDiagnostic.current ?? undefined);
                if (attached) {
                  localEngine.current = attached.engine;
                  releaseLocal.current = attached.release;
                  setAsrState("active");
                }
              } catch { failLocal("local_asr_runtime_failed"); }
            }
            // Sem Web Speech API a sessao segue valida e a transcricao viaja
            // como indisponivel. Nao existe caminho que invente texto aqui.
            transcriptFallback.current = started || availability !== "available"
              ? null
              : "speech_api_unsupported";
          }
        }
        setCaptureStates((current) => ({ ...current, [resource]: "granted" }));
        return true;
      } catch (reason) {
        const state = captureErrorState(resource, reason);
        setCaptureStates((current) => ({ ...current, [resource]: state }));
        /*
          Modalidade que nunca produziu nada tambem entra na cobertura, com o
          motivo. Ausencia de linha nao distingue "nao foi pedida" de "foi pedida
          e o navegador recusou", e o dossie profissional precisa dessa
          diferenca.
        */
        coverage.current.set(resource, {
          startedAt: 0,
          endedAt: 0,
          reason:
            state === "unsupported"
              ? "unsupported"
              : state === "denied"
                ? "denied"
                : state === "cancelled"
                  ? "cancelled"
                  : "error",
        });
        return false;
      }
    });
    const outcomes = await Promise.all(attempts);
    try {
      await patchStatus(outcomes.some(Boolean) ? "capturing" : "cancelled");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao iniciar captura.");
    } finally {
      setBusy(false);
    }
  }

  async function togglePause() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      if (paused) {
        for (const handle of recorders.current.values()) resumeCaptureRecorder(handle);
        await patchStatus("capturing");
      } else {
        for (const handle of recorders.current.values()) pauseCaptureRecorder(handle);
        await patchStatus("paused");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Falha ao alterar captura.");
    } finally {
      setBusy(false);
    }
  }


  async function stopRecording(resource: CaptureResource, handle: CaptureRecorder) {
    const result = await stopCaptureRecorder(handle);
    stopCaptureTracks(handle.stream);
    setCaptureStates((current) => ({ ...current, [resource]: "ended" }));
    return result;
  }

  async function uploadRecording(
    resource: CaptureResource,
    blob: Blob,
    durationMs: number,
  ) {
    if (!session) return;
    if (!session.setup.keepRecording || blob.size === 0) return;
    const form = new FormData();
    const extension = blob.type.includes("mp4")
      ? "mp4"
      : blob.type.includes("ogg")
        ? "ogg"
        : "webm";
    form.set("sessionId", session.id);
    form.set("mediaKind", resource);
    form.set("durationMs", String(durationMs));
    form.set("file", new File([blob], `${resource}.${extension}`, { type: blob.type }));
    await requestJson("/api/multimodal/assets", { method: "POST", body: form });
  }

  /**
   * Sobe a analise visual, ou registra por que nao subiu.
   *
   * **Nunca lanca e nunca encerra nada.** Cada desfecho vira um estado nomeado:
   * `unsupported` para navegador sem WebAssembly, `failed` para modelo que nao
   * carregou ou ativo ausente, `available` quando o coletor comecou a amostrar.
   * Nenhum deles interrompe camera, gravacao, microfone, transcricao ou sessao.
   */
  async function startVisualAnalysis(video: HTMLVideoElement) {
    const generation = visualGeneration.current;
    const cancelled = () => generation !== visualGeneration.current;
    setVisualLive("preparing");
    try {
      const { engine, failure } = await loadLandmarkEngine(video, { cancelled });
      if (cancelled()) {
        engine?.close();
        return;
      }
      if (!engine) {
        setVisualLive(null);
        setVisualState(failure === "unsupported" ? "unsupported" : "failed");
        return;
      }
      const collector = startVisualObservation({
        engine,
        // Monotonico (performance.now), nunca relogio de parede: MediaPipe exige
        // timestamps crescentes e o Date.now pode regredir com ajuste de relogio.
        now: () => Math.max(0, monotonicNow() - visualClockOrigin.current),
        onStatus: (status) => {
          if (!cancelled()) setVisualLive(status);
        },
      });
      visualCollector.current = collector;
      setVisualState(collector.state());
      setVisualLive(collector.status());
    } catch {
      if (!cancelled()) {
        setVisualLive(null);
        setVisualState("failed");
      }
    }
  }

  /**
   * Registra um marco real do encerramento e cede o thread para a tela pintar.
   *
   * Ceder importa porque parte do encerramento e sincrona e pesada (sinais e
   * janelas): sem a pausa, o rotulo da etapa so apareceria depois dela.
   */
  async function milestone(step: FinalizationStep) {
    const current = finalizationRef.current;
    if (!current) return;
    const next = advanceFinalization(current, step, now());
    if (next === current) return;
    finalizationRef.current = next;
    setFinalization(next);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  /**
   * Encerra a derivacao on-device e monta a submissao.
   *
   * O navegador **mede**: envoltoria RMS, diferenca de quadro e texto
   * reconhecido. Ele nao compara nada com o historico da pessoa — a baseline
   * pessoal e montada no servidor, a partir das sessoes anteriores. Por isso so
   * `name` e `value` atravessam a fronteira.
   */
  async function collectAnalysis(
    captured: CaptureResource[],
  ): Promise<SessionAnalysisSubmission | null> {
    const audio = envelope.current?.stop() ?? {
      envelope: [] as number[],
      frameMs: ENVELOPE_FRAME_MS,
    };
    envelope.current = null;
    const visual = frames.current?.stop() ?? { frameDifferences: [] as number[] };
    frames.current = null;

    /*
      O coletor visual devolve amostras **ja minimizadas**: sete escalares por
      amostra, nenhum deles coordenada. Nao existe ponto neste componente em que
      geometria facial ou corporal esteja disponivel - a reducao aconteceu
      dentro do adapter, no tick que a produziu.
    */
    visualGeneration.current += 1;
    const observation = visualCollector.current?.stop() ?? null;
    visualCollector.current = null;
    const visualAnalysis = session?.setup.visualAnalysis === true;
    const visualSamples = observation?.samples ?? [];

    await milestone("consolidating_transcript");
    let capture: TranscriptCapture | null = null;

    let provenance: AsrProvenance | null = null;
    if (transcriber.current) {
      capture = await transcriber.current.stop();
      if (capture.status === "available") provenance = NATIVE_ASR_PROVENANCE;
      transcriber.current = null;
    } else if (transcriptFallback.current) {
      capture = { status: "unavailable", reason: transcriptFallback.current };
    }
    transcriptFallback.current = null;

    /*
      Fallback local, so quando o nativo nao produziu nada aproveitavel.

      O motor devolve **apenas trechos aceitos** - o que o VAD recusou e o que a
      regra de aceitacao descartou nao aparece aqui, e `discardedText` nao tem
      caminho para a submissao.
    */
    const preparationState = speechPreparation.getSnapshot();
    if (session?.setup.transcribe && localSpeech !== "available" &&
        (preparationState.status === "preparing" || preparationState.status === "cancelling")) {
      // Defesa de encerramento: cancela o preparo existente, nao inicia carga ou espera indefinidamente.
      speechPreparation.cancel();
      failLocal("local_asr_cancelled");
    }
    if (localEngine.current && capture?.status !== "available" && !localFailure.current) {
      try {
        const result = await localEngine.current.stop();
        if (result.status === "available") {
          capture = toTranscriptCapture(result.transcription, TRANSCRIPT_MAX_CHARS);
          if (capture.status === "available") provenance = LOCAL_WHISPER_PROVENANCE;
        } else {
          capture = { status: result.status, reason: result.reason };
        }
      } catch {
        // ASR_FAILURE != SESSION_FAILURE.
        capture = { status: "failed", reason: "recognition_failed" };
      }
      localEngine.current = null;
    }
    if (session?.setup.transcribe && localSpeech !== "available" && !capture && !localFailure.current) {
      failLocal("local_asr_preparation_required");
    }
    if (localFailure.current) capture = speechFailureCapture(localFailure.current);
    releaseLocal.current?.();
    releaseLocal.current = null;
    // PCM que nao foi consumido some com a sessao: nada e persistido.
    pcm.current?.stop();
    pcm.current = null;

    if (captured.length === 0) return null;
    await milestone("consolidating_signals");

    const durationMs = Math.min(
      Math.max(0, now() - startedAt.current),
      SESSION_LIMIT_MS,
    );
    const voicedDurationMs = computeVoicedDurationMs(
      audio.envelope,
      audio.frameMs,
    );
    const transcript = buildTranscriptSubmission(
      capture,
      voicedDurationMs,
      durationMs,
      provenance,
    );
    if (session && asrDiagnostic.current) {
      asrDiagnostic.current.sessionDurationMs = durationMs;
      asrDiagnostic.current.finalTranscriptStatus = transcript?.status ?? "unknown";
      saveAsrDiagnostic(session.id, asrDiagnostic.current);
      asrDiagnostic.current = null;
    }
    const voiced = Math.min(Math.round(voicedDurationMs), durationMs);

    const signals = extractSessionSignals({
      capturedResources: captured,
      visualAnalysis,
      visualSamples,
      audioEnvelope: audio.envelope,
      audioFrameMs: audio.frameMs,
      frameDifferences: visual.frameDifferences,
      wordCount:
        transcript?.status === "available" ? transcript.wordCount : null,
      voicedDurationMs: voiced > 0 ? voiced : null,
      // Historico vazio de proposito: quem conhece as sessoes anteriores e o
      // servidor. O cliente nunca declara a media pessoal de ninguem.
      history: {},
      excludePauses: embedded !== undefined,
    });

    /*
      As janelas saem dos **mesmos** vetores que produzem o agregado, fatiados
      por tempo. Nao ha segundo motor: `buildSignalWindows` chama as mesmas
      funcoes de `multimodal-signals`, e por isso a serie e o agregado nunca
      podem discordar por construcao.
    */
    const windows = buildSignalWindows({
      durationMs,
      capturedResources: captured,
      audioEnvelope: audio.envelope,
      audioFrameMs: audio.frameMs,
      frameDifferences: visual.frameDifferences,
      frameIntervalMs: FRAME_INTERVAL_MS,
      visualAnalysis,
      visualSamples,
      excludePauses: embedded !== undefined,
    });

    const transcriptSegments =
      capture?.status === "available"
        ? capture.segments
            .filter((segment) => segment.endOffsetMs <= durationMs)
            .map((segment, index) => ({
              index,
              text: segment.text.slice(0, 2000),
              startOffsetMs: segment.startOffsetMs,
              recognizedAtOffsetMs: segment.endOffsetMs,
            }))
        : [];

    const score = (raw: string): number | null => {
      const trimmed = raw.trim();
      if (trimmed === "") return null;
      const value = Number(trimmed);
      return Number.isInteger(value) && value >= 0 && value <= 10 ? value : null;
    };
    const mood = score(selfMood);
    const perceivedAnxiety = score(selfAnxiety);
    const energy = score(selfEnergy);
    // Autorrelato vazio nao e autorrelato: ausencia de resposta e ausencia de
    // linha, e nao uma linha de zeros.
    const selfReport =
      mood === null && perceivedAnxiety === null && energy === null
        ? null
        : { mood, perceivedAnxiety, energy };

    return {
      durationMs,
      capturedResources: captured,
      selfReport,
      visualAnalysis,
      /*
        Cobertura das tres modalidades visuais ao lado das tres de captura.
        Elas nao sao redundantes: `camera = full` diz que a camera esteve ligada
        a sessao inteira, `visual_face = partial` diz por quanto tempo houve
        rosto observavel nela.
      */
      coverage: [
        ...buildCoverage(coverage.current, startedAt.current, durationMs),
        ...(captured.includes("camera")
          ? buildVisualCoverage(
              {
                state: visualAnalysis ? (observation?.state ?? "failed") : "unavailable",
                samples: visualSamples,
                /*
                  Janela real de observacao, e nao a sessao inteira. O motor
                  visual sobe depois da camera - carregar WASM e modelo leva
                  segundos - e sem estes dois instantes a cobertura declararia
                  como observado um trecho em que nao havia observador.
                */
                observationStartMs: observation?.observationStartMs ?? null,
                observationEndMs: observation?.observationEndMs ?? null,
              },
              durationMs,
            )
          : []),
      ],
      windows,
      // Segmento so acompanha transcricao disponivel: texto sem o digest ao lado
      // seria conteudo sem procedencia.
      transcriptSegments:
        transcript?.status === "available" ? transcriptSegments : [],
      transcript,
      measurements: signals.map((signal) => ({
        name: signal.name,
        value: signal.value,
      })),
    };
  }

  async function submitAnalysis(submission: SessionAnalysisSubmission) {
    if (!session) return;
    await requestJson(`/api/multimodal/sessions/${session.id}/analysis`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });
  }

  async function retryAnalysis() {
    const submission = pendingAnalysis.current;
    if (!session || !submission) return;
    setBusy(true);
    setError(null);
    try {
      await submitAnalysis(submission);
      pendingAnalysis.current = null;
      setAnalysisRetry(false);
      exitTo(`/sessoes/${session.id}`, "finished");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "O processamento da sessão não foi concluído.",
      );
    } finally {
      setBusy(false);
    }
  }

  function enterAwaitingSync() {
    stopFinalization();
    setConfirming(false);
    setAwaitingSync(true);
  }

  async function finishSession() {
    if (!session || finalizeInFlight.current) return;
    finalizeInFlight.current = true;
    const finalizeStartedAt = now();
    const initial = createFinalization(
      {
        transcribe: session.setup.transcribe,
        keepRecording: session.setup.keepRecording,
        aiAnalysis: session.setup.aiAnalysis,
        hasCapture: recorders.current.size > 0,
      },
      finalizeStartedAt,
    );
    finalizationRef.current = initial;
    setFinalization(initial);
    setFinalizationClock(finalizeStartedAt);
    setBusy(true);
    setError(null);
    try {

      finishing.current = true;
      const captured = [...recorders.current.keys()];
      const submission = await collectAnalysis(captured);

      // Primeiro movimento, antes de qualquer rede: a medida deixa de depender
      // do resto desta funcao para sobreviver.
      if (submission) pendingAnalysis.current = submission;

      await milestone("stopping_recording");
      const failedUploads: CaptureResource[] = [];
      for (const [resource, handle] of recorders.current) {
        // Parar a gravacao e liberar o dispositivo acontece sempre - inclusive
        // quando o envio falha. Camera acesa depois do fim da sessao seria pior
        // que a midia perdida.
        const { blob, durationMs } = await stopRecording(resource, handle);
        try {
          if (session.setup.keepRecording) await milestone("uploading_recording");
          await uploadRecording(resource, blob, durationMs);
        } catch {
          failedUploads.push(resource);
        }
      }
      recorders.current.clear();
      if (failedUploads.length > 0) {
        setUploadWarning(
          failedUploads.length === 1
            ? "Uma gravação não pôde ser enviada. A análise da sessão foi preservada."
            : "Algumas gravações não puderam ser enviadas. A análise da sessão foi preservada.",
        );
      }

      await milestone("saving_session");
      try {
        await patchStatus("completed");
      } catch (reason) {
        if (!isNetworkFailure(reason)) throw reason;
        enterAwaitingSync();
        return;
      }

      // Se o processamento falhar, ele e reofertado com a medida ainda em
      // memoria — nunca gravada em disco, e nunca substituida por um resultado
      // plausivel.
      if (submission) {
        // Com consentimento de IA esta chamada atravessa o Veltrix; sem ele, so
        // persiste. Nenhum timeout proprio: lentidao nao e falha.
        await milestone(session.setup.aiAnalysis ? "analyzing" : "saving_analysis");
        try {
          await submitAnalysis(submission);
          pendingAnalysis.current = null;
        } catch (reason) {
          if (isNetworkFailure(reason)) {
            enterAwaitingSync();
            return;
          }
          stopFinalization();
          setAnalysisRetry(true);
          setConfirming(false);
          setError(
            reason instanceof Error
              ? reason.message
              : "O processamento da sessão não foi concluído.",
          );
          return;
        }
      }
      // 100% so aqui: tudo que o encerramento precisava ja terminou.
      const done = completeFinalization(finalizationRef.current ?? initial, now());
      finalizationRef.current = done;
      setFinalization(done);
      exitTo(`/sessoes/${session.id}`, "finished");
    } catch (reason) {
      const failedStep = finalizationRef.current
        ? finalizationCurrentStep(finalizationRef.current)
        : null;
      stopFinalization();
      const message =
        reason instanceof Error
          ? reason.message
          : "A captura não foi finalizada. Tente novamente ou exclua.";
      setError(
        failedStep
          ? `${message} (etapa: ${FINALIZATION_STEP_LABEL[failedStep]})`
          : message,
      );
      setConfirming(false);
    } finally {
      finalizeInFlight.current = false;
      setBusy(false);
    }
  }

  /** Sai do estado de processamento: erro real nunca vira carregamento infinito. */
  function stopFinalization() {
    finalizationRef.current = null;
    setFinalization(null);
  }

  async function cancelAndDelete() {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      for (const handle of recorders.current.values()) stopCaptureTracks(handle.stream);
      recorders.current.clear();
      await requestJson(`/api/multimodal/sessions/${session.id}`, {
        method: "DELETE",
      });
      exitTo("/sessoes", "cancelled");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Exclusão não confirmada.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          {embedded ? (
            <h2 className="text-xl font-semibold tracking-tight text-ink">Registro Elyra desta sessão</h2>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
              Nova sessão multimodal
            </h1>
          )}
          <Badge tone="brand">BETA</Badge>
          <Badge tone="neutral">{SESSION_KIND_LABEL[session.kind]}</Badge>
        </div>
        <p className="mt-1 text-ink-muted">{prompt?.body}</p>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {/*
                  Estado **discreto**, e nao painel.

                  Nada de metrica ao vivo: mostrar frequencia de movimento
                  subindo e descendo durante a sessao convidaria a pessoa a se
                  observar sendo medida, e a mudar o comportamento que a medida
                  descreve. O resultado e pos-sessao. Aqui cabe uma palavra: se
                  a analise esta ativa, indisponivel ou interrompida.
                */}
                {/*
                  Transcricao local indisponivel precisa aparecer **durante** a
                  sessao, e nao so no relatorio.

                  Na validacao fisica #1, a pessoa falou tres minutos e so
                  descobriu no fim que nada tinha sido transcrito. Saber antes
                  muda o que ela faz com a sessao.
                */}
                {recording && session.setup.transcribe &&
                localSpeech !== null &&
                localSpeech !== "available" && asrState !== "active" && asrState !== "failed" ? (
                  <span
                    className="text-sm text-ink-muted"
                    data-testid="local-speech-state"
                    data-state={localSpeech}
                  >
                    {localSpeech === "unsupported"
                      ? "Transcrição no aparelho não verificável"
                      : "Transcrição no aparelho indisponível"}
                  </span>
                ) : null}
                {/*
                  Reconhecimento local: estado discreto, e acao explicita quando
                  ha o que preparar. O texto nao diz "IA ouvindo voce" - o que
                  existe aqui e reconhecimento deterministico no aparelho, e
                  misturar isso com o Veltrix confundiria dois consentimentos
                  diferentes.
                */}
                {session.setup.transcribe && asrState !== "unavailable" ? (
                  <span
                    className="flex items-center gap-2 text-sm text-ink-muted"
                    data-testid="local-asr-state"
                    data-state={asrState}
                  >
                    {asrState === "failed" ? "Transcrição local falhou" : SPEECH_ENGINE_STATE_LABEL[asrState]}
                    {asrFailure ? <span data-failure={asrFailure}>{SPEECH_FAILURE_LABEL[asrFailure]}</span> : null}
                  </span>
                ) : null}
                {session.setup.visualAnalysis ? (
                  <span
                    className="text-sm text-ink-muted"
                    data-testid="visual-analysis-state"
                    data-state={visualState}
                    data-live={visualLive ?? undefined}
                    role="status"
                  >
                    {visualLive ? VISUAL_LIVE_STATUS_LABEL[visualLive] : VISUAL_ANALYSIS_STATE_LABEL[visualState]}
                  </span>
                ) : null}
                {visualLive === "paused_performance" ? (
                  // Aviso nao bloqueante: a sessao, o audio e a transcricao seguem.
                  <p className="w-full text-sm text-ink-muted" data-testid="visual-paused-notice">
                    {VISUAL_PAUSED_NOTICE}
                  </p>
                ) : null}
                {session.setup.screen ? (
                  <>
                    <Badge tone={captureStates.screen === "granted" ? "brand" : "neutral"}>
                      {captureStates.screen === "granted" ? "TELA COMPARTILHADA" : "TELA AUTORIZADA"}
                    </Badge>
                    <span className="text-sm text-ink-muted">
                      {captureStateText("screen", captureStates.screen)}
                    </span>
                  </>
                ) : (
                  <span className="text-sm text-ink-muted">
                    Compartilhamento de tela desativado para esta sessão.
                  </span>
                )}
              </div>

              <div className="relative min-h-64 overflow-hidden rounded-card border border-line bg-surface-muted">
                <video
                  ref={screenVideo}
                  muted
                  playsInline
                  aria-label="Prévia real da tela compartilhada"
                  className={cn("size-full object-contain", captureStates.screen !== "granted" && "invisible")}
                />
                {captureStates.screen !== "granted" ? (
                  <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-ink-subtle">
                    A tela aparecerá aqui somente depois da permissão do navegador.
                  </p>
                ) : null}
                {session.setup.camera ? (
                  <video
                    ref={cameraVideo}
                    muted
                    playsInline
                    aria-label="Prévia real da câmera"
                    className={cn(
                      "absolute bottom-4 right-4 size-32 rounded-card border border-line bg-surface object-cover shadow-raised sm:size-40",
                      captureStates.camera !== "granted" && "invisible",
                    )}
                  />
                ) : null}
              </div>

              <ul className="flex flex-wrap gap-3">
                {selectedResources.map((resource) => {
                  const { icon: Icon, label } = RESOURCE_UI[resource];
                  return (
                    <li key={resource} className="flex items-center gap-3 rounded-control bg-surface-brand px-4 py-2.5">
                      <IconPill tone={captureStates[resource] === "granted" ? "positive" : "neutral"} size="sm">
                        <Icon />
                      </IconPill>
                      <span>
                        <span className="block text-sm font-medium text-ink">{label}</span>
                        <span
                          key={captureStates[resource]}
                          data-testid={`capture-state-${resource}`}
                          data-state={captureStates[resource]}
                          className="motion-fade-in block text-xs text-ink-muted"
                        >
                          {captureStateText(resource, captureStates[resource])}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>

          <p role="note" className="flex items-center gap-3 rounded-control bg-surface-brand px-4 py-3 text-sm text-brand-800">
            <Lock className="size-4 shrink-0" aria-hidden="true" />
            Cada recurso é solicitado separadamente. Sem consentimento para guardar,
            a gravação permanece em memória e não é enviada ao Storage.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <span className={cn(
                  "flex items-center gap-2 text-sm font-semibold",
                  paused ? "text-ink-muted" : recording ? "text-destructive" : "text-ink-muted",
                )} aria-live="polite">
                  {paused ? (
                    <><Pause className="size-4" aria-hidden="true" />PAUSADA</>
                  ) : recording ? (
                    <><Circle className="size-3 fill-destructive" aria-hidden="true" />REC</>
                  ) : "AGUARDANDO"}
                </span>
                <span data-testid="session-timer" className="text-lg font-semibold tabular-nums text-ink">
                  {formatElapsed(elapsed)}
                </span>
              </div>

              <div className="rounded-control bg-surface-brand p-4">
                <h2 className="text-sm font-semibold text-brand-800">{prompt?.title}</h2>
                <p className="mt-1 text-sm text-brand-800">{prompt?.body}</p>
                <p className="mt-2 text-sm text-brand-800">Você pode falar livremente.</p>
              </div>

              <div>
                <h2 className="mb-3 text-sm font-semibold text-ink">Dicas para uma boa sessão</h2>
                <ul className="flex flex-col gap-3">
                  {SESSION_TIPS.map((tip) => (
                    <li key={tip.title} className="flex items-start gap-3">
                      <IconPill tone="brand" size="sm"><Lightbulb /></IconPill>
                      <div>
                        <p className="text-sm font-medium text-ink">{tip.title}</p>
                        <p className="text-sm text-ink-muted">{tip.body}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-line pt-4">
                {session.setup.microphone ? (
                  <>
                    <div className="flex h-16 items-end justify-center gap-1" role="img" aria-label={paused ? "Captura pausada" : captureStates.microphone === "granted" ? "Captura de voz ativa" : "Microfone aguardando permissão"}>
                      {WAVEFORM.map((height, index) => (
                        <span key={index} aria-hidden="true" className={cn("w-1 rounded-pill", paused || captureStates.microphone !== "granted" ? "bg-line-strong" : "bg-brand-500")} style={{ height: `${height * 2}px` }} />
                      ))}
                    </div>
                    <p className="mt-2 text-center text-sm text-ink-muted">{captureStateText("microphone", captureStates.microphone)}</p>
                  </>
                ) : (
                  <p className="flex items-center justify-center gap-2 py-4 text-sm text-ink-subtle">
                    <MicOff className="size-4" aria-hidden="true" />Microfone não autorizado para esta sessão
                  </p>
                )}
              </div>

              {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
              {/*
                Aviso, e nao erro: a sessao continua valida e a analise foi
                preservada. Apresentar isto como falha ensinaria a pessoa a
                desconfiar de um resultado que esta intacto.
              */}
              {uploadWarning ? (
                <p role="status" data-testid="upload-warning" className="text-sm text-ink-muted">
                  {uploadWarning}
                </p>
              ) : null}

              {awaitingSync ? (
                <div role="status" data-testid="finalize-awaiting-sync" className="flex flex-col gap-2 rounded-control bg-attention-soft p-4 text-sm text-ink">
                  <p className="font-medium">Sessão finalizada neste dispositivo.</p>
                  <p>
                    O resultado será sincronizado quando a conexão voltar. Mantenha esta aba aberta: se ela for
                    fechada antes disso, o resultado desta sessão não será sincronizado. Nenhuma gravação, imagem ou
                    sinal fica guardado no aparelho.
                  </p>
                  <Button
                    variant="secondary"
                    className="self-start"
                    disabled={busy}
                    data-testid="finalize-sync-now"
                    onClick={() => void syncFinalization()}
                  >
                    {busy ? <InlineSpinner /> : null}
                    Tentar agora
                  </Button>
                </div>
              ) : null}

              {analysisRetry ? (
                <div className="flex flex-col gap-2 rounded-control bg-attention-soft p-4">
                  <p className="text-sm text-ink">
                    A captura foi salva, mas o processamento não foi concluído.
                    Nenhum resultado foi criado — nada foi estimado no lugar.
                  </p>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    data-testid="retry-analysis"
                    onClick={() => void retryAnalysis()}
                  >
                    {busy ? <InlineSpinner /> : null}
                    Tentar processar novamente
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => exitTo(`/sessoes/${session.id}`, "finished")}
                  >
                    Ver a sessão sem processar
                  </Button>
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                {!recording && session.status === "preparing" && session.setup.transcribe ? (
                  <TranscriptionPreflight native={localSpeech} preparation={preparation} />
                ) : null}
                {awaitingSync ? null : !recording ? (
                  <Button size="lg" disabled={busy || session.status !== "preparing" ||
                    !transcriptionCanStart(session.setup.transcribe, localSpeech, preparation)} onClick={() => void beginCapture()}>
                    {busy ? <InlineSpinner /> : <Play aria-hidden="true" />}
                    {/* Na chamada nao ha permissao nova a pedir: os tracks ja existem. */}
                    {embedded ? "Iniciar registro" : "Solicitar permissões e iniciar"}
                  </Button>
                ) : (
                  <>
                    <Button variant="secondary" size="lg" disabled={busy} onClick={() => void togglePause()}>
                      {paused ? <><Play aria-hidden="true" />Retomar sessão</> : <><Pause aria-hidden="true" />Pausar sessão</>}
                    </Button>
                    <Button variant="destructive" size="lg" disabled={busy} onClick={() => setConfirming(true)}>
                      <Square aria-hidden="true" />Finalizar sessão
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/*
        Durante o encerramento o modal nao fecha: nem Esc, nem clique fora, nem
        o X. Fechar esconderia o unico sinal de que o processamento continua.
      */}
      <Dialog open={confirming} onOpenChange={(open) => !open && !finalization && setConfirming(false)}>
        <DialogContent>
          {finalization ? (
            <FinalizationPanel progress={finalization} clock={finalizationClock} />
          ) : (<>
          <DialogHeader>
            <DialogTitle>Finalizar a sessão?</DialogTitle>
            <DialogDescription>
              {session.setup.keepRecording
                ? "Os assets autorizados serão validados e enviados ao Storage privado antes do encerramento."
                : "Nenhuma mídia será enviada: as gravações em memória serão descartadas."}
            </DialogDescription>
          </DialogHeader>

          {/*
            Autorrelato: opcional, na escala 0-10 de `/meu-humor`, e apresentado
            **antes** de qualquer resultado. Perguntar depois de a pessoa ver os
            sinais transformaria o relato dela numa reacao ao que a Elyra mediu.
          */}
          <fieldset className="mt-2 rounded-control border border-line p-3">
            <legend className="px-1 text-xs font-medium text-ink-muted">
              Como você descreveria esta sessão? (opcional)
            </legend>
            <p className="text-xs text-ink-subtle">
              É o seu relato, na sua escala. Deixe em branco o que não quiser
              responder — em branco não vira zero.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["self-mood", "Humor", selfMood, setSelfMood],
                  ["self-anxiety", "Ansiedade percebida", selfAnxiety, setSelfAnxiety],
                  ["self-energy", "Energia", selfEnergy, setSelfEnergy],
                ] as const
              ).map(([id, label, value, setValue]) => (
                <div key={id}>
                  <Label htmlFor={id} className="text-xs">
                    {label}
                  </Label>
                  <Input
                    id={id}
                    type="number"
                    min={0}
                    max={10}
                    step={1}
                    inputMode="numeric"
                    placeholder="0 a 10"
                    value={value}
                    onChange={(event) => setValue(event.target.value)}
                  />
                </div>
              ))}
            </div>
          </fieldset>

          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Continuar sessão</Button>
            <Button variant="secondary" disabled={busy} onClick={() => void cancelAndDelete()}>Cancelar e excluir</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void finishSession()}>
              {busy ? <InlineSpinner /> : null}Finalizar sessão
            </Button>
          </DialogFooter>
          </>)}
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Estado de processamento do encerramento, dentro do mesmo modal.
 *
 * Mostra percentual por marco, etapa atual e tempo decorrido. Nao mostra tempo
 * restante: nao ha como estima-lo com honestidade, e uma previsao errada e pior
 * que nenhuma.
 */
function FinalizationPanel({
  progress,
  clock,
}: {
  progress: FinalizationProgress;
  clock: number;
}) {
  const percent = finalizationPercent(progress);
  const stalled = finalizationStalled(progress, clock);
  return (
    <div data-testid="finalization-progress" data-percent={percent}>
      <DialogHeader>
        <DialogTitle>Finalizando sessão</DialogTitle>
        <DialogDescription>
          Não feche esta página enquanto a sessão é finalizada.
        </DialogDescription>
      </DialogHeader>
      <div aria-live="polite">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 text-ink" data-testid="finalization-step">
            {percent < 100 ? <InlineSpinner /> : null}
            {finalizationLabel(progress)}
          </span>
          <span className="font-semibold tabular-nums text-ink" data-testid="finalization-percent">
            {percent}%
          </span>
        </div>
        <div
          className="mt-2 h-2 overflow-hidden rounded-pill bg-surface-muted"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso da finalização"
        >
          <div
            className="motion-progress h-full w-full rounded-pill bg-brand-600"
            style={{ "--progress": percent / 100 } as CSSProperties}
          />
        </div>
        <p className="mt-2 text-xs text-ink-muted" data-testid="finalization-elapsed">
          Tempo decorrido: {finalizationElapsedSeconds(progress, clock)} s
        </p>
      </div>
      {stalled ? (
        <p role="status" className="mt-3 rounded-control bg-attention-soft p-3 text-sm text-ink" data-testid="finalization-stall">
          Esta etapa está demorando mais que o esperado. O processamento ainda está em andamento.
        </p>
      ) : null}
    </div>
  );
}

function formatElapsed(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return [hours, minutes, remaining]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}
