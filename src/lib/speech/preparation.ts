import type { TranscriptCapture, LocalSpeechAvailability } from "@/lib/multimodal-derivation";
import type { PcmCollector } from "./audio-pipeline";
import {
  ASR_DOWNLOAD_BYTES, VAD_MODEL_BYTES, loadAsrSession, loadVadSession,
  type AsrLoadOptions, type RuntimeFailure, type RuntimeLoad,
} from "./browser-runtime";
import { createLocalModelEngine } from "./local-model-engine";
import type { AsrSession } from "./local-model-engine";
import type { VadSession } from "./vad";
import type { LocalSpeechEngine } from "./types";
import { measureDiagnosticPcm, type AsrPhysicalDiagnostic } from "./physical-diagnostic";

export type SpeechFailure =
  | "native_local_unavailable"
  | "local_asr_preparation_required"
  | "local_asr_assets_missing"
  | "local_asr_integrity_failed"
  | "local_vad_load_failed"
  | "local_whisper_load_failed"
  | "local_asr_cancelled"
  | "local_asr_stalled"
  | "local_pcm_unavailable"
  | "local_asr_runtime_failed";

export const SPEECH_FAILURE_LABEL: Record<SpeechFailure, string> = {
  native_local_unavailable: "Seu navegador não oferece transcrição local em português.",
  local_asr_preparation_required: "Prepare a transcrição local antes de iniciar.",
  local_asr_assets_missing: "Os arquivos da transcrição local não estão disponíveis nesta instalação.",
  local_asr_integrity_failed: "A verificação dos arquivos da transcrição local falhou.",
  local_vad_load_failed: "Não foi possível preparar o detector de fala local.",
  local_whisper_load_failed: "Não foi possível preparar o reconhecimento de fala local.",
  local_asr_cancelled: "O preparo da transcrição local foi cancelado.",
  local_asr_stalled: "O preparo da transcrição local parou de avançar. Verifique a conexão e tente novamente.",
  local_pcm_unavailable: "Não foi possível obter áudio para a transcrição local.",
  local_asr_runtime_failed: "Transcrição local falhou durante o processamento no aparelho.",
};

/** Conversao deliberada para o contrato existente. Falha local nunca vira recusa nativa. */
export function speechFailureCapture(reason: SpeechFailure): TranscriptCapture {
  return reason === "native_local_unavailable"
    ? { status: "unavailable", reason: "local_speech_unavailable" }
    : { status: "failed", reason: "recognition_failed" };
}

/**
 * Onde o preparo esta. `detector` cobre o Silero e o kernel WASM do ONNX;
 * `model`, os arquivos do Whisper; `initializing`, a montagem da sessao no
 * aparelho depois do download — fase que o runtime nao mede em bytes.
 */
export interface PreparationProgress {
  stage: "detector" | "model" | "initializing";
  loadedBytes: number;
  totalBytes: number;
}

export interface PreparationSnapshot {
  status: "required" | "preparing" | "cancelling" | "ready" | "failed";
  failure: SpeechFailure | null;
  /** So existe em `preparing`. */
  progress?: PreparationProgress;
}

const INITIAL: PreparationSnapshot = { status: "required", failure: null };

/**
 * Janelas do watchdog de stall. Nao existe teto absoluto: pelo Quick Tunnel o
 * primeiro preparo leva 10-15 min e e legitimo. O que encerra o preparo e a
 * **ausencia de avanco**.
 *
 * `TRANSFER`: ha download em curso e nenhum byte novo chegou.
 * `SILENT`: fases sem contador — import do runtime, kernel WASM (11-24 MB,
 * ~70 s a 0,35 MB/s) e montagem da sessao do Whisper no celular.
 */
export const STALL_TRANSFER_MS = 90_000;
export const STALL_SILENT_MS = 240_000;
/** Cancelar aborta os downloads; se o runtime nao devolver o controle neste prazo, o slot e liberado assim mesmo. */
export const CANCEL_GRACE_MS = 15_000;

/** Percentual inteiro em 0-100, ou `null` quando o total nao e conhecido. */
export function preparationPercent(progress: PreparationProgress): number | null {
  if (!(progress.totalBytes > 0) || !Number.isFinite(progress.loadedBytes)) return null;
  return Math.min(100, Math.max(0, Math.floor((progress.loadedBytes / progress.totalBytes) * 100)));
}

const mb = (bytes: number) => Math.round(bytes / 1_000_000);

export function describePreparationProgress(progress: PreparationProgress): string {
  if (progress.stage === "initializing") return "Arquivos carregados. Inicializando o modelo no aparelho…";
  const label = progress.stage === "detector" ? "Baixando detector de fala" : "Baixando modelo";
  const percent = preparationPercent(progress);
  const loaded = Math.min(progress.loadedBytes, progress.totalBytes);
  return `${label}: ${mb(loaded)} MB / ${mb(progress.totalBytes)} MB${percent === null ? "" : ` — ${percent}%`}`;
}

export function transcriptionPreflight(
  consent: boolean,
  native: LocalSpeechAvailability | null,
  local: PreparationSnapshot,
) {
  if (!consent) return "DISABLED";
  if (native === null) return "CHECKING";
  if (native === "available") return "READY_NATIVE";
  if (local.status === "ready") return "READY_LOCAL";
  return "LOCAL_PREPARATION_REQUIRED";
}

export function transcriptionCanStart(
  consent: boolean,
  native: LocalSpeechAvailability | null,
  local: PreparationSnapshot,
) {
  return ["DISABLED", "READY_NATIVE", "READY_LOCAL"].includes(
    transcriptionPreflight(consent, native, local),
  );
}

function loadFailure(failure: RuntimeFailure | null, stage: "vad" | "whisper"): SpeechFailure {
  if (failure === "assets_missing") return "local_asr_assets_missing";
  if (failure === "integrity_failed") return "local_asr_integrity_failed";
  if (failure === "cancelled") return "local_asr_cancelled";
  return stage === "vad" ? "local_vad_load_failed" : "local_whisper_load_failed";
}

export interface PreparationLoaders {
  vad: (signal: AbortSignal, onBytes?: (loaded: number) => void) => Promise<RuntimeLoad<VadSession>>;
  asr: (options: AsrLoadOptions) => Promise<RuntimeLoad<AsrSession>>;
}

/** Cache de modelos, sem consentimento ou PCM. Uma operacao pesada por vez. */
export function createSpeechPreparation(loaders: PreparationLoaders = { vad: loadVadSession, asr: loadAsrSession }) {
  let snapshot = INITIAL;
  let prepared: { vad: VadSession; asr: AsrSession } | null = null;
  let operation: Promise<void> | null = null;
  let controller: AbortController | null = null;
  let leased = false;
  /**
   * Cada tentativa tem um numero. Uma tentativa abandonada — por stall ou por
   * cancelamento que o runtime nao devolveu a tempo — perde o direito de
   * publicar e de ocupar o slot; o que ela carregar depois e descartado.
   */
  let generation = 0;
  let abandon: ((value: PreparationSnapshot) => void) | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let cancelTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const publish = (value: PreparationSnapshot) => {
    snapshot = value;
    listeners.forEach((listener) => listener());
  };
  const clearTimers = () => {
    if (watchdog) clearTimeout(watchdog);
    if (cancelTimer) clearTimeout(cancelTimer);
    watchdog = null;
    cancelTimer = null;
  };
  const retire = (runtime: { vad: VadSession; asr: AsrSession }) => {
    if (prepared !== runtime) return operation ?? Promise.resolve();
    prepared = null;
    // Invalida prontidao e reserva o slot ate liberar o runtime que falhou.
    operation = (async () => {
      try { await runtime.vad.dispose?.(); } catch { /* Cleanup best-effort. */ }
      try { await runtime.asr.dispose?.(); } catch { /* Cleanup best-effort. */ }
    })().finally(() => { operation = null; });
    publish({ status: "failed", failure: "local_asr_runtime_failed" });
    return operation;
  };

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => INITIAL,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    prepare(): Promise<void> {
      if (operation) return operation;
      if (leased) return Promise.resolve();
      if (prepared && snapshot.status === "ready") return Promise.resolve();
      const attempt = ++generation;
      const current = () => attempt === generation;
      const abort = new AbortController();
      controller = abort;

      let settle!: () => void;
      const abandoned = new Promise<void>((resolve) => { settle = resolve; });
      abandon = (value) => {
        if (!current()) return;
        generation++;
        clearTimers();
        operation = null;
        controller = null;
        abandon = null;
        publish(value);
        settle();
      };

      let stage: PreparationProgress["stage"] = "detector";
      let vadBytes = 0;
      const files = new Map<string, { loaded: number; total: number }>();
      const progress = (): PreparationProgress => {
        let loaded = vadBytes;
        let total = VAD_MODEL_BYTES;
        for (const file of files.values()) { loaded += file.loaded; total += file.total; }
        return { stage, loadedBytes: loaded, totalBytes: Math.max(total, ASR_DOWNLOAD_BYTES) };
      };
      const transferPending = () => stage === "detector"
        ? vadBytes < VAD_MODEL_BYTES
        : stage === "model" && [...files.values()].some((file) => file.loaded < file.total);
      let shown = "";
      const touch = () => {
        if (!current() || abort.signal.aborted) return;
        if (watchdog) clearTimeout(watchdog);
        watchdog = setTimeout(() => {
          // Aborta os downloads de verdade; so trocar o estado deixaria a rede ocupada.
          abort.abort();
          abandon?.({ status: "failed", failure: "local_asr_stalled" });
        }, transferPending() ? STALL_TRANSFER_MS : STALL_SILENT_MS);
        const next = progress();
        // Publica por MB inteiro ou troca de fase, e nao a cada chunk de rede.
        const key = `${next.stage}:${mb(next.loadedBytes)}:${mb(next.totalBytes)}`;
        if (key === shown) return;
        shown = key;
        publish({ status: "preparing", failure: null, progress: next });
      };
      const onLoadEvent: NonNullable<AsrLoadOptions["onLoadEvent"]> = (event) => {
        const known = files.get(event.file);
        if (event.status === "progress" && event.file) {
          const total = Number.isFinite(event.total) && event.total! > 0 ? event.total! : 0;
          const loaded = Number.isFinite(event.loaded) && event.loaded! > 0 ? event.loaded! : 0;
          files.set(event.file, { loaded: Math.max(loaded, known?.loaded ?? 0), total: Math.max(total, loaded) });
        } else if (event.status === "done" && known) {
          known.loaded = known.total;
        }
        const pending = [...files.values()].some((file) => file.loaded < file.total);
        stage = files.size > 0 && !pending ? "initializing" : "model";
        touch();
      };

      touch();
      const body = (async () => {
        let vad: VadSession | null = null;
        let asr: AsrSession | null = null;
        let assigned = false;
        let phase: "vad" | "whisper" = "vad";
        const report = (value: PreparationSnapshot) => { if (current()) publish(value); };
        try {
          const v = await loaders.vad(abort.signal, (loaded) => {
            vadBytes = Math.min(loaded, VAD_MODEL_BYTES);
            touch();
          });
          vad = v.value;
          if (abort.signal.aborted || !current()) return;
          if (!vad) return report({ status: "failed", failure: loadFailure(v.failure, "vad") });
          phase = "whisper";
          vadBytes = VAD_MODEL_BYTES;
          stage = "model";
          touch();
          const a = await loaders.asr({ signal: abort.signal, onLoadEvent });
          asr = a.value;
          if (abort.signal.aborted || !current()) return;
          if (!asr) return report({ status: "failed", failure: loadFailure(a.failure, "whisper") });
          prepared = { vad, asr };
          assigned = true;
          report({ status: "ready", failure: null });
        } catch {
          report({ status: "failed", failure: loadFailure("load_failed", phase) });
        } finally {
          if (!assigned) {
            // Cleanup best-effort nunca deixa o slot de preparacao preso.
            try { await vad?.dispose?.(); } catch { /* Sem audio ou texto em log. */ }
            try { await asr?.dispose?.(); } catch { /* Sem audio ou texto em log. */ }
          }
          if (current()) {
            clearTimers();
            operation = null;
            controller = null;
            abandon = null;
            if (abort.signal.aborted) publish({ status: "failed", failure: "local_asr_cancelled" });
          }
        }
      })();
      operation = Promise.race([body, abandoned]);
      return operation;
    },
    cancel() {
      if (!controller || controller.signal.aborted) return;
      controller.abort();
      if (watchdog) clearTimeout(watchdog);
      watchdog = null;
      // Mantem o slot ocupado ate o loader devolver o controle, com prazo: cancelar nunca fica preso.
      publish({ status: "cancelling", failure: "local_asr_cancelled" });
      cancelTimer = setTimeout(
        () => abandon?.({ status: "failed", failure: "local_asr_cancelled" }),
        CANCEL_GRACE_MS,
      );
    },
    attach(pcm: PcmCollector, onFailure: (failure: SpeechFailure) => void, diagnostic?: AsrPhysicalDiagnostic):
      { engine: LocalSpeechEngine; release: () => void } | null {
      const fail = (reason: SpeechFailure) => { onFailure(reason); return null; };
      if (!prepared || snapshot.status !== "ready") return fail("local_asr_preparation_required");
      if (pcm.available === false) return fail("local_pcm_unavailable");
      if (leased) return fail("local_asr_runtime_failed");
      const runtime = prepared;
      try { runtime.vad.reset(); } catch {
        void retire(runtime);
        return fail("local_asr_runtime_failed");
      }
      leased = true;
      let released = false;
      let running = false;
      let samples: Float32Array = new Float32Array(0);
      let inferenceFailed = false;
      const inner = createLocalModelEngine({ pcm: () => samples, vad: runtime.vad, diagnostic, asr: {
        async transcribe(audio) {
          try { return await runtime.asr.transcribe(audio); }
          catch (error) { inferenceFailed = true; throw error; }
        },
      } });
      const release = () => {
        if (released || running) return;
        released = true;
        samples = new Float32Array(0);
        try { runtime.vad.reset(); } catch {
          void retire(runtime);
        } finally { leased = false; }
      };
      const engine: LocalSpeechEngine = {
        kind: "local_model",
        state: () => released ? "unavailable" : "active",
        async stop() {
          try {
            if (released) throw new Error("released");
            running = true;
            samples = pcm.stop();
            if (diagnostic) measureDiagnosticPcm(diagnostic, samples);
            if (samples.length === 0) {
              onFailure("local_pcm_unavailable");
              return { status: "failed", reason: "recognition_failed" };
            }
            const result = await inner.stop();
            if (inferenceFailed || result.status === "failed") await retire(runtime);
            if (inferenceFailed && result.status === "available" && result.transcription.accepted.length === 0) {
              onFailure("local_asr_runtime_failed");
              return { status: "failed", reason: "recognition_failed" };
            }
            if (result.status === "failed") onFailure("local_asr_runtime_failed");
            return result;
          } catch {
            await retire(runtime);
            onFailure("local_asr_runtime_failed");
            return { status: "failed", reason: "recognition_failed" };
          } finally { running = false; release(); }
        },
      };
      return { engine, release };
    },
  };
}

export const speechPreparation = createSpeechPreparation();
