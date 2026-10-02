"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { asrDiagnosticEnabled, readAsrDiagnostic, saveAsrDiagnostic, removeAsrDiagnostic,
  firstObservedFailure, type AsrPhysicalDiagnostic } from "@/lib/speech/physical-diagnostic";

export function AsrDiagnosticPanel({ sessionId, persistedSegments }: {
  sessionId: string; persistedSegments: number;
}) {
  const [diagnostic, setDiagnostic] = useState<AsrPhysicalDiagnostic | null>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const value = readAsrDiagnostic(sessionId);
      if (value) {
        value.persistedSegments = persistedSegments;
        value.firstObservedFailure = firstObservedFailure(value);
        saveAsrDiagnostic(sessionId, value);
      }
      setDiagnostic(value);
    });
    return () => cancelAnimationFrame(frame);
  }, [sessionId, persistedSegments]);
  if (!asrDiagnosticEnabled() || !diagnostic) return null;
  const d = diagnostic;
  const n = (value: number | null) => value === null ? "UNKNOWN" : String(Number(value.toFixed(6)));
  const list = (values: number[]) => values.map(n).join(",");
  const lines = [
    `session_duration_ms=${n(d.sessionDurationMs)}`,
    `PCM samples=${n(d.pcmSampleCount)} duration_ms=${n(d.pcmDurationMs)} peak=${n(d.pcmPeakAbs)} rms=${n(d.pcmRms)} non_finite=${d.pcmNonFiniteSamples}`,
    `VAD called=${d.vadCalled} completed=${d.vadCompleted} windows=${d.vadWindowsTotal} maxProbability=${n(d.vadMaxSpeechProbability)} aboveThreshold=${d.vadWindowsAboveThreshold}`,
    `VAD segments=${n(d.vadSegmentsCount)} segment_duration_ms=[${list(d.vadSegmentDurationMs)}] speech_duration_ms=${n(d.vadTotalSpeechMs)} errors=${d.vadErrorsCount}`,
    `Whisper called=${d.whisperCalled} calls=${d.whisperCallCount} input_duration_ms=[${list(d.whisperInputDurationMs)}]`,
    `Whisper rawTextPresent=${d.whisperRawTextLength.some((length) => length > 0) ? "YES" : d.asrOutcomeCount > 0 ? "NO" : "UNKNOWN"} rawLength=[${list(d.whisperRawTextLength)}] normalizedLength=[${list(d.whisperNormalizedTextLength)}] errors=${d.whisperErrorsCount} classes=${d.whisperErrorClasses.join(",") || "NONE"}`,
    `Acceptance candidates=${n(d.candidateCount)} outcomes=${d.asrOutcomeCount} accepted=${n(d.acceptedCount)} rejected=${n(d.rejectedCount)} reasons=${JSON.stringify(d.rejectionReasons)}`,
    `final_status=${d.finalTranscriptStatus} persisted_segments=${n(d.persistedSegments)}`,
    `FIRST_BROKEN_LINK=${d.firstObservedFailure}`,
  ];
  return (
    <section className="mt-6 rounded-control border border-line p-4" data-testid="asr-diagnostic-panel">
      <h2 className="text-base font-semibold">Diagnóstico ASR — QA</h2>
      <p className="mt-1 text-xs text-ink-muted">Somente métricas locais desta aba. Sem áudio ou texto reconhecido.</p>
      <pre className="my-3 whitespace-pre-wrap break-words text-xs">{lines.join("\n")}</pre>
      <Button size="sm" variant="ghost" onClick={() => {
        removeAsrDiagnostic(sessionId); setDiagnostic(null);
      }}>Remover diagnóstico local</Button>
    </section>
  );
}
