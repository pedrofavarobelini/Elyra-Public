import { z } from "zod";
import { stripNonSpeechMarkup, type AsrOutcome } from "./segment-acceptance";
import type { SpeechTranscription } from "./types";

const count = z.number().int().nonnegative().finite();
const measure = z.number().nonnegative().finite();
const measures = z.array(measure).max(10000);
const FAILURE = ["UNKNOWN", "NONE", "PCM", "VAD", "VAD_RUNTIME_ERROR", "WHISPER_NOT_CALLED",
  "WHISPER_EMPTY", "WHISPER_RUNTIME_ERROR", "ACCEPTANCE", "PERSISTENCE"] as const;
const ERROR_CLASS = ["Error", "TypeError", "RangeError", "DOMException", "Other"] as const;

/** Allowlist: nunca serializar objetos de runtime, texto ou buffers. */
export const asrPhysicalDiagnosticSchema = z.object({
  version: z.literal(1),
  sessionDurationMs: measure.nullable(),
  pcmSampleCount: count.nullable(), pcmDurationMs: measure.nullable(),
  pcmPeakAbs: measure.nullable(), pcmRms: measure.nullable(), pcmNonFiniteSamples: count,
  vadCalled: z.boolean(), vadCompleted: z.boolean(), vadErrorsCount: count,
  vadWindowsTotal: count, vadMaxSpeechProbability: measure.nullable(),
  vadWindowsAboveThreshold: count, vadSegmentsCount: count.nullable(),
  vadSegmentDurationMs: measures, vadTotalSpeechMs: measure.nullable(),
  whisperCalled: z.boolean(), whisperCallCount: count, whisperInputDurationMs: measures,
  whisperRawTextLength: z.array(count).max(10000),
  whisperNormalizedTextLength: z.array(count).max(10000),
  whisperErrorsCount: count, whisperErrorClasses: z.array(z.enum(ERROR_CLASS)).max(10000),
  candidateCount: count.nullable(), asrOutcomeCount: count,
  acceptanceCompleted: z.boolean(), acceptedCount: count.nullable(), rejectedCount: count.nullable(),
  rejectionReasons: z.object({ empty_text: count, non_speech_only: count,
    no_speech_probability: count, vad_rejected: count, runtime_error: count }),
  persistedSegments: count.nullable(),
  firstObservedFailure: z.enum(FAILURE),
  finalTranscriptStatus: z.enum(["unknown", "available", "unavailable", "failed"]),
});
export type AsrPhysicalDiagnostic = z.infer<typeof asrPhysicalDiagnosticSchema>;

export function newAsrDiagnostic(): AsrPhysicalDiagnostic {
  return {
    version: 1, sessionDurationMs: null, pcmSampleCount: null, pcmDurationMs: null,
    pcmPeakAbs: null, pcmRms: null, pcmNonFiniteSamples: 0,
    vadCalled: false, vadCompleted: false, vadErrorsCount: 0, vadWindowsTotal: 0,
    vadMaxSpeechProbability: null, vadWindowsAboveThreshold: 0, vadSegmentsCount: null,
    vadSegmentDurationMs: [], vadTotalSpeechMs: null,
    whisperCalled: false, whisperCallCount: 0, whisperInputDurationMs: [],
    whisperRawTextLength: [], whisperNormalizedTextLength: [], whisperErrorsCount: 0,
    whisperErrorClasses: [], candidateCount: null, asrOutcomeCount: 0,
    acceptanceCompleted: false, acceptedCount: null, rejectedCount: null,
    rejectionReasons: { empty_text: 0, non_speech_only: 0, no_speech_probability: 0,
      vad_rejected: 0, runtime_error: 0 }, persistedSegments: null,
    firstObservedFailure: "UNKNOWN", finalTranscriptStatus: "unknown",
  };
}

export function measureDiagnosticPcm(d: AsrPhysicalDiagnostic, samples: Float32Array) {
  d.pcmSampleCount = samples.length;
  d.pcmDurationMs = samples.length / 16000 * 1000;
  let peak = 0, squares = 0, finite = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) { d.pcmNonFiniteSamples++; continue; }
    finite++;
    peak = Math.max(peak, Math.abs(sample));
    squares += sample * sample;
  }
  d.pcmPeakAbs = peak;
  d.pcmRms = finite ? Math.sqrt(squares / finite) : 0;
}

export function recordDiagnosticOutcome(d: AsrPhysicalDiagnostic, outcome: AsrOutcome) {
  d.asrOutcomeCount++;
  d.whisperRawTextLength.push(outcome.text.length);
  d.whisperNormalizedTextLength.push(stripNonSpeechMarkup(outcome.text.trim()).length);
}

export function recordDiagnosticWhisperError(d: AsrPhysicalDiagnostic, error: unknown) {
  d.whisperErrorsCount++;
  // Nunca copiar message, stack, name ou code arbitrarios da excecao.
  d.whisperErrorClasses.push(error instanceof TypeError ? "TypeError"
    : error instanceof RangeError ? "RangeError"
      : typeof DOMException !== "undefined" && error instanceof DOMException ? "DOMException"
        : error instanceof Error ? "Error" : "Other");
}

export function recordDiagnosticAcceptance(d: AsrPhysicalDiagnostic, result: SpeechTranscription) {
  d.acceptanceCompleted = true;
  d.acceptedCount = result.accepted.length;
  d.rejectedCount = result.rejected.length;
  for (const segment of result.rejected) d.rejectionReasons[segment.rejection]++;
  // O engine existente representa excecoes como outcome vazio. Classifica sem mudar essa regra.
  d.rejectionReasons.runtime_error = d.whisperErrorsCount;
  d.rejectionReasons.empty_text = Math.max(0, d.rejectionReasons.empty_text - d.whisperErrorsCount);
}

export function firstObservedFailure(d: AsrPhysicalDiagnostic): AsrPhysicalDiagnostic["firstObservedFailure"] {
  if (d.pcmSampleCount === null) return "UNKNOWN";
  if (d.pcmSampleCount === 0 || d.pcmNonFiniteSamples > 0) return "PCM";
  if (d.vadErrorsCount > 0) return "VAD_RUNTIME_ERROR";
  if (d.vadCalled && d.vadCompleted && d.vadSegmentsCount === 0) return "VAD";
  if (d.vadSegmentsCount !== null && d.vadSegmentsCount > 0 && d.whisperCallCount === 0) return "WHISPER_NOT_CALLED";
  if (d.acceptedCount !== null && d.acceptedCount > 0) return d.persistedSegments === 0 ? "PERSISTENCE" : "NONE";
  if (d.whisperErrorsCount > 0) return "WHISPER_RUNTIME_ERROR";
  if (d.whisperCallCount > 0 && d.whisperRawTextLength.length === d.whisperCallCount &&
      d.whisperRawTextLength.every((length) => length === 0)) return "WHISPER_EMPTY";
  if (d.acceptanceCompleted && d.acceptedCount === 0 && d.whisperRawTextLength.some((length) => length > 0)) return "ACCEPTANCE";
  return "UNKNOWN";
}

export function asrDiagnosticEnabled(hostname = typeof window === "undefined" ? "" : window.location.hostname) {
  return (process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_ASR_QA_DIAGNOSTICS === "1") &&
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

const PREFIX = "elyra:qa:asr:";
function storageKey(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? PREFIX + id : null;
}
export function saveAsrDiagnostic(id: string, diagnostic: AsrPhysicalDiagnostic, storage?: Storage) {
  try {
    if (!asrDiagnosticEnabled()) return;
    const key = storageKey(id);
    const safe = asrPhysicalDiagnosticSchema.parse(diagnostic);
    safe.firstObservedFailure = firstObservedFailure(safe);
    if (key) (storage ?? window.sessionStorage).setItem(key, JSON.stringify(safe));
  } catch { /* Quota/privacidade do browser nao alteram o reconhecimento. */ }
}
export function readAsrDiagnostic(id: string, storage?: Storage): AsrPhysicalDiagnostic | null {
  try {
    if (!asrDiagnosticEnabled()) return null;
    const key = storageKey(id);
    const raw = key && (storage ?? window.sessionStorage).getItem(key);
    return raw ? asrPhysicalDiagnosticSchema.parse(JSON.parse(raw)) : null;
  } catch { return null; }
}
export function removeAsrDiagnostic(id: string, storage?: Storage) {
  try {
    const key = storageKey(id);
    if (key) (storage ?? window.sessionStorage).removeItem(key);
  } catch { /* Remocao best-effort, sem logs. */ }
}
