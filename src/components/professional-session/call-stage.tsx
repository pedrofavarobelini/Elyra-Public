"use client";

import {
  LockKeyhole,
  Maximize,
  Mic,
  MicOff,
  Minimize,
  PhoneOff,
  RefreshCw,
  SwitchCamera,
  Video,
  VideoOff,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CallAdapter, CallConnectionState, CallFailure, CallSnapshot } from "@/lib/realtime/call-adapter";

/**
 * Palco da chamada 1:1 (PRO-7R, blueprint secoes 4-7).
 *
 * So transporte: o que aparece aqui vai direto para a outra pessoa e nao fica
 * guardado. O registro Elyra mora em outro painel e tem permissoes proprias.
 * Estado sempre em texto (nunca so cor/icone); entradas, saidas e reconexao
 * anunciadas numa regiao viva educada.
 */

export const CALL_STATE_LABEL: Record<CallConnectionState, string> = {
  idle: "Preparando",
  connecting: "Conectando",
  connected: "Conectado",
  reconnecting: "Reconectando",
  unstable: "Conexão instável",
  disconnected: "Desconectado",
  failed: "Falha",
};

export const CALL_FAILURE_COPY: Record<CallFailure, string> = {
  e2ee_unsupported:
    "Este navegador não oferece criptografia de ponta a ponta, e a chamada não começa sem ela. Nada foi transmitido.",
  e2ee_failed:
    "A criptografia de ponta a ponta não pôde ser confirmada, então a chamada foi encerrada. Nada foi transmitido sem ela.",
  connect_failed: "Não foi possível conectar. Tentar de novo.",
  unexpected_participant: "Alguém fora desta sessão tentou entrar, então a chamada foi encerrada por segurança.",
  room_closed: "A chamada foi encerrada.",
};

const STATE_TONE: Record<CallConnectionState, "neutral" | "brand" | "positive" | "attention" | "destructive"> = {
  idle: "neutral",
  connecting: "brand",
  connected: "positive",
  reconnecting: "attention",
  unstable: "attention",
  disconnected: "neutral",
  failed: "destructive",
};

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}

/**
 * Anuncios para leitor de tela: entradas, saidas e mudanca de conexao. Assina
 * o adapter direto (e nao um efeito sobre o snapshot) para nao perder a
 * transicao quando dois estados chegam no mesmo quadro.
 */
function useAnnouncements(adapter: CallAdapter, counterpart: string) {
  const [message, setMessage] = useState("");
  useEffect(() => {
    let previous = adapter.getSnapshot();
    return adapter.subscribe(() => {
      const current = adapter.getSnapshot();
      const before = previous;
      previous = current;
      if (!before.remote.present && current.remote.present) setMessage(`${counterpart} entrou na chamada.`);
      else if (before.remote.present && !current.remote.present && current.state === "connected") {
        setMessage(`${counterpart} saiu da chamada.`);
      } else if (before.state !== current.state && current.state !== "idle") {
        setMessage(`${CALL_STATE_LABEL[current.state]}.`);
      }
    });
  }, [adapter, counterpart]);
  return message;
}

const noopSubscribe = () => () => undefined;
const isFullscreen = () => typeof document !== "undefined" && document.fullscreenElement !== null;

export function CallStage({
  adapter,
  snapshot,
  counterpart,
  outputDeviceId,
  onLeave,
  onRetry,
  retrying,
}: {
  adapter: CallAdapter;
  snapshot: CallSnapshot;
  counterpart: string;
  outputDeviceId?: string;
  onLeave: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const [busy, setBusy] = useState<"mic" | "cam" | "switch" | null>(null);
  const announcement = useAnnouncements(adapter, counterpart);
  const fullscreen = useSyncExternalStore(
    typeof document === "undefined"
      ? noopSubscribe
      : (listener) => {
          document.addEventListener("fullscreenchange", listener);
          return () => document.removeEventListener("fullscreenchange", listener);
        },
    isFullscreen,
    () => false,
  );

  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  // Os elementos existem sempre (so escondidos): um attach por montagem.
  useEffect(() => {
    adapter.attachLocalVideo(localRef.current);
    adapter.attachRemote(remoteRef.current, remoteAudio.current);
    return () => {
      adapter.attachLocalVideo(null);
      adapter.attachRemote(null, null);
    };
  }, [adapter]);

  useEffect(() => {
    const audio = remoteAudio.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    if (audio && outputDeviceId && typeof audio.setSinkId === "function") {
      void audio.setSinkId(outputDeviceId).catch(() => undefined);
    }
  }, [outputDeviceId]);

  async function toggle(kind: "mic" | "cam") {
    setBusy(kind);
    try {
      if (kind === "mic") await adapter.setMicrophoneEnabled(!snapshot.microphone);
      else await adapter.setCameraEnabled(!snapshot.camera);
    } catch {
      // Dispositivo negado/ocupado: o estado continua o que o adapter reporta.
    } finally {
      setBusy(null);
    }
  }

  async function switchCamera() {
    setBusy("switch");
    try {
      await adapter.switchCamera();
    } finally {
      setBusy(null);
    }
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void container.current?.requestFullscreen?.().catch(() => undefined);
  }

  const live = snapshot.state === "connected" || snapshot.state === "reconnecting" || snapshot.state === "unstable";
  const ended = snapshot.state === "failed" || snapshot.state === "disconnected";

  return (
    <section
      ref={container}
      aria-label="Chamada"
      className="flex min-w-0 flex-col gap-3 rounded-card border border-line bg-surface p-3 sm:p-4 xl:sticky xl:top-4 [&:fullscreen]:justify-center [&:fullscreen]:bg-canvas"
      data-testid="call-stage"
      data-call-state={snapshot.state}
      data-e2ee={snapshot.e2ee ? "on" : "off"}
      data-remote-present={snapshot.remote.present}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">Chamada</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATE_TONE[snapshot.state]} data-testid="call-state">
            {CALL_STATE_LABEL[snapshot.state]}
          </Badge>
          {snapshot.e2ee && live ? (
            <Badge tone="identity">
              <LockKeyhole aria-hidden="true" className="size-3.5" />
              Ponta a ponta
            </Badge>
          ) : null}
        </div>
      </div>

      <p className="sr-only" aria-live="polite" role="status" data-testid="call-announcer">
        {announcement}
      </p>

      <div className="relative mx-auto aspect-video w-full max-w-[1200px] overflow-hidden rounded-card bg-surface-sunken">
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          aria-label={`Vídeo de ${counterpart}`}
          className={snapshot.remote.camera ? "size-full object-contain" : "hidden"}
          data-testid="remote-video"
        />
        <audio ref={remoteAudio} autoPlay data-testid="remote-audio" />
        {!snapshot.remote.camera ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            <span
              aria-hidden="true"
              className="flex size-16 items-center justify-center rounded-pill bg-identity-50 text-lg font-semibold text-identity-700 sm:size-20"
            >
              {initials(counterpart)}
            </span>
            <p className="text-sm text-ink-muted" data-testid="remote-placeholder">
              {ended
                ? "Fora da chamada."
                : !snapshot.remote.present
                  ? "Aguardando o outro participante."
                  : "Câmera desligada."}
            </p>
          </div>
        ) : null}
        {snapshot.remote.present && !snapshot.remote.microphone ? (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-pill bg-surface/90 px-2 py-1 text-xs text-ink">
            <MicOff aria-hidden="true" className="size-3.5" />
            Microfone desligado
          </span>
        ) : null}
        {snapshot.state === "reconnecting" || snapshot.state === "unstable" ? (
          <p className="absolute inset-x-0 top-0 bg-attention-soft px-3 py-1.5 text-center text-sm text-attention">
            {snapshot.state === "reconnecting" ? "Reconectando…" : "Conexão instável"}
          </p>
        ) : null}
        <div className="absolute bottom-2 right-2 aspect-video w-[28%] min-w-24 max-w-64 overflow-hidden rounded-control border border-line bg-surface-muted shadow-sm">
          <video
            ref={localRef}
            autoPlay
            muted
            playsInline
            aria-label="Seu vídeo"
            className={snapshot.camera ? "size-full object-cover [transform:scaleX(-1)]" : "hidden"}
            data-testid="local-video"
          />
          {!snapshot.camera ? (
            <p className="flex size-full items-center justify-center p-1 text-center text-xs text-ink-muted">
              Sua câmera está desligada
            </p>
          ) : null}
        </div>
      </div>

      {snapshot.state === "failed" && snapshot.failure ? (
        <p role="alert" className="rounded-control bg-destructive-soft px-3 py-2 text-sm text-destructive" data-testid="call-failure">
          {CALL_FAILURE_COPY[snapshot.failure]}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Controles da chamada">
        {live ? (
          <>
            <Button
              variant={snapshot.microphone ? "secondary" : "soft"}
              aria-pressed={snapshot.microphone}
              disabled={busy !== null}
              onClick={() => void toggle("mic")}
              data-testid="toggle-mic"
            >
              {snapshot.microphone ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
              {snapshot.microphone ? "Microfone ligado" : "Microfone desligado"}
            </Button>
            <Button
              variant={snapshot.camera ? "secondary" : "soft"}
              aria-pressed={snapshot.camera}
              disabled={busy !== null}
              onClick={() => void toggle("cam")}
              data-testid="toggle-camera"
            >
              {snapshot.camera ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}
              {snapshot.camera ? "Câmera ligada" : "Câmera desligada"}
            </Button>
            {snapshot.cameraCount > 1 && snapshot.camera ? (
              <Button variant="secondary" disabled={busy !== null} onClick={() => void switchCamera()}>
                <SwitchCamera aria-hidden="true" />
                Trocar câmera
              </Button>
            ) : null}
            <Button variant="secondary" aria-pressed={fullscreen} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
              {fullscreen ? "Sair da tela cheia" : "Tela cheia"}
            </Button>
            <Button variant="destructive" onClick={onLeave} data-testid="leave-call">
              <PhoneOff aria-hidden="true" />
              Sair da chamada
            </Button>
          </>
        ) : ended ? (
          <Button onClick={onRetry} disabled={retrying} data-testid="retry-call">
            <RefreshCw aria-hidden="true" />
            {retrying ? "Entrando…" : "Entrar de novo"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
