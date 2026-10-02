import type { TranscriptUnavailableReason } from "@/lib/contracts/session-analysis";
import {
  buildTranscription,
  type AsrOutcome,
} from "@/lib/speech/segment-acceptance";
import type {
  LocalSpeechEngine,
  SpeechCandidate,
  SpeechEngineResult,
  SpeechEngineState,
} from "@/lib/speech/types";
import { detectSpeechSegments, toCandidates, type VadSession } from "@/lib/speech/vad";
import { recordDiagnosticOutcome, recordDiagnosticWhisperError, recordDiagnosticAcceptance,
  type AsrPhysicalDiagnostic } from "./physical-diagnostic";

/**
 * Orquestracao do reconhecimento local: VAD decide, ASR transcreve, Elyra aceita.
 *
 * ## A ordem importa, e ela e a mitigacao
 *
 * ```
 * PCM  ->  VAD  ->  trechos com fala  ->  ASR  ->  aceitacao  ->  transcricao
 * ```
 *
 * O ASR **so ve** audio que o VAD marcou como fala. Foi assim que o caminho da
 * fabricacao foi fechado: o silencio que fez o `whisper-base` inventar uma frase
 * nunca chega a ele, porque o Silero da 0,0006 de probabilidade ali e o trecho
 * nem existe.
 *
 * Isso **nao** e uma garantia absoluta, e a documentacao nao vai dizer que e.
 * Um VAD pode aceitar um trecho ruidoso, e o ASR pode inventar dentro de um
 * trecho legitimamente falado. Por isso ha uma terceira camada depois - a regra
 * de aceitacao - e por isso a frase que descreve o sistema e "defesa em
 * profundidade", e nao "silencio nunca chega ao Whisper".
 *
 * ## Nada aqui lanca
 *
 * ```
 * ASR_FAILURE != VAD_FAILURE != MICROPHONE_FAILURE != SESSION_FAILURE
 * ```
 *
 * Falha de VAD, de modelo ou de decodificacao vira ausencia com motivo tipado.
 * A sessao segue, e os sinais que a envoltoria RMS ja mediu - pausas, duracao
 * falada, variacao vocal - continuam existindo, porque vem de outro sensor.
 */

/** Transcreve um trecho de PCM. Injetavel para o teste nao precisar do Whisper. */
export interface AsrSession {
  dispose?(): Promise<void> | void;
  transcribe(pcm: Float32Array): Promise<AsrOutcome>;
}

export interface LocalModelEngineOptions {
  /** PCM mono 16 kHz da sessao inteira, em memoria. */
  pcm: () => Float32Array;
  vad: VadSession | null;
  asr: AsrSession | null;
  /** Offset de sessao em que a captura de audio comecou. */
  audioStartOffsetMs?: number;
  state?: () => SpeechEngineState;
  diagnostic?: AsrPhysicalDiagnostic;
}

/**
 * Motor de fallback local.
 *
 * `vad = null` ou `asr = null` significam que o caminho local nao esta pronto -
 * e a resposta e ausencia, nunca reconhecimento sem VAD.
 */
export function createLocalModelEngine(
  options: LocalModelEngineOptions,
): LocalSpeechEngine {
  let failed = false;

  return {
    kind: "local_model",
    state() {
      if (failed) return "failed";
      if (options.state) return options.state();
      return options.vad && options.asr ? "active" : "unavailable";
    },
    async stop(): Promise<SpeechEngineResult> {
      const { vad, asr, diagnostic } = options;

      /*
        Sem VAD nao ha reconhecimento. Nunca.

        Mandar o audio direto ao ASR "porque o VAD nao carregou" seria remover a
        unica camada que impede silencio de virar frase - exatamente a
        neutralizacao que os testes precisam reprovar.
      */
      if (!vad || !asr) {
        return { status: "unavailable", reason: "local_speech_unavailable" };
      }

      let pcm: Float32Array;
      try {
        pcm = options.pcm();
      } catch {
        return failure();
      }

      if (pcm.length === 0) {
        // Sem audio nao ha nada a transcrever, e isso nao e falha do motor.
        return {
          status: "available",
          transcription: { accepted: [], rejected: [] },
        };
      }

      let candidates: SpeechCandidate[];
      try {
        const segments = await detectSpeechSegments(pcm, vad, undefined, diagnostic);
        candidates = toCandidates(pcm, segments, options.audioStartOffsetMs ?? 0);
        if (diagnostic) diagnostic.candidateCount = candidates.length;
      } catch {
        if (diagnostic && !diagnostic.vadCompleted) diagnostic.vadErrorsCount++;
        return failure();
      }

      const pairs: { candidate: SpeechCandidate; outcome: AsrOutcome }[] = [];
      for (const candidate of candidates) {
        if (diagnostic) {
          diagnostic.whisperCalled = true;
          diagnostic.whisperCallCount++;
          diagnostic.whisperInputDurationMs.push(candidate.pcm.length / 16000 * 1000);
        }
        try {
          const outcome = await asr.transcribe(candidate.pcm);
          if (diagnostic) recordDiagnosticOutcome(diagnostic, outcome);
          pairs.push({ candidate, outcome });
        } catch (error) {
          if (diagnostic) recordDiagnosticWhisperError(diagnostic, error);
          /*
            Um trecho que falhou nao derruba os outros. O resultado dele e
            ausencia, e a transcricao segue com o que deu certo - perder tres
            minutos de fala porque um trecho de dois segundos estourou seria
            trocar tudo por nada.
          */
          pairs.push({ candidate, outcome: { text: "" } });
        }
      }

      const transcription = buildTranscription(pairs);
      if (diagnostic) recordDiagnosticAcceptance(diagnostic, transcription);
      return {
        status: "available",
        transcription,
      };

      function failure(): SpeechEngineResult {
        failed = true;
        const reason: TranscriptUnavailableReason = "recognition_failed";
        return { status: "failed", reason };
      }
    },
  };
}
