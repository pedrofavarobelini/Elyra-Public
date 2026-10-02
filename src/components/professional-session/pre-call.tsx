"use client";

import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  Headphones,
  LockKeyhole,
  Mic,
  MicOff,
  PhoneCall,
  Server,
  Video,
  VideoOff,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { RequiresConnection } from "@/components/offline/requires-connection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProfessionalSessionDetail } from "@/lib/contracts/professional-sessions";
import { CALL_AUDIO_CONSTRAINTS, callEnvironmentSupport, type CallDevices } from "@/lib/realtime/call-adapter";
import {
  DEVICE_STATUS_COPY,
  classifyMediaError,
  queryPermission,
  type DeviceStatus,
} from "@/lib/realtime/devices";
import { formatTime } from "@/lib/scheduling/format";

/**
 * Pre-call "Preparar sessao" (PRO-7R, blueprint secao 3).
 *
 * A previa e LOCAL: nao grava, nao analisa, nao envia. Os dispositivos so sao
 * listados depois da permissao. Sem camera, a pessoa entra so com audio; sem
 * microfone, entra sem audio - nada disso trava a sessao. Fechar a pagina ou
 * entrar para a chamada encerra os tracks da previa.
 */

type Support = ReturnType<typeof callEnvironmentSupport>;
type Service = "checking" | "available" | "unavailable";

export type PreCallChoice = CallDevices & { outputDeviceId?: string };

function Check({
  ok,
  warn,
  icon,
  label,
  children,
  testId,
}: {
  ok: boolean;
  warn?: boolean;
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  const StatusIcon = ok ? CircleCheck : warn ? CircleAlert : CircleDashed;
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0" data-testid={testId} data-ok={ok}>
      <span aria-hidden="true" className="mt-0.5 text-ink-muted [&_svg]:size-4">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          {label}
          <StatusIcon
            aria-hidden="true"
            className={ok ? "size-4 text-positive" : warn ? "size-4 text-attention" : "size-4 text-ink-subtle"}
          />
        </p>
        <div className="mt-0.5 text-sm text-ink-muted">{children}</div>
      </div>
    </li>
  );
}

function DeviceSelect({
  id,
  label,
  devices,
  value,
  onChange,
}: {
  id: string;
  label: string;
  devices: MediaDeviceInfo[];
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  if (devices.length < 2) return null;
  return (
    <div className="mt-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <select
        id={id}
        value={value ?? devices[0]?.deviceId}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full min-w-0 rounded-control border border-line-input bg-surface px-3 text-sm text-ink lg:h-9"
      >
        {devices.map((device, index) => (
          <option key={device.deviceId || index} value={device.deviceId}>
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

export function PreCall({
  detail,
  open,
  joining,
  consentSummary,
  onOpenConsents,
  onJoin,
}: {
  detail: ProfessionalSessionDetail;
  open: boolean;
  joining: boolean;
  consentSummary: string;
  onOpenConsents: (() => void) | null;
  onJoin: (choice: PreCallChoice) => void;
}) {
  const baseId = useId();
  const preview = useRef<HTMLVideoElement>(null);
  const streams = useRef<MediaStream[]>([]);
  const [support, setSupport] = useState<Support | null>(null);
  const [service, setService] = useState<Service>("checking");
  const [mic, setMic] = useState<DeviceStatus>("prompt");
  const [cam, setCam] = useState<DeviceStatus>("prompt");
  const [tested, setTested] = useState(false);
  const [testing, setTesting] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [audioDeviceId, setAudioDeviceId] = useState<string>();
  const [videoDeviceId, setVideoDeviceId] = useState<string>();
  const [outputDeviceId, setOutputDeviceId] = useState<string>();

  useEffect(() => {
    let active = true;
    const frame = requestAnimationFrame(() => {
      if (active) setSupport(callEnvironmentSupport());
    });
    void Promise.all([queryPermission("microphone"), queryPermission("camera")]).then(([m, c]) => {
      if (!active) return;
      setMic(m);
      setCam(c);
    });
    void fetch(`/api/professional-sessions/${detail.id}/media`, { cache: "no-store" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as { data?: { available?: boolean } };
        if (active) setService(response.ok && payload.data?.available ? "available" : "unavailable");
      })
      .catch(() => {
        if (active) setService("unavailable");
      });
    return () => {
      active = false;
      cancelAnimationFrame(frame);
    };
  }, [detail.id]);

  function stopPreview() {
    for (const stream of streams.current) for (const track of stream.getTracks()) track.stop();
    streams.current = [];
    if (preview.current) preview.current.srcObject = null;
  }

  // Sair da tela sempre desliga a previa.
  useEffect(() => stopPreview, []);

  async function test() {
    stopPreview();
    setTesting(true);
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setMic("unsupported");
      setCam("unsupported");
      setTesting(false);
      return;
    }
    // Um pedido por dispositivo: a falha de um nao esconde o estado do outro.
    try {
      const audio = await media.getUserMedia({ audio: { ...CALL_AUDIO_CONSTRAINTS, deviceId: audioDeviceId }, video: false });
      streams.current.push(audio);
      setMic("granted");
    } catch (error) {
      setMic(classifyMediaError(error));
    }
    try {
      const video = await media.getUserMedia({ video: { deviceId: videoDeviceId }, audio: false });
      streams.current.push(video);
      setCam("granted");
      if (preview.current) {
        preview.current.srcObject = video;
        await preview.current.play().catch(() => undefined);
      }
    } catch (error) {
      setCam(classifyMediaError(error));
    }
    try {
      setDevices(await media.enumerateDevices());
    } catch {
      setDevices([]);
    }
    setTested(true);
    setTesting(false);
  }

  const microphones = devices.filter((device) => device.kind === "audioinput" && device.deviceId);
  const cameras = devices.filter((device) => device.kind === "videoinput" && device.deviceId);
  const outputs = devices.filter((device) => device.kind === "audiooutput" && device.deviceId);
  const e2eeReady = support ? support.webrtc && support.e2ee : false;
  const micUsable = mic === "granted" || mic === "prompt";
  const camUsable = cam === "granted" || cam === "prompt";
  const counterpart = detail.counterpartName ?? (detail.role === "client" ? "o profissional" : "a pessoa");

  function join() {
    stopPreview();
    onJoin({
      audio: micOn && micUsable,
      video: camOn && camUsable,
      audioDeviceId,
      videoDeviceId,
      outputDeviceId,
    });
  }

  return (
    <Card data-testid="pre-call">
      <CardHeader>
        <CardTitle as="h2">Preparar sessão</CardTitle>
        <CardDescription>
          Confira câmera, microfone e conexão antes de entrar na chamada com {counterpart}.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" data-layout="columns">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-card bg-surface-sunken">
            <video
              ref={preview}
              muted
              playsInline
              aria-label="Prévia da sua câmera"
              className="size-full object-cover [transform:scaleX(-1)]"
              data-testid="pre-call-preview"
            />
            {cam !== "granted" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-ink-muted">
                <VideoOff aria-hidden="true" className="size-6" />
                <p>{tested ? DEVICE_STATUS_COPY.camera[cam] : "A prévia aparece quando você testar a câmera."}</p>
              </div>
            ) : null}
          </div>
          <p className="text-sm text-ink-muted">
            Prévia só no seu aparelho: nada é gravado nem enviado para a Elyra.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void test()} disabled={testing}>
              {testing ? "Testando…" : tested ? "Testar de novo" : "Testar câmera e microfone"}
            </Button>
            <Button
              variant={micOn ? "soft" : "secondary"}
              aria-pressed={micOn}
              onClick={() => setMicOn((value) => !value)}
              disabled={!micUsable}
            >
              {micOn ? <Mic aria-hidden="true" /> : <MicOff aria-hidden="true" />}
              {micOn ? "Com microfone" : "Sem microfone"}
            </Button>
            <Button
              variant={camOn ? "soft" : "secondary"}
              aria-pressed={camOn}
              onClick={() => setCamOn((value) => !value)}
              disabled={!camUsable}
            >
              {camOn ? <Video aria-hidden="true" /> : <VideoOff aria-hidden="true" />}
              {camOn ? "Com câmera" : "Sem câmera"}
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <ul className="flex flex-col divide-y divide-line" aria-label="Verificações">
            <Check ok={open} warn={!open} icon={<CircleCheck />} label="Horário" testId="pre-call-window">
              {open
                ? `Sessão aberta até ${formatTime(detail.closesAt, detail.timezone)}.`
                : `A entrada abre às ${formatTime(detail.opensAt, detail.timezone)}.`}
            </Check>
            <Check ok={mic === "granted"} warn={mic !== "granted" && mic !== "prompt"} icon={<Mic />} label="Microfone" testId="pre-call-mic">
              <span data-status={mic}>{DEVICE_STATUS_COPY.microphone[mic]}</span>
              <DeviceSelect id={`${baseId}-mic`} label="Microfone" devices={microphones} value={audioDeviceId} onChange={setAudioDeviceId} />
            </Check>
            <Check ok={cam === "granted"} warn={cam !== "granted" && cam !== "prompt"} icon={<Video />} label="Câmera" testId="pre-call-camera">
              <span data-status={cam}>{DEVICE_STATUS_COPY.camera[cam]}</span>
              <DeviceSelect id={`${baseId}-cam`} label="Câmera" devices={cameras} value={videoDeviceId} onChange={setVideoDeviceId} />
            </Check>
            <Check ok={tested} icon={<Headphones />} label="Saída de som">
              {support?.outputSelection && outputs.length > 1 ? (
                <DeviceSelect id={`${baseId}-out`} label="Saída de som" devices={outputs} value={outputDeviceId} onChange={setOutputDeviceId} />
              ) : (
                <span>Padrão do aparelho.</span>
              )}
              <span className="mt-1 block">
                Use fones de ouvido: evita eco. O cancelamento de eco ajuda, mas não é perfeito.
              </span>
            </Check>
            <Check ok={service === "available"} warn={service === "unavailable"} icon={<Server />} label="Serviço de chamada" testId="pre-call-service">
              <span data-status={service}>
                {service === "checking"
                  ? "Verificando…"
                  : service === "available"
                    ? "Respondendo."
                    : "Não respondeu agora. Você ainda pode tentar entrar."}
              </span>
            </Check>
            <Check ok={e2eeReady} warn={support !== null && !e2eeReady} icon={<LockKeyhole />} label="Criptografia de ponta a ponta" testId="pre-call-e2ee">
              {support === null
                ? "Verificando…"
                : e2eeReady
                  ? "Disponível. Áudio e vídeo vão cifrados de um aparelho ao outro."
                  : "Este navegador não oferece criptografia de ponta a ponta. A chamada não começa sem ela; use Chrome, Edge, Firefox ou Safari atualizados."}
            </Check>
          </ul>

          <div className="rounded-control border border-line bg-surface-muted/50 p-3 text-sm" data-testid="pre-call-elyra">
            <p className="font-medium text-ink">Análise Elyra</p>
            <p className="mt-0.5 text-ink-muted">{consentSummary}</p>
            {onOpenConsents ? (
              <Button variant="link" className="h-auto px-0 py-1" onClick={onOpenConsents}>
                Revisar permissões
              </Button>
            ) : null}
          </div>

          {open ? (
            <RequiresConnection note="Você precisa de conexão para participar desta sessão.">
              <Button size="lg" onClick={join} disabled={!e2eeReady || joining} data-testid="join-call">
                <PhoneCall aria-hidden="true" />
                {joining ? "Entrando…" : detail.mePresent ? "Entrar na chamada" : "Entrar na sessão"}
              </Button>
            </RequiresConnection>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
