import {
  ConnectionQuality,
  ConnectionState,
  ExternalE2EEKeyProvider,
  isE2EESupported,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
} from "livekit-client";

import { assertLocalCaptureParticipant, type CallCaptureResource } from "./capture-guard";

/**
 * Adaptador de chamada do cliente (ADR-0025, D1). Unico arquivo da UI que
 * importa `livekit-client`; o resto da interface fala com `CallAdapter`.
 *
 * Regras que vivem aqui:
 *  - E2EE obrigatorio e FALHA FECHADA (D3): sem suporte, sem chave aplicada,
 *    `EncryptionError`, sala sem E2EE ou track remoto sem criptografia => a
 *    chamada nao conecta ou e encerrada. Nunca cai para midia sem E2EE.
 *  - So a outra parte esperada (identidade opaca vinda da Elyra) e exibida;
 *    qualquer outra identidade encerra a chamada.
 *  - Captura Elyra so recebe CLONE do track LOCAL (`capture-guard`); o track
 *    remoto nunca sai deste arquivo como `MediaStreamTrack`.
 *  - Nada de token, chave ou SDP em log/estado exposto.
 */

export type CallConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "unstable"
  | "disconnected"
  | "failed";

export type CallFailure =
  | "e2ee_unsupported"
  | "e2ee_failed"
  | "connect_failed"
  | "unexpected_participant"
  | "room_closed";

export type CallSnapshot = Readonly<{
  state: CallConnectionState;
  failure: CallFailure | null;
  e2ee: boolean;
  microphone: boolean;
  camera: boolean;
  cameraCount: number;
  remote: Readonly<{ present: boolean; microphone: boolean; camera: boolean; encrypted: boolean }>;
}>;

export type CallJoin = Readonly<{
  url: string;
  token: string;
  e2eeKey: string;
  identity: string;
  peerIdentity: string;
}>;

export type CallDevices = Readonly<{
  audio: boolean;
  video: boolean;
  audioDeviceId?: string;
  videoDeviceId?: string;
}>;

export interface CallAdapter {
  connect(join: CallJoin, devices: CallDevices): Promise<void>;
  disconnect(): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  setCameraEnabled(enabled: boolean): Promise<void>;
  switchCamera(): Promise<void>;
  attachLocalVideo(element: HTMLVideoElement | null): void;
  attachRemote(video: HTMLVideoElement | null, audio: HTMLAudioElement | null): void;
  /** Stream para a captura Elyra: clone do track LOCAL, nunca do remoto. */
  captureStream(resource: CallCaptureResource): MediaStream;
  subscribe(listener: () => void): () => void;
  getSnapshot(): CallSnapshot;
}

export const IDLE_CALL: CallSnapshot = Object.freeze({
  state: "idle",
  failure: null,
  e2ee: false,
  microphone: false,
  camera: false,
  cameraCount: 0,
  remote: Object.freeze({ present: false, microphone: false, camera: false, encrypted: false }),
});

/** Audio da chamada: cancelamento de eco, supressao de ruido e ganho automatico. */
export const CALL_AUDIO_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;

function decodeKey(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.length !== 32) throw new Error("e2ee_key_invalid");
  return bytes.buffer;
}

/** Prazo para o worker confirmar o E2EE local; sem confirmacao, falha fechada. */
export const E2EE_CONFIRM_TIMEOUT_MS = 10_000;

/**
 * Resolve `true` quando o E2EE do participante LOCAL esta confirmado (ja
 * estava, ou chegou o evento do worker); `false` no prazo ou se a sala cair.
 */
export function localEncryptionConfirmed(
  room: Pick<Room, "isE2EEEnabled" | "on" | "off">,
  timeoutMs: number,
): Promise<boolean> {
  if (room.isE2EEEnabled) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (value: boolean) => {
      window.clearTimeout(timer);
      room.off(RoomEvent.ParticipantEncryptionStatusChanged, onStatus);
      room.off(RoomEvent.Disconnected, onGone);
      resolve(value);
    };
    const onStatus = (encrypted: boolean, participant?: Participant) => {
      if (participant?.isLocal && encrypted) done(true);
    };
    const onGone = () => done(false);
    const timer = window.setTimeout(() => done(room.isE2EEEnabled), timeoutMs);
    room.on(RoomEvent.ParticipantEncryptionStatusChanged, onStatus);
    room.on(RoomEvent.Disconnected, onGone);
  });
}

function createE2EEWorker() {
  return new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), { type: "module" });
}

export function createCallAdapter(): CallAdapter {
  let snapshot: CallSnapshot = IDLE_CALL;
  const listeners = new Set<() => void>();
  let room: Room | null = null;
  let worker: Worker | null = null;
  let peerIdentity: string | null = null;
  let localVideo: HTMLVideoElement | null = null;
  let remoteVideo: HTMLVideoElement | null = null;
  let remoteAudio: HTMLAudioElement | null = null;
  let intentionalDisconnect = false;
  const captureClones = new Map<CallCaptureResource, Set<MediaStreamTrack>>();

  function emit(patch: Partial<CallSnapshot>) {
    snapshot = Object.freeze({ ...snapshot, ...patch });
    for (const listener of listeners) listener();
  }

  function peer(): RemoteParticipant | undefined {
    if (!room || !peerIdentity) return undefined;
    return room.remoteParticipants.get(peerIdentity);
  }

  /** Clones da captura acompanham o estado do track da chamada. */
  function endCaptureClones(resource: CallCaptureResource) {
    for (const clone of captureClones.get(resource) ?? []) {
      clone.stop();
      // `stop()` nao dispara `ended`; a captura precisa saber que perdeu a fonte.
      clone.dispatchEvent(new Event("ended"));
    }
    captureClones.get(resource)?.clear();
  }

  function refreshLocal() {
    if (!room) return;
    const local = room.localParticipant;
    const microphone = local.isMicrophoneEnabled;
    const camera = local.isCameraEnabled;
    if (!microphone) endCaptureClones("microphone");
    if (!camera) endCaptureClones("camera");
    const cameraTrack = local.getTrackPublication(Track.Source.Camera)?.track;
    if (localVideo) {
      if (cameraTrack && camera) cameraTrack.attach(localVideo);
      else localVideo.srcObject = null;
    }
    emit({ microphone, camera, e2ee: room.isE2EEEnabled });
  }

  function refreshRemote() {
    const participant = peer();
    if (!participant) {
      if (remoteVideo) remoteVideo.srcObject = null;
      if (remoteAudio) remoteAudio.srcObject = null;
      emit({ remote: { present: false, microphone: false, camera: false, encrypted: false } });
      return;
    }
    const video = participant.getTrackPublication(Track.Source.Camera);
    const audio = participant.getTrackPublication(Track.Source.Microphone);
    // Falha fechada: track remoto publicado sem criptografia nunca e exibido.
    for (const publication of [video, audio]) {
      if (publication && !publication.isEncrypted) {
        void fail("e2ee_failed");
        return;
      }
    }
    if (remoteVideo) {
      if (video?.track && !video.isMuted) video.track.attach(remoteVideo);
      else remoteVideo.srcObject = null;
    }
    if (remoteAudio && audio?.track) audio.track.attach(remoteAudio);
    emit({
      remote: {
        present: true,
        microphone: Boolean(audio?.track && !audio.isMuted),
        camera: Boolean(video?.track && !video.isMuted),
        encrypted: participant.isEncrypted,
      },
    });
  }

  async function fail(failure: CallFailure) {
    emit({ state: "failed", failure });
    await teardown();
  }

  async function teardown() {
    endCaptureClones("microphone");
    endCaptureClones("camera");
    const current = room;
    room = null;
    if (current) {
      intentionalDisconnect = true;
      current.removeAllListeners();
      await current.disconnect(true).catch(() => undefined);
    }
    worker?.terminate();
    worker = null;
    if (localVideo) localVideo.srcObject = null;
    if (remoteVideo) remoteVideo.srcObject = null;
    if (remoteAudio) remoteAudio.srcObject = null;
  }

  function checkParticipant(participant: Participant) {
    if (participant.identity !== peerIdentity) {
      void fail("unexpected_participant");
      return false;
    }
    return true;
  }

  function wire(current: Room) {
    current
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        if (state === ConnectionState.Connected) emit({ state: "connected" });
        else if (state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting) {
          emit({ state: "reconnecting" });
        }
      })
      .on(RoomEvent.Disconnected, () => {
        if (room !== current) return;
        // Lido ANTES do teardown (que marca a propria saida como intencional):
        // sala apagada pelo servidor e queda, nao saida voluntaria.
        const voluntary = intentionalDisconnect;
        void teardown();
        emit(voluntary ? { state: "disconnected" } : { state: "disconnected", failure: "room_closed" });
      })
      .on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (!participant.isLocal || snapshot.state === "reconnecting") return;
        if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) emit({ state: "unstable" });
        else if (snapshot.state === "unstable") emit({ state: "connected" });
      })
      .on(RoomEvent.EncryptionError, () => void fail("e2ee_failed"))
      .on(RoomEvent.ParticipantConnected, (participant) => {
        if (checkParticipant(participant)) refreshRemote();
      })
      .on(RoomEvent.ParticipantDisconnected, () => refreshRemote())
      .on(RoomEvent.TrackSubscribed, (_track, _publication, participant) => {
        if (checkParticipant(participant)) refreshRemote();
      })
      .on(RoomEvent.TrackUnsubscribed, () => refreshRemote())
      .on(RoomEvent.TrackMuted, (_publication, participant) => (participant.isLocal ? refreshLocal() : refreshRemote()))
      .on(RoomEvent.TrackUnmuted, (_publication, participant) => (participant.isLocal ? refreshLocal() : refreshRemote()))
      .on(RoomEvent.LocalTrackPublished, () => refreshLocal())
      .on(RoomEvent.LocalTrackUnpublished, () => refreshLocal())
      .on(RoomEvent.ParticipantEncryptionStatusChanged, (encrypted, participant) => {
        if (participant && !participant.isLocal) refreshRemote();
        else if (participant?.isLocal && !encrypted && participant.getTrackPublications().length > 0) {
          void fail("e2ee_failed");
        }
      });
  }

  async function countCameras() {
    try {
      const devices = await Room.getLocalDevices("videoinput", false);
      emit({ cameraCount: devices.length });
    } catch {
      emit({ cameraCount: 0 });
    }
  }

  return {
    async connect(join, devices) {
      await teardown();
      intentionalDisconnect = false;
      peerIdentity = join.peerIdentity;
      emit({ ...IDLE_CALL, state: "connecting" });
      if (!isE2EESupported()) {
        emit({ state: "failed", failure: "e2ee_unsupported" });
        return;
      }
      const keyProvider = new ExternalE2EEKeyProvider();
      try {
        worker = createE2EEWorker();
        await keyProvider.setKey(decodeKey(join.e2eeKey));
      } catch {
        await fail("e2ee_failed");
        return;
      }
      const current = new Room({
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: true,
        stopLocalTrackOnUnpublish: true,
        audioCaptureDefaults: { ...CALL_AUDIO_CONSTRAINTS, deviceId: devices.audioDeviceId },
        videoCaptureDefaults: { deviceId: devices.videoDeviceId },
        encryption: { keyProvider, worker },
      });
      room = current;
      wire(current);
      try {
        await current.setE2EEEnabled(true);
        await current.connect(join.url, join.token, { autoSubscribe: true });
      } catch {
        // Falha de rede/sinalizacao. Antes da confirmacao do worker a flag de
        // E2EE e sempre `false`: ela nao diz nada sobre a causa aqui.
        if (room === current) await fail("connect_failed");
        return;
      }
      // Falha fechada: nada e publicado antes de o worker CONFIRMAR o E2EE do
      // participante local. A confirmacao e assincrona (evento do worker) e,
      // sob CPU alta, chega depois de `connect()` - por isso esperar, com
      // prazo, em vez de ler a flag uma vez (race achada no QA sob carga).
      if (!(await localEncryptionConfirmed(current, E2EE_CONFIRM_TIMEOUT_MS))) {
        if (room === current) await fail("e2ee_failed");
        return;
      }
      if (room !== current) return;
      for (const participant of current.remoteParticipants.values()) {
        if (!checkParticipant(participant)) return;
      }
      emit({ state: "connected", e2ee: true });
      // Microfone/camera negados ou ausentes nao derrubam a chamada.
      if (devices.audio) await current.localParticipant.setMicrophoneEnabled(true).catch(() => undefined);
      if (devices.video) await current.localParticipant.setCameraEnabled(true).catch(() => undefined);
      refreshLocal();
      refreshRemote();
      void countCameras();
    },

    async disconnect() {
      intentionalDisconnect = true;
      await teardown();
      emit({ ...IDLE_CALL, state: "disconnected" });
    },

    async setMicrophoneEnabled(enabled) {
      if (!room) return;
      await room.localParticipant.setMicrophoneEnabled(enabled);
      refreshLocal();
    },

    async setCameraEnabled(enabled) {
      if (!room) return;
      await room.localParticipant.setCameraEnabled(enabled);
      refreshLocal();
    },

    async switchCamera() {
      if (!room) return;
      const devices = await Room.getLocalDevices("videoinput", false);
      if (devices.length < 2) return;
      const current = room.getActiveDevice("videoinput");
      const index = devices.findIndex((device) => device.deviceId === current);
      const next = devices[(index + 1) % devices.length]!;
      // Trocar a fonte encerra os clones da captura: a captura nao segue em
      // silencio uma camera que a pessoa acabou de trocar.
      endCaptureClones("camera");
      await room.switchActiveDevice("videoinput", next.deviceId);
      refreshLocal();
    },

    attachLocalVideo(element) {
      localVideo = element;
      refreshLocal();
    },

    attachRemote(video, audio) {
      remoteVideo = video;
      remoteAudio = audio;
      refreshRemote();
    },

    captureStream(resource) {
      if (!room) throw new DOMException("Call not connected", "NotFoundError");
      const local = room.localParticipant;
      assertLocalCaptureParticipant(local);
      const source = resource === "camera" ? Track.Source.Camera : Track.Source.Microphone;
      const publication = local.getTrackPublication(source);
      const track = publication?.track?.mediaStreamTrack;
      if (!track || publication?.isMuted || track.readyState !== "live") {
        throw new DOMException("Local call track unavailable", "NotFoundError");
      }
      const clone = track.clone();
      clone.enabled = true;
      if (!captureClones.has(resource)) captureClones.set(resource, new Set());
      captureClones.get(resource)!.add(clone);
      return new MediaStream([clone]);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      return snapshot;
    },
  };
}

/** O que o navegador suporta, antes de qualquer permissao. */
export function callEnvironmentSupport() {
  return {
    webrtc: typeof RTCPeerConnection !== "undefined",
    e2ee: isE2EESupported(),
    outputSelection: typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype,
  };
}
